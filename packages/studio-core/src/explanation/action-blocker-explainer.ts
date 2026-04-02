import type { ActionBlockerProjection, GuardBreakdownEntry } from "../contracts/projections.js";
import type { Finding } from "../contracts/findings.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";
import type { GuardBreakdownFact } from "../contracts/inputs.js";

import { buildCauseChain } from "./cause-chain-builder.js";
import { getNode, getOverlayFact } from "../internal/query.js";

function toBreakdownEntries(
  actionId: string,
  breakdown: GuardBreakdownFact[]
): GuardBreakdownEntry[] {
  return breakdown.map((entry, index) => ({
    subExpression: entry.expression,
    evaluated: entry.evaluated,
    ref: {
      nodeId: `guard:${actionId}`,
      path: `actions.${actionId}.available.breakdown.${index}`
    }
  }));
}

export function explainActionBlocker(
  graph: SemanticGraphIR,
  findings: Finding[],
  actionId: string
): ActionBlockerProjection {
  const actionNode = getNode(graph, `action:${actionId}`);
  if (!actionNode) {
    return {
      status: "not-found",
      actionId,
      summary: `Action "${actionId}" does not exist in the graph.`
    };
  }

  const availability = getOverlayFact(actionNode, "runtime:available", "runtime");
  if (!availability) {
    return {
      status: "not-provided",
      actionId,
      summary: `Snapshot overlay is required to explain blocker state for "${actionId}".`
    };
  }

  const guardNode = getNode(graph, `guard:${actionId}`);
  const breakdownFact = guardNode
    ? getOverlayFact(guardNode, "runtime:guard-breakdown", "runtime")
    : undefined;
  const breakdown = Array.isArray(breakdownFact?.value)
    ? (breakdownFact!.value as GuardBreakdownFact[])
    : [];
  const blockerFinding = findings.find(
    (finding) =>
      finding.subject.nodeId === actionNode.id &&
      (finding.kind === "action-blocked" || finding.kind === "guard-partial-block")
  );

  return {
    status: "ready",
    actionId,
    available: Boolean(availability.value),
    blockerSource: "runtime",
    blockers: toBreakdownEntries(actionId, breakdown),
    explanation: blockerFinding ? buildCauseChain(graph, blockerFinding) : undefined,
    summary: blockerFinding?.message ?? `Action "${actionId}" is currently available.`
  };
}
