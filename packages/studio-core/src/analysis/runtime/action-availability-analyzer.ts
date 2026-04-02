import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";

import { createFinding } from "../../internal/findings.js";
import { getNode, getNodesByKind, getOverlayFact } from "../../internal/query.js";

export function analyzeActionAvailability(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];

  for (const actionNode of getNodesByKind(graph, ["action"])) {
    const availability = getOverlayFact(actionNode, "runtime:available", "runtime");
    if (!availability || availability.value !== false) {
      continue;
    }

    const guardNode = getNode(graph, `guard:${actionNode.metadata.actionId}`);
    findings.push(
      createFinding({
        kind: "action-blocked",
        subject: { nodeId: actionNode.id, path: actionNode.sourcePath },
        message: `Action "${actionNode.metadata.actionId}" is currently blocked by its availability guard.`,
        evidence: [
          { ref: { nodeId: actionNode.id, path: actionNode.sourcePath }, role: "action" },
          ...(guardNode
            ? [{ ref: { nodeId: guardNode.id, path: guardNode.sourcePath }, role: "guard" }]
            : [])
        ]
      })
    );
  }

  return findings;
}

