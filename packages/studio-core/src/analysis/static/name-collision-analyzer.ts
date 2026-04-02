import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";

import { createFinding } from "../../internal/findings.js";
import { getNodesByKind } from "../../internal/query.js";

export function analyzeNameCollisions(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];
  const buckets = new Map<string, string[]>();

  for (const node of getNodesByKind(graph, ["state", "computed", "action"])) {
    const path = String(node.metadata.path ?? node.metadata.actionId ?? node.id);
    const bucket = buckets.get(path) ?? [];
    bucket.push(node.id);
    buckets.set(path, bucket);
  }

  for (const [name, nodeIds] of buckets.entries()) {
    if (nodeIds.length < 2) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "name-collision",
        subject: { nodeId: nodeIds[0] },
        message: `Name collision detected for "${name}" across multiple schema namespaces.`,
        evidence: nodeIds.map((nodeId) => ({
          ref: { nodeId },
          role: "collision-member"
        }))
      })
    );
  }

  return findings;
}

