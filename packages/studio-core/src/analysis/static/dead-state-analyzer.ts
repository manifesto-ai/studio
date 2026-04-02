import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";

import { createFinding } from "../../internal/findings.js";
import { getIncomingEdges, getNode, getNodesByKind } from "../../internal/query.js";

export function analyzeDeadState(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];

  for (const stateNode of getNodesByKind(graph, ["state"])) {
    if (!stateNode.metadata.isLeaf) {
      continue;
    }

    const dependsOn = getIncomingEdges(graph, stateNode.id, "depends-on").filter(
      (edge) => getNode(graph, edge.source)?.kind === "computed"
    );
    const guardReads = getIncomingEdges(graph, stateNode.id, "reads").filter(
      (edge) => getNode(graph, edge.source)?.kind === "guard"
    );

    if (dependsOn.length > 0 || guardReads.length > 0) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "dead-state",
        subject: { nodeId: stateNode.id, path: stateNode.sourcePath },
        message: `State field "${stateNode.metadata.path}" is not referenced by computed fields or action guards.`,
        evidence: [{ ref: { nodeId: stateNode.id, path: stateNode.sourcePath }, role: "state" }]
      })
    );
  }

  return findings;
}

