import type { DomainGraphProjection } from "../contracts/projections.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";

export function projectDomainGraph(
  graph: SemanticGraphIR,
  format: "summary" | "full" = "summary"
): DomainGraphProjection {
  return {
    format,
    schemaHash: graph.schemaHash,
    overlayVersions: { ...graph.overlayVersions },
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.length,
    nodes: [...graph.nodes.values()].map((node) => ({
      id: node.id,
      kind: node.kind,
      sourcePath: node.sourcePath,
      provenance: node.provenance,
      metadata: format === "full" ? { ...node.metadata } : undefined,
      overlayFacts:
        format === "full"
          ? node.overlayFacts.map((fact) => ({ ...fact }))
          : undefined
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      metadata: edge.metadata ? { ...edge.metadata } : undefined
    }))
  };
}

