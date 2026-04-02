import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";

import { createFinding } from "../../internal/findings.js";
import { getNodesByKind } from "../../internal/query.js";

export function analyzeConvergenceRisk(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];

  for (const actionNode of getNodesByKind(graph, ["action"])) {
    const calledActions = (actionNode.metadata.calledActions as string[] | undefined) ?? [];
    const hasWrites = graph.edges.some(
      (edge) => edge.source === actionNode.id && edge.kind === "produces"
    );

    if (calledActions.length === 0 || hasWrites) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "convergence-risk",
        subject: { nodeId: actionNode.id, path: actionNode.sourcePath },
        message: `Action "${actionNode.metadata.actionId}" delegates to other flows but does not directly produce patches or effects.`,
        evidence: [{ ref: { nodeId: actionNode.id, path: actionNode.sourcePath }, role: "action" }]
      })
    );
  }

  return findings;
}

