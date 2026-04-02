import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";

import { createFinding } from "../../internal/findings.js";
import { getNode, getNodesByKind } from "../../internal/query.js";

export function analyzeReachability(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];

  for (const actionNode of getNodesByKind(graph, ["action"])) {
    const actionId = String(actionNode.metadata.actionId);
    const guardNode = getNode(graph, `guard:${actionId}`);

    if (!guardNode) {
      continue;
    }

    const expression = String(guardNode.metadata.expression ?? "");
    const reads = (guardNode.metadata.reads as string[] | undefined) ?? [];
    const missingReads = reads.filter(
      (read) => !graph.nodes.has(`state:${read}`) && !graph.nodes.has(`computed:${read}`)
    );
    const staticallyFalse = expression === "false";

    if (!staticallyFalse && missingReads.length === 0) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "unreachable-action",
        subject: { nodeId: actionNode.id, path: actionNode.sourcePath },
        message: staticallyFalse
          ? `Action "${actionId}" has an availability guard that is statically false.`
          : `Action "${actionId}" reads missing guard dependencies: ${missingReads.join(", ")}.`,
        evidence: [
          { ref: { nodeId: actionNode.id, path: actionNode.sourcePath }, role: "action" },
          { ref: { nodeId: guardNode.id, path: guardNode.sourcePath }, role: "guard" }
        ]
      })
    );
  }

  return findings;
}

