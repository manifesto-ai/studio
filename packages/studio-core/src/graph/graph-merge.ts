import type { SemanticGraphIR } from "../contracts/graph-ir.js";

import { cloneGraph, finalizeGraph } from "../internal/graph.js";

export function cloneGraphForOverlay(graph: SemanticGraphIR): SemanticGraphIR {
  return cloneGraph(graph);
}

export function finalizeMergedGraph(graph: SemanticGraphIR): SemanticGraphIR {
  return finalizeGraph(graph);
}

