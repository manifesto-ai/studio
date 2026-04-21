import type { GraphEdge, GraphModel } from "@manifesto-ai/studio-react";
import {
  attachPoint,
  portTowards,
  type ClusterPort,
  type LayoutResult,
  type Rect,
} from "./layout";
import type { ClusterMap } from "./clusters";

/**
 * Edge routing abstraction.
 *
 * Routers are pure functions that map graph + layout + clusters into
 * SVG paths. EdgeLayer renders whatever they return; switching the
 * routing strategy (bezier, orthogonal, dagre, elk) is a one-line
 * prop change.
 *
 * Default implementation: `orthogonalPortRouter` — smoothstep (right-
 * angle segments with rounded corners) throughout, with cluster ports
 * as the bundling rendezvous. This matches the industry convention
 * for dataflow / state-machine surfaces (XState, Mermaid flowchart,
 * React Flow smoothstep, draw.io) and plays well with the trunk
 * bundling story: same-axis orthogonal segments overlap pixel-exactly.
 *
 * Output carries two groups:
 *  - `edges`  — one path per edge (individual connection read)
 *  - `trunks` — one path per cluster pair with ≥2 edges (river read).
 *
 * When a bundle has ≥2 edges, its members render only the entry+exit
 * legs; the trunk carries the middle. Solo bundled edges and intra-
 * cluster edges render full paths.
 */

export type EdgeRouteInput = {
  readonly model: GraphModel;
  readonly layout: LayoutResult;
  readonly clusters?: ClusterMap;
  readonly options?: {
    /** When false, router falls back to straight-ish routing everywhere. */
    readonly bundling?: boolean;
    /** Corner radius for smoothstep segments. Default 10. */
    readonly borderRadius?: number;
  };
};

export type EdgeRoute = {
  readonly edgeId: string;
  readonly d: string;
  readonly hint: "straight" | "solo-bundled" | "bundle-leaf";
};

export type TrunkRoute = {
  readonly id: string;
  readonly d: string;
  readonly edgeCount: number;
  readonly dominantRelation: GraphEdge["relation"];
};

export type EdgeRoutingResult = {
  readonly edges: readonly EdgeRoute[];
  readonly trunks: readonly TrunkRoute[];
};

export type EdgeRouter = (input: EdgeRouteInput) => EdgeRoutingResult;

export const orthogonalPortRouter: EdgeRouter = ({
  model,
  layout,
  clusters,
  options,
}) => {
  const bundlingEnabled =
    options?.bundling !== false && clusters !== undefined;
  const borderRadius = options?.borderRadius ?? 10;

  const clusterRectById = new Map<string, Rect>();
  if (bundlingEnabled && layout.clusterRects !== undefined) {
    for (const r of layout.clusterRects) {
      clusterRectById.set(r.clusterId, {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
    }
  }

  // Pass 1 — bundle inter-cluster edges by unordered (src, tgt) pair.
  const bundleMembers = new Map<string, GraphEdge[]>();
  const bundleGeometry = new Map<
    string,
    { srcPort: ClusterPort; tgtPort: ClusterPort }
  >();
  const classification = new Map<
    string,
    | { readonly kind: "straight" }
    | {
        readonly kind: "bundled";
        readonly bundleKey: string;
      }
  >();

  for (const edge of model.edges) {
    if (!bundlingEnabled || clusters === undefined) {
      classification.set(edge.id, { kind: "straight" });
      continue;
    }
    const srcCluster = clusters.byNode.get(edge.source);
    const tgtCluster = clusters.byNode.get(edge.target);
    if (
      srcCluster === undefined ||
      tgtCluster === undefined ||
      srcCluster === tgtCluster
    ) {
      classification.set(edge.id, { kind: "straight" });
      continue;
    }
    const srcRect = clusterRectById.get(srcCluster);
    const tgtRect = clusterRectById.get(tgtCluster);
    if (srcRect === undefined || tgtRect === undefined) {
      classification.set(edge.id, { kind: "straight" });
      continue;
    }
    const key = `${srcCluster}|${tgtCluster}`;
    if (!bundleGeometry.has(key)) {
      bundleGeometry.set(key, {
        srcPort: portTowards(srcRect, centreOf(tgtRect)),
        tgtPort: portTowards(tgtRect, centreOf(srcRect)),
      });
    }
    (bundleMembers.get(key) ?? bundleMembers.set(key, []).get(key)!).push(edge);
    classification.set(edge.id, { kind: "bundled", bundleKey: key });
  }

  // Pass 2 — emit per-edge routes.
  const edgeRoutes: EdgeRoute[] = [];
  for (const edge of model.edges) {
    const source = layout.bounds.get(edge.source);
    const target = layout.bounds.get(edge.target);
    if (source === undefined || target === undefined) continue;
    const cls = classification.get(edge.id);

    if (cls === undefined || cls.kind === "straight") {
      const fromAttach = attachPoint(
        source,
        centreOf(target).x,
        centreOf(target).y,
      );
      const toAttach = attachPoint(
        target,
        centreOf(source).x,
        centreOf(source).y,
      );
      edgeRoutes.push({
        edgeId: edge.id,
        d: smoothstepPath(fromAttach, toAttach, borderRadius),
        hint: "straight",
      });
      continue;
    }

    const geom = bundleGeometry.get(cls.bundleKey);
    if (geom === undefined) continue;
    const { srcPort, tgtPort } = geom;
    const fromAttach = attachPoint(source, srcPort.x, srcPort.y);
    const toAttach = attachPoint(target, tgtPort.x, tgtPort.y);
    const size = bundleMembers.get(cls.bundleKey)?.length ?? 1;
    if (size <= 1) {
      // Solo bundled — full path through the ports.
      edgeRoutes.push({
        edgeId: edge.id,
        d:
          smoothstepPath(fromAttach, srcPort, borderRadius) +
          " " +
          smoothstepPath(srcPort, tgtPort, borderRadius) +
          " " +
          smoothstepPath(tgtPort, toAttach, borderRadius),
        hint: "solo-bundled",
      });
    } else {
      // Bundle leaf — entry + exit legs only; trunk carries the middle.
      edgeRoutes.push({
        edgeId: edge.id,
        d:
          smoothstepPath(fromAttach, srcPort, borderRadius) +
          " " +
          smoothstepPath(tgtPort, toAttach, borderRadius),
        hint: "bundle-leaf",
      });
    }
  }

  // Pass 3 — emit one trunk per bundle with ≥2 members.
  const trunks: TrunkRoute[] = [];
  for (const [key, members] of bundleMembers) {
    if (members.length < 2) continue;
    const geom = bundleGeometry.get(key);
    if (geom === undefined) continue;
    const { srcPort, tgtPort } = geom;
    trunks.push({
      id: `trunk:${key}`,
      d: smoothstepPath(srcPort, tgtPort, borderRadius),
      edgeCount: members.length,
      dominantRelation: dominantRelationOf(members),
    });
  }

  return { edges: edgeRoutes, trunks };
};

function centreOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function dominantRelationOf(
  edges: readonly GraphEdge[],
): GraphEdge["relation"] {
  const counts = new Map<GraphEdge["relation"], number>();
  for (const e of edges) counts.set(e.relation, (counts.get(e.relation) ?? 0) + 1);
  let best = edges[0]?.relation ?? "mutates";
  let bestCount = 0;
  for (const [rel, c] of counts) {
    if (c > bestCount) {
      best = rel;
      bestCount = c;
    }
  }
  return best;
}

/* --------------------------------------------------------------------
 * smoothstep path builder
 * ------------------------------------------------------------------- */

type Sided = {
  readonly x: number;
  readonly y: number;
  readonly side: "top" | "bottom" | "left" | "right";
};

/**
 * Build a smoothstep (orthogonal with rounded corners) SVG path between
 * two sided points. Leaves/arrives perpendicular to each side; bends
 * via right angles with `radius`-rounded corners (quadratic bezier at
 * each corner so the transition feels continuous, not jagged).
 *
 * Three shapes emerge from the side combinations:
 *
 *   same axis (both horizontal / both vertical)    → Z shape, 2 corners
 *   perpendicular axes (horizontal ↔ vertical)     → L shape, 1 corner
 *
 * `exitOffset` separates source/target corners from the cards slightly
 * so edges exit cleanly without clipping the border.
 */
export function smoothstepPath(
  from: Sided,
  to: Sided,
  radius: number = 10,
  exitOffset: number = 16,
): string {
  const fDir = dir(from.side);
  const tDir = dir(to.side);

  const fOff = { x: from.x + fDir.dx * exitOffset, y: from.y + fDir.dy * exitOffset };
  const tOff = { x: to.x + tDir.dx * exitOffset, y: to.y + tDir.dy * exitOffset };

  const fAxis: "x" | "y" = fDir.dx !== 0 ? "x" : "y";
  const tAxis: "x" | "y" = tDir.dx !== 0 ? "x" : "y";

  // Waypoints always go from → fOff → corners → tOff → to.
  let mid: { x: number; y: number }[];
  if (fAxis === "x" && tAxis === "x") {
    // Z with vertical middle leg.
    const midX = (fOff.x + tOff.x) / 2;
    mid = [
      { x: midX, y: fOff.y },
      { x: midX, y: tOff.y },
    ];
  } else if (fAxis === "y" && tAxis === "y") {
    // Z with horizontal middle leg.
    const midY = (fOff.y + tOff.y) / 2;
    mid = [
      { x: fOff.x, y: midY },
      { x: tOff.x, y: midY },
    ];
  } else if (fAxis === "x" && tAxis === "y") {
    // L: horizontal then vertical.
    mid = [{ x: tOff.x, y: fOff.y }];
  } else {
    // L: vertical then horizontal.
    mid = [{ x: fOff.x, y: tOff.y }];
  }

  const waypoints = [
    { x: from.x, y: from.y },
    fOff,
    ...mid,
    tOff,
    { x: to.x, y: to.y },
  ];

  return buildRoundedPath(waypoints, radius);
}

/**
 * Given an orthogonal polyline, build an SVG path with rounded corners.
 * Corners are clamped so the rounding never exceeds half of the
 * shorter of the two adjacent segments — prevents weird overshoot on
 * short legs.
 */
function buildRoundedPath(
  points: readonly { readonly x: number; readonly y: number }[],
  radius: number,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${fx(points[0].x)} ${fx(points[0].y)}`;
  let out = `M ${fx(points[0].x)} ${fx(points[0].y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (next === undefined) {
      out += ` L ${fx(curr.x)} ${fx(curr.y)}`;
      continue;
    }
    // Segment lengths around this corner.
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.max(0, Math.min(radius, inLen / 2, outLen / 2));
    if (r === 0) {
      out += ` L ${fx(curr.x)} ${fx(curr.y)}`;
      continue;
    }
    const enter = moveAlong(curr, prev, r);
    const exit = moveAlong(curr, next, r);
    out += ` L ${fx(enter.x)} ${fx(enter.y)} Q ${fx(curr.x)} ${fx(curr.y)} ${fx(exit.x)} ${fx(exit.y)}`;
  }
  return out;
}

function moveAlong(
  from: { readonly x: number; readonly y: number },
  toward: { readonly x: number; readonly y: number },
  dist: number,
): { x: number; y: number } {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: from.x, y: from.y };
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
}

function dir(side: Sided["side"]): { dx: number; dy: number } {
  switch (side) {
    case "top":
      return { dx: 0, dy: -1 };
    case "bottom":
      return { dx: 0, dy: 1 };
    case "left":
      return { dx: -1, dy: 0 };
    case "right":
      return { dx: 1, dy: 0 };
  }
}

function fx(n: number): string {
  return n.toFixed(1);
}
