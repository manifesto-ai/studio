import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";
import type { GuardBreakdownFact } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";
import { getNodesByKind, getOverlayFact } from "../../internal/query.js";

export function analyzeGuardBreakdowns(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];

  for (const guardNode of getNodesByKind(graph, ["guard"])) {
    const breakdownFact = getOverlayFact(
      guardNode,
      "runtime:guard-breakdown",
      "runtime"
    );
    if (!breakdownFact || !Array.isArray(breakdownFact.value)) {
      continue;
    }

    const breakdown = breakdownFact.value as GuardBreakdownFact[];
    const hasMixedResults =
      breakdown.some((entry) => entry.evaluated) &&
      breakdown.some((entry) => !entry.evaluated);

    if (!hasMixedResults) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "guard-partial-block",
        subject: { nodeId: guardNode.id, path: guardNode.sourcePath },
        message: `Guard for action "${guardNode.metadata.actionId}" has both passing and failing clauses.`,
        evidence: [{ ref: { nodeId: guardNode.id, path: guardNode.sourcePath }, role: "guard" }]
      })
    );
  }

  return findings;
}

