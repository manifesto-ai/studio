import type {
  FactProvenance,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  OverlayFact,
  SemanticGraphIR
} from "../contracts/graph-ir.js";

export function getNode(graph: SemanticGraphIR, nodeId: string): GraphNode | undefined {
  return graph.nodes.get(nodeId);
}

export function getNodesByKind(
  graph: SemanticGraphIR,
  kinds: GraphNodeKind[]
): GraphNode[] {
  return [...graph.nodes.values()].filter((node) => kinds.includes(node.kind));
}

export function getIncomingEdges(
  graph: SemanticGraphIR,
  nodeId: string,
  kind?: GraphEdge["kind"]
): GraphEdge[] {
  return graph.edges.filter(
    (edge) => edge.target === nodeId && (!kind || edge.kind === kind)
  );
}

export function getOutgoingEdges(
  graph: SemanticGraphIR,
  nodeId: string,
  kind?: GraphEdge["kind"]
): GraphEdge[] {
  return graph.edges.filter(
    (edge) => edge.source === nodeId && (!kind || edge.kind === kind)
  );
}

export function getOverlayFact(
  node: GraphNode,
  key: string,
  provenance?: FactProvenance
): OverlayFact | undefined {
  return node.overlayFacts.find(
    (fact) => fact.key === key && (!provenance || fact.provenance === provenance)
  );
}

export function getOverlayFacts(
  node: GraphNode,
  key: string,
  provenance?: FactProvenance
): OverlayFact[] {
  return node.overlayFacts.filter(
    (fact) => fact.key === key && (!provenance || fact.provenance === provenance)
  );
}

