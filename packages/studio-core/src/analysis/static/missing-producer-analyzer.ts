import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";

import { createFinding } from "../../internal/findings.js";
import { getIncomingEdges, getNodesByKind } from "../../internal/query.js";

export function analyzeMissingProducers(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];

  for (const stateNode of getNodesByKind(graph, ["state"])) {
    if (!stateNode.metadata.isLeaf) {
      continue;
    }

    const writes = getIncomingEdges(graph, stateNode.id, "writes");
    if (writes.length > 0) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "missing-producer",
        subject: { nodeId: stateNode.id, path: stateNode.sourcePath },
        message: `State field "${stateNode.metadata.path}" has no patch producer.`,
        evidence: [{ ref: { nodeId: stateNode.id, path: stateNode.sourcePath }, role: "state" }]
      })
    );
  }

  return findings;
}

