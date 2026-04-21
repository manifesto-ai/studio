import type { SourceSpan } from "@manifesto-ai/studio-core";
import type { GraphEdge, GraphModel, GraphNode, GraphNodeId } from "./graph-model.js";

export type GraphFocusOrigin = "editor" | "graph";
export type GraphFocusDepth = 1 | 2;

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
  readonly hop1NodeIds: readonly GraphNodeId[];
  readonly hop2NodeIds: readonly GraphNodeId[];
  readonly hop1EdgeIds: readonly string[];
  readonly hop2EdgeIds: readonly string[];
  readonly blastNodeDepths: ReadonlyMap<GraphNodeId, GraphFocusDepth>;
  readonly blastEdgeDepths: ReadonlyMap<string, GraphFocusDepth>;
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
  const requestedRoots = new Set(rootNodeIds.filter((id) => model.nodesById.has(id)));
  const roots = model.nodes
    .filter((node) => requestedRoots.has(node.id))
    .map((node) => node.id);
  if (roots.length === 0) return null;

  const rootSet = new Set<GraphNodeId>(roots);
  const contextNodeDepths = buildContextNodeDepths(model, roots);
  const blast = buildBlastDepths(model, roots);
  const focusedNodes = model.nodes
    .filter((node) => contextNodeDepths.has(node.id))
    .map((node) => node.id);
  const focusedEdges: string[] = [];
  const hop1Edges: string[] = [];
  const hop2Edges: string[] = [];
  for (const edge of model.edges) {
    const sourceDepth = contextNodeDepths.get(edge.source);
    const targetDepth = contextNodeDepths.get(edge.target);
    if (sourceDepth === undefined || targetDepth === undefined) continue;
    focusedEdges.push(edge.id);
    const depth = Math.max(sourceDepth, targetDepth);
    if (depth === 1) hop1Edges.push(edge.id);
    else if (depth === 2) hop2Edges.push(edge.id);
  }

  const hop1Nodes = model.nodes
    .filter((node) => contextNodeDepths.get(node.id) === 1)
    .map((node) => node.id);
  const hop2Nodes = model.nodes
    .filter((node) => contextNodeDepths.get(node.id) === 2)
    .map((node) => node.id);
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
    signature: roots.join("|"),
    rootNodeIds: roots,
    nodeIds: focusedNodes,
    edgeIds: focusedEdges,
    hop1NodeIds: hop1Nodes,
    hop2NodeIds: hop2Nodes,
    hop1EdgeIds: hop1Edges,
    hop2EdgeIds: hop2Edges,
    blastNodeDepths: blast.nodeDepths,
    blastEdgeDepths: blast.edgeDepths,
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

function buildContextNodeDepths(
  model: GraphModel,
  roots: readonly GraphNodeId[],
): ReadonlyMap<GraphNodeId, number> {
  const adjacency = new Map<
    GraphNodeId,
    { readonly nodeId: GraphNodeId; readonly edgeId: string }[]
  >();
  for (const edge of model.edges) {
    addAdjacent(adjacency, edge.source, edge.target, edge.id);
    addAdjacent(adjacency, edge.target, edge.source, edge.id);
  }

  const depths = new Map<GraphNodeId, number>(roots.map((root) => [root, 0]));
  const queue = roots.map((root) => ({ nodeId: root, depth: 0 }));
  let index = 0;
  while (index < queue.length) {
    const { nodeId, depth } = queue[index]!;
    index += 1;
    if (depth >= 2) continue;
    for (const next of adjacency.get(nodeId) ?? []) {
      const nextDepth = depth + 1;
      const prevDepth = depths.get(next.nodeId);
      if (prevDepth !== undefined && prevDepth <= nextDepth) continue;
      depths.set(next.nodeId, nextDepth);
      queue.push({ nodeId: next.nodeId, depth: nextDepth });
    }
  }
  return depths;
}

function buildBlastDepths(
  model: GraphModel,
  roots: readonly GraphNodeId[],
): {
  readonly nodeDepths: ReadonlyMap<GraphNodeId, GraphFocusDepth>;
  readonly edgeDepths: ReadonlyMap<string, GraphFocusDepth>;
} {
  const outgoing = new Map<GraphNodeId, GraphEdge[]>();
  for (const edge of model.edges) {
    const list = outgoing.get(edge.source);
    if (list === undefined) outgoing.set(edge.source, [edge]);
    else list.push(edge);
  }

  const rootSet = new Set<GraphNodeId>(roots);
  const nodeDepths = new Map<GraphNodeId, GraphFocusDepth>();
  const edgeDepths = new Map<string, GraphFocusDepth>();
  const queue = roots.map((root) => ({ nodeId: root, depth: 0 }));
  let index = 0;
  while (index < queue.length) {
    const { nodeId, depth } = queue[index]!;
    index += 1;
    if (depth >= 2) continue;
    const nextDepth = (depth + 1) as GraphFocusDepth;
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (rootSet.has(edge.target)) continue;
      const prevEdgeDepth = edgeDepths.get(edge.id);
      if (prevEdgeDepth === undefined || nextDepth < prevEdgeDepth) {
        edgeDepths.set(edge.id, nextDepth);
      }
      const prevDepth = nodeDepths.get(edge.target);
      if (prevDepth !== undefined && prevDepth <= nextDepth) continue;
      nodeDepths.set(edge.target, nextDepth);
      queue.push({ nodeId: edge.target, depth: nextDepth });
    }
  }

  return { nodeDepths, edgeDepths };
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

function addAdjacent(
  adjacency: Map<GraphNodeId, { readonly nodeId: GraphNodeId; readonly edgeId: string }[]>,
  from: GraphNodeId,
  to: GraphNodeId,
  edgeId: string,
): void {
  const list = adjacency.get(from);
  if (list === undefined) adjacency.set(from, [{ nodeId: to, edgeId }]);
  else list.push({ nodeId: to, edgeId });
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
