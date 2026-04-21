import type { GraphEdge, GraphModel } from "@manifesto-ai/studio-react";
import {
  attachPoint,
  edgePath,
  portTowards,
  type ClusterPort,
  type LayoutResult,
  type Rect,
} from "./layout";
import type { ClusterMap } from "./clusters";

/**
 * Edge routing abstraction.
 *
 * Routers take the graph + layout + cluster topology and return:
 *  - `edges`  — one path per edge (for the individual connection read)
 *  - `trunks` — one path per cluster pair whose bundle size ≥ 2 (for
 *               the aggregate "how many edges flow here?" read)
 *
 * EdgeLayer renders trunks beneath the individual edges. Trunks are a
 * visual aggregate — their stroke weight scales with the number of
 * edges in the bundle, so a dense cluster-pair reads as a thick river
 * without the stack of individual strokes having to do that work.
 *
 * When bundling is enabled and a cluster pair has ≥ 2 edges, the
 * individual edges in that bundle render only their entry/exit legs
 * (card → source port, target port → card) and omit the middle
 * segment — the trunk carries it. Solo edges (bundle size 1, or
 * intra-cluster, or no clusters) render a regular straight bezier.
 */

export type EdgeRouteInput = {
  readonly model: GraphModel;
  readonly layout: LayoutResult;
  readonly clusters?: ClusterMap;
  readonly options?: {
    /** When false, router falls back to straight routing everywhere. */
    readonly bundling?: boolean;
  };
};

export type EdgeRoute = {
  readonly edgeId: string;
  readonly d: string;
  readonly hint: "straight" | "solo-bundled" | "bundle-leaf";
};

export type TrunkRoute = {
  /** Stable id — `trunk:{srcCluster}|{tgtCluster}`. */
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

export const bundledPortRouter: EdgeRouter = ({
  model,
  layout,
  clusters,
  options,
}) => {
  const bundlingEnabled =
    options?.bundling !== false && clusters !== undefined;
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

  // Pass 1 — group inter-cluster edges by unordered cluster pair.
  type BundleKey = string;
  const bundleMembers = new Map<BundleKey, GraphEdge[]>();
  const bundleGeometry = new Map<
    BundleKey,
    { srcPort: ClusterPort; tgtPort: ClusterPort }
  >();
  const bundleKeyFor = (
    src: string,
    tgt: string,
  ): BundleKey => `${src}|${tgt}`;

  const classify = new Map<
    string,
    | { kind: "straight" }
    | {
        kind: "bundled";
        bundleKey: BundleKey;
        srcCluster: string;
        tgtCluster: string;
      }
  >();

  for (const edge of model.edges) {
    if (!bundlingEnabled || clusters === undefined) {
      classify.set(edge.id, { kind: "straight" });
      continue;
    }
    const srcCluster = clusters.byNode.get(edge.source);
    const tgtCluster = clusters.byNode.get(edge.target);
    if (
      srcCluster === undefined ||
      tgtCluster === undefined ||
      srcCluster === tgtCluster
    ) {
      classify.set(edge.id, { kind: "straight" });
      continue;
    }
    const srcRect = clusterRectById.get(srcCluster);
    const tgtRect = clusterRectById.get(tgtCluster);
    if (srcRect === undefined || tgtRect === undefined) {
      classify.set(edge.id, { kind: "straight" });
      continue;
    }
    const key = bundleKeyFor(srcCluster, tgtCluster);
    if (!bundleGeometry.has(key)) {
      const srcCentre = centreOf(srcRect);
      const tgtCentre = centreOf(tgtRect);
      bundleGeometry.set(key, {
        srcPort: portTowards(srcRect, tgtCentre),
        tgtPort: portTowards(tgtRect, srcCentre),
      });
    }
    const list = bundleMembers.get(key) ?? [];
    list.push(edge);
    bundleMembers.set(key, list);
    classify.set(edge.id, {
      kind: "bundled",
      bundleKey: key,
      srcCluster,
      tgtCluster,
    });
  }

  // Pass 2 — emit edge routes. A bundled edge with bundle size 1 still
  // draws the full three-segment path (no trunk, no aggregate).
  const edgeRoutes: EdgeRoute[] = [];
  for (const edge of model.edges) {
    const cls = classify.get(edge.id);
    const source = layout.bounds.get(edge.source);
    const target = layout.bounds.get(edge.target);
    if (source === undefined || target === undefined) continue;

    if (cls === undefined || cls.kind === "straight") {
      const fromAttach = attachPoint(source, centreOf(target).x, centreOf(target).y);
      const toAttach = attachPoint(target, centreOf(source).x, centreOf(source).y);
      edgeRoutes.push({
        edgeId: edge.id,
        d: edgePath(fromAttach, toAttach),
        hint: "straight",
      });
      continue;
    }

    const geom = bundleGeometry.get(cls.bundleKey);
    if (geom === undefined) {
      // Shouldn't happen — classify sets bundled only when geom exists.
      continue;
    }
    const { srcPort, tgtPort } = geom;
    const fromAttach = attachPoint(source, srcPort.x, srcPort.y);
    const toAttach = attachPoint(target, tgtPort.x, tgtPort.y);
    const bundleSize = bundleMembers.get(cls.bundleKey)?.length ?? 1;
    if (bundleSize <= 1) {
      // Solo bundled — full 3-segment path (we still benefit from
      // perpendicular port entry/exit even without an aggregate trunk).
      edgeRoutes.push({
        edgeId: edge.id,
        d: fullPortPath(fromAttach, toAttach, srcPort, tgtPort),
        hint: "solo-bundled",
      });
    } else {
      // Leaf-only — entry + exit legs. The middle port→port span is
      // carried by the trunk emitted below.
      edgeRoutes.push({
        edgeId: edge.id,
        d: leafPortPath(fromAttach, toAttach, srcPort, tgtPort),
        hint: "bundle-leaf",
      });
    }
  }

  // Pass 3 — emit one trunk per bundle with ≥ 2 members.
  const trunks: TrunkRoute[] = [];
  for (const [key, members] of bundleMembers) {
    if (members.length < 2) continue;
    const geom = bundleGeometry.get(key);
    if (geom === undefined) continue;
    const { srcPort, tgtPort } = geom;
    const dominant = dominantRelationOf(members);
    trunks.push({
      id: `trunk:${key}`,
      d: trunkPath(srcPort, tgtPort),
      edgeCount: members.length,
      dominantRelation: dominant,
    });
  }

  return { edges: edgeRoutes, trunks };
};

function centreOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function dominantRelationOf(edges: readonly GraphEdge[]): GraphEdge["relation"] {
  const counts = new Map<GraphEdge["relation"], number>();
  for (const e of edges) counts.set(e.relation, (counts.get(e.relation) ?? 0) + 1);
  let best: GraphEdge["relation"] = edges[0]?.relation ?? "mutates";
  let bestCount = 0;
  for (const [rel, c] of counts) {
    if (c > bestCount) {
      best = rel;
      bestCount = c;
    }
  }
  return best;
}

const EXIT_HANDLE = 48;
const PORT_HANDLE = 40;

function offsetForSide(
  side: "top" | "bottom" | "left" | "right",
): { dx: number; dy: number } {
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

/** Full port path: card → srcPort → tgtPort → card (3 cubic segments). */
function fullPortPath(
  fromAttach: ReturnType<typeof attachPoint>,
  toAttach: ReturnType<typeof attachPoint>,
  srcPort: ClusterPort,
  tgtPort: ClusterPort,
): string {
  return (
    entryLeg(fromAttach, srcPort) +
    " " +
    trunkCurve(srcPort, tgtPort) +
    " " +
    exitLeg(tgtPort, toAttach)
  );
}

/** Entry + exit legs only (two disjoint subpaths via `M` break). */
function leafPortPath(
  fromAttach: ReturnType<typeof attachPoint>,
  toAttach: ReturnType<typeof attachPoint>,
  srcPort: ClusterPort,
  tgtPort: ClusterPort,
): string {
  return entryLeg(fromAttach, srcPort) + " " + exitLeg(tgtPort, toAttach);
}

/** Just the port→port middle — what the trunk aggregate renders. */
function trunkPath(srcPort: ClusterPort, tgtPort: ClusterPort): string {
  return `M ${fx(srcPort.x)} ${fx(srcPort.y)} ${trunkCurve(srcPort, tgtPort).replace(/^C/, "C")}`;
}

function entryLeg(
  fromAttach: ReturnType<typeof attachPoint>,
  srcPort: ClusterPort,
): string {
  const fromOff = offsetForSide(fromAttach.side);
  const srcOut = offsetForSide(srcPort.side);
  const c1x = fromAttach.x + fromOff.dx * EXIT_HANDLE;
  const c1y = fromAttach.y + fromOff.dy * EXIT_HANDLE;
  const c2x = srcPort.x - srcOut.dx * PORT_HANDLE;
  const c2y = srcPort.y - srcOut.dy * PORT_HANDLE;
  return `M ${fx(fromAttach.x)} ${fx(fromAttach.y)} C ${fx(c1x)} ${fx(c1y)}, ${fx(c2x)} ${fx(c2y)}, ${fx(srcPort.x)} ${fx(srcPort.y)}`;
}

function exitLeg(
  tgtPort: ClusterPort,
  toAttach: ReturnType<typeof attachPoint>,
): string {
  const tgtIn = offsetForSide(tgtPort.side);
  const toOff = offsetForSide(toAttach.side);
  const c1x = tgtPort.x - tgtIn.dx * PORT_HANDLE;
  const c1y = tgtPort.y - tgtIn.dy * PORT_HANDLE;
  const c2x = toAttach.x + toOff.dx * EXIT_HANDLE;
  const c2y = toAttach.y + toOff.dy * EXIT_HANDLE;
  return `M ${fx(tgtPort.x)} ${fx(tgtPort.y)} C ${fx(c1x)} ${fx(c1y)}, ${fx(c2x)} ${fx(c2y)}, ${fx(toAttach.x)} ${fx(toAttach.y)}`;
}

/** Port-to-port middle. Used inside full path and as the trunk path. */
function trunkCurve(srcPort: ClusterPort, tgtPort: ClusterPort): string {
  const srcOut = offsetForSide(srcPort.side);
  const tgtIn = offsetForSide(tgtPort.side);
  const trunkLen = Math.hypot(tgtPort.x - srcPort.x, tgtPort.y - srcPort.y);
  const trunkHandle = Math.max(24, Math.min(trunkLen * 0.45, 120));
  const b1x = srcPort.x + srcOut.dx * trunkHandle;
  const b1y = srcPort.y + srcOut.dy * trunkHandle;
  const b2x = tgtPort.x + tgtIn.dx * trunkHandle;
  const b2y = tgtPort.y + tgtIn.dy * trunkHandle;
  return `C ${fx(b1x)} ${fx(b1y)}, ${fx(b2x)} ${fx(b2y)}, ${fx(tgtPort.x)} ${fx(tgtPort.y)}`;
}

function fx(n: number): string {
  return n.toFixed(1);
}
