import type { GraphModel, GraphNode } from "@manifesto-ai/studio-react";
import type { ClusterMap } from "./clusters";

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type LayoutResult = {
  readonly bounds: ReadonlyMap<GraphNode["id"], Rect>;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /**
   * Per-cluster bounding rectangles, derived from member card
   * positions. `undefined` when no clusters were supplied to
   * `computeLayout`. Rendered as a subtle dashed boundary.
   */
  readonly clusterRects?: readonly ClusterRect[];
};

/**
 * Card dimensions — cards are rectangular, readable-at-a-glance surfaces.
 * Width stays fixed so the eye has stable column grids in state/computed
 * zones. Heights can grow with content but we use one standard height
 * for layout math.
 */
export const CARD_WIDTH = 196;
export const CARD_HEIGHT = 82;
export const GAP = 20;
/** Extra vertical room between clusters so the boundary is visible. */
export const INTER_CLUSTER_GAP = 28;
export const ZONE_MARGIN = 28;

/**
 * A cluster's rectangle in canvas coords (used by LiveGraph to render
 * a dashed boundary). Covers all member cards laid out in the state +
 * computed columns, padded slightly.
 */
export type ClusterRect = {
  readonly clusterId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Spatial grammar — Manifesto's three node kinds fall into natural roles
 * that collapse to a simple 3-zone layout:
 *
 *   actions   (top)     — external inputs flowing IN
 *   state     (left)    — the source of truth
 *   computed  (right)   — deterministic derivations flowing OUT
 *
 * Edges therefore read as a river: actions descend → states → computeds.
 * This is intentional and should feel obvious once you see it: the
 * graph literally maps "inputs top → truth left → derivations right".
 */
export function computeLayout(
  model: GraphModel,
  containerWidth: number,
  containerHeight: number,
  clusters?: ClusterMap,
): LayoutResult {
  const actions = model.nodes.filter((n) => n.kind === "action");
  const states = model.nodes.filter((n) => n.kind === "state");
  const computeds = model.nodes.filter((n) => n.kind === "computed");

  // Cluster ordering: preserve the ClusterMap order (largest first).
  // If no clusters provided, pretend everything's a single cluster so
  // the existing column math still runs unchanged.
  const initialStateGroups = clusters
    ? clusters.clusters.map((c) =>
        states.filter((s) => c.states.includes(s.id)),
      )
    : [states];
  const initialComputedGroups = clusters
    ? clusters.clusters.map((c) =>
        computeds.filter((cn) => c.computeds.includes(cn.id)),
      )
    : [computeds];

  // Reorder within each cluster + the action strip so neighbours line
  // up across columns. Barycenter heuristic (a lightweight slice of
  // dagre's Sugiyama pass) — each node's score is the mean rank of its
  // connected neighbours in the adjacent columns; sort within-cluster
  // by that score; repeat 3× to propagate. This is the standard
  // crossing-minimisation step every layered layout toolkit runs.
  const reordered = reorderForCrossings(
    model,
    initialStateGroups,
    initialComputedGroups,
    actions,
    3,
  );
  const stateGroups = reordered.stateGroups;
  const computedGroups = reordered.computedGroups;
  const orderedActions = reordered.actions;

  // Zone x-coordinates. State column is fixed on the left. The action
  // strip occupies the middle channel; computed column is pushed out to
  // the right, either by container width (lots of slack) or by the
  // action strip's natural extent (narrow container). This guarantees
  // action cards never overlap and the graph scrolls when needed.
  const leftColX = ZONE_MARGIN;
  const actionZoneLeft = leftColX + CARD_WIDTH + GAP * 2;
  const actionCols = actions.length;
  const actionNaturalWidth =
    actionCols === 0
      ? 0
      : actionCols * CARD_WIDTH + Math.max(0, actionCols - 1) * GAP;
  const naturalRightColX = Math.max(
    actionZoneLeft + actionNaturalWidth + GAP * 2,
    leftColX + CARD_WIDTH + GAP * 2,
  );
  const containerRightColX = containerWidth - CARD_WIDTH - ZONE_MARGIN;
  const rightColX = Math.max(naturalRightColX, containerRightColX);

  const actionZoneRight = rightColX - GAP * 2;
  const actionZoneWidth = Math.max(
    CARD_WIDTH,
    Math.max(actionNaturalWidth, actionZoneRight - actionZoneLeft),
  );
  const actionSpacing =
    actionCols <= 1
      ? 0
      : (actionZoneWidth - CARD_WIDTH) / (actionCols - 1);

  const topStripY = ZONE_MARGIN;
  const contentTop = topStripY + CARD_HEIGHT + GAP * 1.5;

  const bounds = new Map<GraphNode["id"], Rect>();

  // --- Actions strip ----------------------------------------------------
  orderedActions.forEach((node, i) => {
    const x =
      actionCols <= 1
        ? actionZoneLeft + (actionZoneWidth - CARD_WIDTH) / 2
        : actionZoneLeft + i * actionSpacing;
    bounds.set(node.id, {
      x,
      y: topStripY,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    });
  });

  // --- State / Computed columns ---------------------------------------
  //
  // Cluster-aware: each cluster gets a contiguous vertical block in
  // both the state column and the computed column, with an extra
  // INTER_CLUSTER_GAP of whitespace between consecutive clusters so
  // the boundary reads visually. Intra-cluster stacking reuses the
  // standard GAP.
  const columnAvailable = Math.max(
    CARD_HEIGHT,
    containerHeight - contentTop - ZONE_MARGIN,
  );
  const layoutColumn = (
    groups: readonly (readonly GraphNode[])[],
    x: number,
    clusterY: number[],
    clusterBottomY: number[],
  ): void => {
    // Total height of the column with intra + inter gaps applied.
    const nonEmpty = groups.filter((g) => g.length > 0);
    const totalCards = nonEmpty.reduce((n, g) => n + g.length, 0);
    if (totalCards === 0) return;
    const intra = nonEmpty.reduce(
      (n, g) => n + Math.max(0, g.length - 1) * GAP,
      0,
    );
    const inter = Math.max(0, nonEmpty.length - 1) * INTER_CLUSTER_GAP;
    const totalHeight = totalCards * CARD_HEIGHT + intra + inter;
    let y = contentTop + Math.max(0, (columnAvailable - totalHeight) / 2);
    groups.forEach((g, gi) => {
      if (g.length === 0) {
        clusterY[gi] = y;
        clusterBottomY[gi] = y;
        return;
      }
      clusterY[gi] = y;
      g.forEach((node) => {
        bounds.set(node.id, {
          x,
          y,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
        });
        y += CARD_HEIGHT + GAP;
      });
      // Step back the trailing GAP — the last card doesn't need one.
      y -= GAP;
      clusterBottomY[gi] = y + CARD_HEIGHT;
      // Inter-cluster separator.
      y += CARD_HEIGHT + INTER_CLUSTER_GAP;
    });
  };

  const clusterCount = Math.max(stateGroups.length, computedGroups.length);
  const stateClusterTop: number[] = new Array(clusterCount).fill(0);
  const stateClusterBot: number[] = new Array(clusterCount).fill(0);
  const compClusterTop: number[] = new Array(clusterCount).fill(0);
  const compClusterBot: number[] = new Array(clusterCount).fill(0);
  layoutColumn(stateGroups, leftColX, stateClusterTop, stateClusterBot);
  layoutColumn(computedGroups, rightColX, compClusterTop, compClusterBot);

  // Final canvas size = max extents of placed cards + margin.
  let maxX = containerWidth;
  let maxY = containerHeight;
  for (const rect of bounds.values()) {
    maxX = Math.max(maxX, rect.x + rect.width + ZONE_MARGIN);
    maxY = Math.max(maxY, rect.y + rect.height + ZONE_MARGIN);
  }

  // Cluster rectangles — union of the state + computed sub-columns for
  // each cluster, padded. Only emitted when a ClusterMap was supplied.
  let clusterRects: ClusterRect[] | undefined;
  if (clusters) {
    clusterRects = [];
    const padX = 10;
    const padY = 8;
    const leftWithPad = leftColX - padX;
    const rightEdge = rightColX + CARD_WIDTH + padX;
    for (let i = 0; i < clusters.clusters.length; i += 1) {
      const c = clusters.clusters[i];
      const hasState = c.states.length > 0;
      const hasComp = c.computeds.length > 0;
      if (!hasState && !hasComp) continue;
      const top = Math.min(
        hasState ? stateClusterTop[i] : Number.POSITIVE_INFINITY,
        hasComp ? compClusterTop[i] : Number.POSITIVE_INFINITY,
      );
      const bot = Math.max(
        hasState ? stateClusterBot[i] : Number.NEGATIVE_INFINITY,
        hasComp ? compClusterBot[i] : Number.NEGATIVE_INFINITY,
      );
      clusterRects.push({
        clusterId: c.id,
        x: leftWithPad,
        y: top - padY,
        width: rightEdge - leftWithPad,
        height: bot - top + padY * 2,
      });
    }
  }

  return {
    bounds,
    canvasWidth: maxX,
    canvasHeight: maxY,
    clusterRects,
  };
}

/**
 * Minimise edge crossings between adjacent columns via barycenter sort.
 *
 * For each kind-column we compute `rank(node) = mean rank of connected
 * neighbours in the other columns`, then stable-sort within cluster by
 * that score. Three iterations propagate the effect across action ↔
 * state ↔ computed so the whole layered graph settles.
 *
 * This is the exact heuristic dagre / ELK / Graphviz-dot use as their
 * crossing-minimisation step — dropping it in directly (rather than
 * importing dagre) keeps the project's cluster concept and 3-zone
 * grammar intact and avoids the 50kB dependency.
 */
export function reorderForCrossings(
  model: GraphModel,
  stateGroups: readonly (readonly GraphNode[])[],
  computedGroups: readonly (readonly GraphNode[])[],
  actions: readonly GraphNode[],
  iterations: number,
): {
  readonly stateGroups: readonly GraphNode[][];
  readonly computedGroups: readonly GraphNode[][];
  readonly actions: readonly GraphNode[];
} {
  const neighbours = buildNeighbourIndex(model);
  let stateOrder = stateGroups.map((g) => [...g]);
  let compOrder = computedGroups.map((g) => [...g]);
  let actionOrder = [...actions];

  for (let i = 0; i < iterations; i += 1) {
    // Rank snapshots before this pass — sorting reads ranks computed
    // from the previous pass, not the in-progress one, so the pass is
    // deterministic regardless of iteration order.
    const stateRank = rankMap(stateOrder.flat());
    const compRank = rankMap(compOrder.flat());
    const actionRank = rankMap(actionOrder);

    // Re-sort state clusters by mean rank of connected actions (above)
    // and computeds (right). Both contribute equally.
    stateOrder = stateOrder.map((group) =>
      stableSortBy(group, (s) =>
        meanRank(s.id, neighbours, [actionRank, compRank]),
      ),
    );

    const nextStateRank = rankMap(stateOrder.flat());

    // Re-sort computed clusters by mean state rank.
    compOrder = compOrder.map((group) =>
      stableSortBy(group, (c) =>
        meanRank(c.id, neighbours, [nextStateRank]),
      ),
    );

    // Re-sort actions globally by mean state rank (state is the
    // primary target column for "mutates"). Cluster boundaries aren't
    // enforced for actions — the strip is a flat horizontal channel.
    actionOrder = stableSortBy(actionOrder, (a) =>
      meanRank(a.id, neighbours, [nextStateRank]),
    );
  }

  return {
    stateGroups: stateOrder,
    computedGroups: compOrder,
    actions: actionOrder,
  };
}

function buildNeighbourIndex(
  model: GraphModel,
): ReadonlyMap<GraphNode["id"], readonly GraphNode["id"][]> {
  const map = new Map<GraphNode["id"], GraphNode["id"][]>();
  const push = (a: GraphNode["id"], b: GraphNode["id"]): void => {
    const list = map.get(a);
    if (list === undefined) map.set(a, [b]);
    else list.push(b);
  };
  for (const e of model.edges) {
    push(e.source, e.target);
    push(e.target, e.source);
  }
  return map;
}

function rankMap(
  nodes: readonly GraphNode[],
): ReadonlyMap<GraphNode["id"], number> {
  const map = new Map<GraphNode["id"], number>();
  nodes.forEach((n, i) => map.set(n.id, i));
  return map;
}

function meanRank(
  id: GraphNode["id"],
  neighbours: ReadonlyMap<GraphNode["id"], readonly GraphNode["id"][]>,
  ranks: readonly ReadonlyMap<GraphNode["id"], number>[],
): number {
  const nbs = neighbours.get(id);
  if (nbs === undefined || nbs.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let count = 0;
  for (const nb of nbs) {
    for (const m of ranks) {
      const r = m.get(nb);
      if (r !== undefined) {
        sum += r;
        count += 1;
        break;
      }
    }
  }
  if (count === 0) return Number.POSITIVE_INFINITY;
  return sum / count;
}

function stableSortBy<T>(arr: readonly T[], key: (t: T) => number): T[] {
  // Map to (value, origIndex) so ties retain input order — V8's sort
  // is stable but belt-and-suspenders for older engines / tests.
  return arr
    .map((v, i) => ({ v, i, k: key(v) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
    .map((x) => x.v);
}

/**
 * Focus-specific layout — the focused node goes to the viewport center;
 * its 1-hop neighbours fan out by kind into the same spatial grammar
 * the base layout uses, but rotated around the focus:
 *
 *   state neighbours   → left column
 *   computed neighbours→ right column
 *   action neighbours  → top strip
 *
 * Semantically this mirrors the base "inputs top → truth left →
 * derivations right" grammar, just re-anchored on whatever the user is
 * looking at. For any focus kind the neighbours keep their directional
 * meaning, so the focus card at the center reads as a "junction" and
 * edges flow in/out at the expected angles.
 */
export function computeFocusLayout(
  model: GraphModel,
  focusNodeId: GraphNode["id"],
  containerWidth: number,
  containerHeight: number,
): LayoutResult {
  const focus = model.nodesById.get(focusNodeId);
  if (focus === undefined) {
    return computeLayout(model, containerWidth, containerHeight);
  }
  const others = model.nodes.filter((n) => n.id !== focusNodeId);
  const topActions = others.filter((n) => n.kind === "action");
  const leftStates = others.filter((n) => n.kind === "state");
  const rightComputeds = others.filter((n) => n.kind === "computed");

  // Adaptive canvas — grow with neighbour count so cards never overlap
  // even when a single focus has many connections. The camera fit pass
  // downstream (LiveGraph) zooms the canvas into the viewport, and
  // semantic zoom collapses card detail at low k, so "big canvas +
  // zoomed out" is a clean read rather than an overflow.
  const stackHeight = (count: number): number =>
    count === 0 ? 0 : count * CARD_HEIGHT + (count - 1) * GAP;
  const stripWidth = (count: number): number =>
    count === 0 ? 0 : count * CARD_WIDTH + (count - 1) * GAP;

  const verticalNeed =
    CARD_HEIGHT + // focus card
    GAP * 6 + // breathing room around focus
    Math.max(stackHeight(leftStates.length), stackHeight(rightComputeds.length));
  const horizontalNeed =
    CARD_WIDTH + // focus card
    GAP * 8 + // left gutter + right gutter + separation
    Math.max(CARD_WIDTH * 2, stripWidth(topActions.length));

  const W = Math.max(containerWidth, horizontalNeed);
  const H = Math.max(containerHeight, verticalNeed);
  const cx = W / 2;
  const cy = H / 2;
  const focusX = cx - CARD_WIDTH / 2;
  const focusY = cy - CARD_HEIGHT / 2;

  const bounds = new Map<GraphNode["id"], Rect>();
  bounds.set(focus.id, {
    x: focusX,
    y: focusY,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });

  // Left column — state neighbours. Separation from the focus uses
  // GAP*3 so edges have breathing room and arrows don't collide with
  // the focus card border.
  const leftColX = Math.max(ZONE_MARGIN, focusX - CARD_WIDTH - GAP * 3);
  const leftHeight =
    leftStates.length * CARD_HEIGHT + Math.max(0, leftStates.length - 1) * GAP;
  const leftStartY = cy - leftHeight / 2;
  leftStates.forEach((n, i) => {
    bounds.set(n.id, {
      x: leftColX,
      y: leftStartY + i * (CARD_HEIGHT + GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    });
  });

  // Right column — computed neighbours.
  const rightColX = Math.min(
    W - CARD_WIDTH - ZONE_MARGIN,
    focusX + CARD_WIDTH + GAP * 3,
  );
  const rightHeight =
    rightComputeds.length * CARD_HEIGHT +
    Math.max(0, rightComputeds.length - 1) * GAP;
  const rightStartY = cy - rightHeight / 2;
  rightComputeds.forEach((n, i) => {
    bounds.set(n.id, {
      x: rightColX,
      y: rightStartY + i * (CARD_HEIGHT + GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    });
  });

  // Top strip — action neighbours, centered above the focus card.
  const topCount = topActions.length;
  const topTotalWidth =
    topCount * CARD_WIDTH + Math.max(0, topCount - 1) * GAP;
  const topStartX = cx - topTotalWidth / 2;
  const topY = Math.max(ZONE_MARGIN, focusY - CARD_HEIGHT - GAP * 3);
  topActions.forEach((n, i) => {
    bounds.set(n.id, {
      x: topStartX + i * (CARD_WIDTH + GAP),
      y: topY,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    });
  });

  let maxX = W;
  let maxY = H;
  for (const rect of bounds.values()) {
    maxX = Math.max(maxX, rect.x + rect.width + ZONE_MARGIN);
    maxY = Math.max(maxY, rect.y + rect.height + ZONE_MARGIN);
  }
  return { bounds, canvasWidth: maxX, canvasHeight: maxY };
}

/**
 * Compute an attach point on a rect for edges. Chooses the side of the
 * card closest to the target point, snapped to the card's midpoint on
 * that side so edges always leave cards perpendicularly.
 */
export function attachPoint(
  rect: Rect,
  targetX: number,
  targetY: number,
): { readonly x: number; readonly y: number; readonly side: "top" | "bottom" | "left" | "right" } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  // Use rect aspect ratio to decide between horizontal vs vertical exit.
  const absRatioX = Math.abs(dx) / (rect.width / 2);
  const absRatioY = Math.abs(dy) / (rect.height / 2);

  if (absRatioX > absRatioY) {
    return dx > 0
      ? { x: rect.x + rect.width, y: cy, side: "right" }
      : { x: rect.x, y: cy, side: "left" };
  }
  return dy > 0
    ? { x: cx, y: rect.y + rect.height, side: "bottom" }
    : { x: cx, y: rect.y, side: "top" };
}

/**
 * Cluster port — the point on a cluster rect's boundary where all
 * inter-cluster edges with the same neighbour cluster pass through.
 * Computed as the intersection of the line from the source cluster's
 * centre to the target cluster's centre with the source cluster's
 * rect boundary. `side` records which face of the rect was hit so
 * callers can set exit/entry tangents perpendicular to the boundary.
 */
export type ClusterPort = {
  readonly x: number;
  readonly y: number;
  readonly side: "top" | "bottom" | "left" | "right";
};

/**
 * Compute the port on `rect` facing `target`. Ray casts from rect
 * centre toward `target` and clips to the rect perimeter. Result lies
 * on the rect boundary unless `target` is exactly the rect centre, in
 * which case we return the right-edge midpoint as a safe fallback.
 */
export function portTowards(
  rect: Rect,
  target: { readonly x: number; readonly y: number },
): ClusterPort {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) {
    return { x: rect.x + rect.width, y: cy, side: "right" };
  }
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  // Aspect-aware side pick — use the dimension whose ratio is larger.
  const horizontalDominates = Math.abs(dx) * hh > Math.abs(dy) * hw;
  if (horizontalDominates) {
    const sign = dx > 0 ? 1 : -1;
    const t = hw / Math.abs(dx);
    return {
      x: cx + sign * hw,
      y: cy + dy * t,
      side: sign > 0 ? "right" : "left",
    };
  }
  const sign = dy > 0 ? 1 : -1;
  const t = hh / Math.abs(dy);
  return {
    x: cx + dx * t,
    y: cy + sign * hh,
    side: sign > 0 ? "bottom" : "top",
  };
}

