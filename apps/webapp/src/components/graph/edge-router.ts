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
 * An `EdgeRouter` is a pure function that takes the graph model and
 * layout (plus cluster topology if any) and returns one SVG path per
 * edge. EdgeLayer just renders whatever the router hands back, so we
 * can swap routing strategies — straight-only, port-bundled,
 * orthogonal, dagre-imported — without touching the render code.
 *
 * Current implementation: `bundledPortRouter`.
 *   - intra-cluster edges → straight cubic bezier (existing `edgePath`)
 *   - inter-cluster edges → port-to-port path: source card → source
 *     cluster exit port → target cluster entry port → target card.
 *     All edges between the same cluster pair share both ports, so
 *     they visually merge into a single trunk between the clusters
 *     (Holten-style hierarchical edge bundling, simplified).
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
  readonly hint: "straight" | "bundled";
};

export type EdgeRouter = (input: EdgeRouteInput) => readonly EdgeRoute[];

/**
 * Default router — intra-cluster straight bezier + inter-cluster
 * port-based bundling. When clusters are absent or bundling is
 * disabled, falls back to straight everywhere.
 */
export const bundledPortRouter: EdgeRouter = ({
  model,
  layout,
  clusters,
  options,
}) => {
  const bundlingEnabled = options?.bundling !== false && clusters !== undefined;
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

  const out: EdgeRoute[] = [];
  for (const edge of model.edges) {
    const source = layout.bounds.get(edge.source);
    const target = layout.bounds.get(edge.target);
    if (source === undefined || target === undefined) continue;

    const srcCluster = bundlingEnabled ? clusters!.byNode.get(edge.source) : undefined;
    const tgtCluster = bundlingEnabled ? clusters!.byNode.get(edge.target) : undefined;

    if (
      bundlingEnabled &&
      srcCluster !== undefined &&
      tgtCluster !== undefined &&
      srcCluster !== tgtCluster
    ) {
      const srcRect = clusterRectById.get(srcCluster);
      const tgtRect = clusterRectById.get(tgtCluster);
      if (srcRect !== undefined && tgtRect !== undefined) {
        const srcCentre = centreOf(srcRect);
        const tgtCentre = centreOf(tgtRect);
        const srcPort = portTowards(srcRect, tgtCentre);
        const tgtPort = portTowards(tgtRect, srcCentre);
        const fromAttach = attachPoint(source, srcPort.x, srcPort.y);
        const toAttach = attachPoint(target, tgtPort.x, tgtPort.y);
        out.push({
          edgeId: edge.id,
          d: portBundledPath(fromAttach, toAttach, srcPort, tgtPort),
          hint: "bundled",
        });
        continue;
      }
    }

    // Straight bezier fallback (intra-cluster / unclustered / bundling off).
    const targetCentre = centreOf(target);
    const sourceCentre = centreOf(source);
    const fromAttach = attachPoint(source, targetCentre.x, targetCentre.y);
    const toAttach = attachPoint(target, sourceCentre.x, sourceCentre.y);
    out.push({
      edgeId: edge.id,
      d: edgePath(fromAttach, toAttach),
      hint: "straight",
    });
  }
  return out;
};

function centreOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Three-segment cubic bezier: card attach → cluster exit port →
 * cluster entry port → card attach. Exit/entry tangents are
 * perpendicular to the cluster boundary (from the port's `side`), so
 * edges leave and arrive cleanly against the rect. The middle leg is
 * a near-straight cubic between the two ports — that's where every
 * edge in a cluster pair visually overlaps to form the trunk.
 */
function portBundledPath(
  fromAttach: ReturnType<typeof attachPoint>,
  toAttach: ReturnType<typeof attachPoint>,
  srcPort: ClusterPort,
  tgtPort: ClusterPort,
): string {
  const exitHandle = 48;
  const portHandle = 40;

  const fromOff = offsetForCardSide(fromAttach.side);
  const toOff = offsetForCardSide(toAttach.side);
  const srcPortOut = offsetForPortSide(srcPort.side);
  const tgtPortIn = offsetForPortSide(tgtPort.side);

  // Leg 1 — card attach → source port. Out tangent leaves card
  // perpendicular; in tangent arrives at port along the port's
  // outward normal.
  const a1x = fromAttach.x + fromOff.dx * exitHandle;
  const a1y = fromAttach.y + fromOff.dy * exitHandle;
  const a2x = srcPort.x - srcPortOut.dx * portHandle;
  const a2y = srcPort.y - srcPortOut.dy * portHandle;

  // Leg 2 — source port → target port. Tangents along each port's
  // outward normal so the trunk leaves src perpendicular and arrives
  // at tgt perpendicular. Control points nudged 50% of the port gap.
  const trunkLen = Math.hypot(tgtPort.x - srcPort.x, tgtPort.y - srcPort.y);
  const trunkHandle = Math.max(24, Math.min(trunkLen * 0.45, 120));
  const b1x = srcPort.x + srcPortOut.dx * trunkHandle;
  const b1y = srcPort.y + srcPortOut.dy * trunkHandle;
  const b2x = tgtPort.x + tgtPortIn.dx * trunkHandle;
  const b2y = tgtPort.y + tgtPortIn.dy * trunkHandle;

  // Leg 3 — target port → target card attach.
  const c1x = tgtPort.x - tgtPortIn.dx * portHandle;
  const c1y = tgtPort.y - tgtPortIn.dy * portHandle;
  const c2x = toAttach.x + toOff.dx * exitHandle;
  const c2y = toAttach.y + toOff.dy * exitHandle;

  return (
    `M ${fx(fromAttach.x)} ${fx(fromAttach.y)} ` +
    `C ${fx(a1x)} ${fx(a1y)}, ${fx(a2x)} ${fx(a2y)}, ${fx(srcPort.x)} ${fx(srcPort.y)} ` +
    `C ${fx(b1x)} ${fx(b1y)}, ${fx(b2x)} ${fx(b2y)}, ${fx(tgtPort.x)} ${fx(tgtPort.y)} ` +
    `C ${fx(c1x)} ${fx(c1y)}, ${fx(c2x)} ${fx(c2y)}, ${fx(toAttach.x)} ${fx(toAttach.y)}`
  );
}

function offsetForCardSide(side: "top" | "bottom" | "left" | "right"): {
  dx: number;
  dy: number;
} {
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

/** Port side tangent = outward normal of the cluster rect face. */
function offsetForPortSide(side: ClusterPort["side"]): { dx: number; dy: number } {
  return offsetForCardSide(side);
}

function fx(n: number): string {
  return n.toFixed(1);
}
