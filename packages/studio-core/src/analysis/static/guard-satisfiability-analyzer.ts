import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";
import type { ExprNode } from "@manifesto-ai/core";

import { foldConstantExpr } from "../../internal/expr.js";
import { createFinding } from "../../internal/findings.js";
import { getNodesByKind } from "../../internal/query.js";

export function analyzeGuardSatisfiability(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];

  for (const guardNode of getNodesByKind(graph, ["guard"])) {
    const expression = guardNode.metadata.expression;
    const expr = guardNode.metadata.expr as ExprNode | undefined;
    if (!expr || typeof expression !== "string") {
      continue;
    }

    const folded = foldConstantExpr(expr);

    const isConstantFalse =
      expression === "false" || (folded.constant && folded.value === false);

    if (!isConstantFalse) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "guard-unsatisfiable",
        subject: { nodeId: guardNode.id, path: guardNode.sourcePath },
        message: `Guard for action "${guardNode.metadata.actionId}" is statically false under current schema heuristics.`,
        evidence: [{ ref: { nodeId: guardNode.id, path: guardNode.sourcePath }, role: "guard" }]
      })
    );
  }

  return findings;
}
