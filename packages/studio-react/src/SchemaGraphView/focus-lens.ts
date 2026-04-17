import type { SourceSpan } from "@manifesto-ai/studio-core";
import type { GraphEdge, GraphModel, GraphNode, GraphNodeId } from "./graph-model.js";

export type GraphFocusOrigin = "editor" | "graph";

export type GraphFocusGroupLabel =
  | "Mutates"
  | "Unlocks"
  | "Feeds Into"
  | "Depends On"
  | "Unlocked By"
  | "Mutated By";

export type GraphFocusGroup = {
  readonly label: GraphFocusGroupLabel;
  readonly nodeIds: readonly GraphNodeId[];
  readonly edgeIds: readonly string[];
};

export type GraphFocusLens = {
  readonly origin: GraphFocusOrigin;
  readonly signature: string;
  readonly rootNodeIds: readonly GraphNodeId[];
  readonly nodeIds: readonly GraphNodeId[];
  readonly edgeIds: readonly string[];
  readonly groups: readonly GraphFocusGroup[];
};

const GROUP_ORDER: readonly GraphFocusGroupLabel[] = [
  "Mutates",
  "Unlocks",
  "Feeds Into",
  "Depends On",
  "Unlocked By",
  "Mutated By",
];

export function resolveFocusRoots(
  model: GraphModel | null,
  selection: SourceSpan | null,
): readonly GraphNode[] {
  if (model === null || selection === null) return [];
  const normalized = normalizeSpan(selection);
  const collapsed = comparePos(normalized.start, normalized.end) === 0;
  const nodesWithSpan = model.nodes.filter(
    (node) => node.sourceSpan !== null,
  ) as GraphNode[];

  if (collapsed) {
    const point = normalized.start;
    const containing = nodesWithSpan.filter((node) =>
      containsPoint(node.sourceSpan, point),
    );
    if (containing.length === 0) return [];
    const best = containing.reduce((smallest, node) => {
      if (smallest === null) return node;
      return spanWeight(node.sourceSpan) < spanWeight(smallest.sourceSpan)
        ? node
        : smallest;
    }, null as GraphNode | null);
    return best === null ? [] : [best];
  }

  return nodesWithSpan.filter((node) =>
    spansIntersect(node.sourceSpan, normalized),
  );
}

export function buildGraphFocusLens(
  model: GraphModel | null,
  rootNodeIds: readonly GraphNodeId[],
  origin: GraphFocusOrigin,
): GraphFocusLens | null {
  if (model === null) return null;
  const roots = rootNodeIds.filter((id, index, ids) =>
    ids.indexOf(id) === index && model.nodesById.has(id),
  );
  if (roots.length === 0) return null;

  const rootSet = new Set<GraphNodeId>(roots);
  const focusedNodes = new Set<GraphNodeId>(roots);
  const focusedEdges = new Set<string>();
  const groupState = new Map<
    GraphFocusGroupLabel,
    { nodeIds: Set<GraphNodeId>; edgeIds: Set<string> }
  >(
    GROUP_ORDER.map((label) => [
      label,
      { nodeIds: new Set<GraphNodeId>(), edgeIds: new Set<string>() },
    ]),
  );

  for (const edge of model.edges) {
    const sourceIsRoot = rootSet.has(edge.source);
    const targetIsRoot = rootSet.has(edge.target);
    if (!sourceIsRoot && !targetIsRoot) continue;

    focusedEdges.add(edge.id);
    focusedNodes.add(edge.source);
    focusedNodes.add(edge.target);

    if (sourceIsRoot) {
      const label = outgoingLabel(edge);
      if (!rootSet.has(edge.target)) {
        addGroupMember(groupState, label, edge.target, edge.id);
      }
    }
    if (targetIsRoot) {
      const label = incomingLabel(edge);
      if (!rootSet.has(edge.source)) {
        addGroupMember(groupState, label, edge.source, edge.id);
      }
    }
  }

  return {
    origin,
    signature: `${origin}:${roots.join("|")}`,
    rootNodeIds: roots,
    nodeIds: Array.from(focusedNodes),
    edgeIds: Array.from(focusedEdges),
    groups: GROUP_ORDER.map((label) => {
      const state = groupState.get(label);
      return {
        label,
        nodeIds: Array.from(state?.nodeIds ?? []),
        edgeIds: Array.from(state?.edgeIds ?? []),
      };
    }).filter((group) => group.nodeIds.length > 0),
  };
}

export function normalizeSpan(span: SourceSpan): SourceSpan {
  return comparePos(span.start, span.end) <= 0
    ? span
    : {
        start: span.end,
        end: span.start,
      };
}

function addGroupMember(
  groupState: Map<
    GraphFocusGroupLabel,
    { nodeIds: Set<GraphNodeId>; edgeIds: Set<string> }
  >,
  label: GraphFocusGroupLabel,
  nodeId: GraphNodeId,
  edgeId: string,
): void {
  const group = groupState.get(label);
  if (group === undefined) return;
  group.nodeIds.add(nodeId);
  group.edgeIds.add(edgeId);
}

function outgoingLabel(edge: GraphEdge): GraphFocusGroupLabel {
  switch (edge.relation) {
    case "mutates":
      return "Mutates";
    case "unlocks":
      return "Unlocks";
    case "feeds":
      return "Feeds Into";
  }
}

function incomingLabel(edge: GraphEdge): GraphFocusGroupLabel {
  switch (edge.relation) {
    case "mutates":
      return "Mutated By";
    case "unlocks":
      return "Unlocked By";
    case "feeds":
      return "Depends On";
  }
}

function containsPoint(
  span: SourceSpan | null,
  point: SourceSpan["start"],
): boolean {
  if (span === null) return false;
  return (
    comparePos(span.start, point) <= 0 &&
    comparePos(point, span.end) <= 0
  );
}

function spansIntersect(a: SourceSpan | null, b: SourceSpan): boolean {
  if (a === null) return false;
  return comparePos(a.start, b.end) <= 0 && comparePos(b.start, a.end) <= 0;
}

function spanWeight(span: SourceSpan | null): number {
  if (span === null) return Number.POSITIVE_INFINITY;
  const lineDelta = span.end.line - span.start.line;
  const colDelta = span.end.column - span.start.column;
  return lineDelta * 10_000 + colDelta;
}

function comparePos(
  a: SourceSpan["start"],
  b: SourceSpan["start"],
): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}
