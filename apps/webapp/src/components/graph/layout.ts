import type { GraphModel, GraphNode } from "@manifesto-ai/studio-react";

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
export const ZONE_MARGIN = 28;

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
): LayoutResult {
  const actions = model.nodes.filter((n) => n.kind === "action");
  const states = model.nodes.filter((n) => n.kind === "state");
  const computeds = model.nodes.filter((n) => n.kind === "computed");

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
  actions.forEach((node, i) => {
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

  // --- State column -----------------------------------------------------
  //
  // Stack vertically, centered in the remaining vertical space.
  const columnAvailable = Math.max(
    CARD_HEIGHT,
    containerHeight - contentTop - ZONE_MARGIN,
  );
  const statesHeight =
    states.length * CARD_HEIGHT + Math.max(0, states.length - 1) * GAP;
  const stateStartY =
    contentTop + Math.max(0, (columnAvailable - statesHeight) / 2);
  states.forEach((node, i) => {
    bounds.set(node.id, {
      x: leftColX,
      y: stateStartY + i * (CARD_HEIGHT + GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    });
  });

  // --- Computed column --------------------------------------------------
  const computedsHeight =
    computeds.length * CARD_HEIGHT + Math.max(0, computeds.length - 1) * GAP;
  const computedStartY =
    contentTop + Math.max(0, (columnAvailable - computedsHeight) / 2);
  computeds.forEach((node, i) => {
    bounds.set(node.id, {
      x: rightColX,
      y: computedStartY + i * (CARD_HEIGHT + GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    });
  });

  // Final canvas size = max extents of placed cards + margin.
  let maxX = containerWidth;
  let maxY = containerHeight;
  for (const rect of bounds.values()) {
    maxX = Math.max(maxX, rect.x + rect.width + ZONE_MARGIN);
    maxY = Math.max(maxY, rect.y + rect.height + ZONE_MARGIN);
  }

  return {
    bounds,
    canvasWidth: maxX,
    canvasHeight: maxY,
  };
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

  const W = Math.max(containerWidth, CARD_WIDTH * 3 + GAP * 8);
  const H = Math.max(containerHeight, CARD_HEIGHT * 4 + GAP * 8);
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
 * Cubic bezier SVG path between two attach points, with control points
 * extended perpendicular to each exit side so the curve leaves each
 * card cleanly.
 */
export function edgePath(
  from: ReturnType<typeof attachPoint>,
  to: ReturnType<typeof attachPoint>,
): string {
  const fromOffset = offsetFor(from.side);
  const toOffset = offsetFor(to.side);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const handle = Math.max(40, Math.min(140, dist * 0.45));

  const c1x = from.x + fromOffset.dx * handle;
  const c1y = from.y + fromOffset.dy * handle;
  const c2x = to.x + toOffset.dx * handle;
  const c2y = to.y + toOffset.dy * handle;

  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function offsetFor(side: "top" | "bottom" | "left" | "right"): {
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
