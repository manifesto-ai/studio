import type {
  GraphEdge,
  GraphNode,
  OverlayFact,
  SemanticGraphIR
} from "../contracts/graph-ir.js";

export function cloneGraph(graph: SemanticGraphIR): SemanticGraphIR {
  return {
    nodes: new Map(
      [...graph.nodes.entries()].map(([id, node]) => [
        id,
        {
          ...node,
          metadata: { ...node.metadata },
          overlayFacts: node.overlayFacts.map((fact) => ({ ...fact }))
        }
      ])
    ),
    edges: graph.edges.map((edge) => ({
      ...edge,
      metadata: edge.metadata ? { ...edge.metadata } : undefined
    })),
    schemaHash: graph.schemaHash,
    overlayVersions: { ...graph.overlayVersions }
  };
}

export function addNode(graph: SemanticGraphIR, node: GraphNode): void {
  const existing = graph.nodes.get(node.id);
  if (existing) {
    graph.nodes.set(node.id, {
      ...existing,
      metadata: { ...existing.metadata, ...node.metadata },
      overlayFacts: mergeFacts(existing.overlayFacts, node.overlayFacts)
    });
    return;
  }

  graph.nodes.set(node.id, {
    ...node,
    metadata: { ...node.metadata },
    overlayFacts: sortFacts(node.overlayFacts)
  });
}

export function addEdge(graph: SemanticGraphIR, edge: GraphEdge): void {
  const exists = graph.edges.some(
    (candidate) =>
      candidate.source === edge.source &&
      candidate.target === edge.target &&
      candidate.kind === edge.kind &&
      candidate.provenance === edge.provenance
  );

  if (!exists) {
    graph.edges.push({
      ...edge,
      metadata: edge.metadata ? { ...edge.metadata } : undefined
    });
  }
}

export function appendFact(node: GraphNode, fact: OverlayFact): GraphNode {
  return {
    ...node,
    metadata: { ...node.metadata },
    overlayFacts: mergeFacts(node.overlayFacts, [fact])
  };
}

export function finalizeGraph(graph: SemanticGraphIR): SemanticGraphIR {
  return {
    ...graph,
    nodes: new Map(
      [...graph.nodes.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, node]) => [
          id,
          {
            ...node,
            metadata: sortObject(node.metadata),
            overlayFacts: sortFacts(node.overlayFacts)
          }
        ])
    ),
    edges: [...graph.edges]
      .map((edge) => ({
        ...edge,
        metadata: edge.metadata ? sortObject(edge.metadata) : undefined
      }))
      .sort((left, right) =>
        `${left.source}:${left.kind}:${left.target}`.localeCompare(
          `${right.source}:${right.kind}:${right.target}`
        )
      )
  };
}

function mergeFacts(left: OverlayFact[], right: OverlayFact[]): OverlayFact[] {
  return sortFacts([...left, ...right]);
}

function sortFacts(facts: OverlayFact[]): OverlayFact[] {
  return [...facts]
    .map((fact) => ({ ...fact }))
    .sort((left, right) =>
      `${left.key}:${left.provenance}:${left.observedAt ?? 0}`.localeCompare(
        `${right.key}:${right.provenance}:${right.observedAt ?? 0}`
      )
    );
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

