import type { TraceGraph } from "../contracts/inputs.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";

import { cloneGraphForOverlay, finalizeMergedGraph } from "./graph-merge.js";
import { appendFact } from "../internal/graph.js";

export function applyTraceOverlay(
  baseGraph: SemanticGraphIR,
  trace: TraceGraph
): SemanticGraphIR {
  const graph = cloneGraphForOverlay(baseGraph);
  graph.overlayVersions.traceBaseVersion = trace.baseVersion;

  const traceNodes = Object.values(trace.nodes);
  const byExactPath = new Map<string, typeof traceNodes>();

  for (const traceNode of traceNodes) {
    const bucket = byExactPath.get(traceNode.sourcePath) ?? [];
    bucket.push(traceNode);
    byExactPath.set(traceNode.sourcePath, bucket);
  }

  for (const [nodeId, node] of graph.nodes.entries()) {
    let matches = byExactPath.get(node.sourcePath) ?? [];

    if (node.kind === "action") {
      matches = traceNodes.filter((traceNode) =>
        traceNode.sourcePath.startsWith(`${node.sourcePath}.flow`)
      );
    }

    if (matches.length === 0) {
      continue;
    }

    let enriched = appendFact(node, {
      key: "trace:seen-count",
      value: matches.length,
      provenance: "trace",
      observedAt: Math.max(...matches.map((traceNode) => traceNode.timestamp))
    });

    const latest = [...matches].sort((left, right) => right.timestamp - left.timestamp)[0];
    enriched = appendFact(enriched, {
      key: "trace:last-output",
      value: latest.output,
      provenance: "trace",
      observedAt: latest.timestamp
    });

    graph.nodes.set(nodeId, enriched);
  }

  return finalizeMergedGraph(graph);
}

