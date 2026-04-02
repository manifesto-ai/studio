import type {
  ActionAvailabilityProjection,
  GuardBreakdownEntry
} from "../contracts/projections.js";
import type { Finding } from "../contracts/findings.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";
import type { GuardBreakdownFact } from "../contracts/inputs.js";

import { getNode, getNodesByKind, getOverlayFact } from "../internal/query.js";
import { buildCauseChain } from "../explanation/cause-chain-builder.js";

function breakdownEntries(
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

export function projectActionAvailability(
  graph: SemanticGraphIR,
  findings: Finding[],
  snapshotProvided: boolean
): ActionAvailabilityProjection[] {
  return getNodesByKind(graph, ["action"]).map((actionNode) => {
    const actionId = String(actionNode.metadata.actionId);
    const guardNode = getNode(graph, `guard:${actionId}`);

    if (!snapshotProvided) {
      return {
        status: "not-provided",
        actionId,
        guard: guardNode
          ? {
              expression: String(guardNode.metadata.expression ?? "")
            }
          : undefined,
        message: "Snapshot overlay is required for runtime availability."
      };
    }

    const availability = getOverlayFact(actionNode, "runtime:available", "runtime");
    const listedAvailability = getOverlayFact(
      actionNode,
      "runtime:listed-available",
      "runtime"
    );
    const breakdown = guardNode
      ? getOverlayFact(guardNode, "runtime:guard-breakdown", "runtime")
      : undefined;
    const relatedFinding = findings.find(
      (finding) =>
        finding.subject.nodeId === actionNode.id &&
        (finding.kind === "action-blocked" || finding.kind === "guard-partial-block")
    );

    return {
      status: "ready",
      actionId,
      available:
        typeof availability?.value === "boolean"
          ? availability.value
          : Boolean(listedAvailability?.value),
      guard: guardNode
        ? {
            expression: String(guardNode.metadata.expression ?? ""),
            evaluation:
              typeof availability?.value === "boolean"
                ? Boolean(availability.value)
                : undefined
          }
        : undefined,
      blockers:
        Array.isArray(breakdown?.value) && breakdown.value.length > 0
          ? breakdownEntries(actionId, breakdown.value as GuardBreakdownFact[])
          : undefined,
      explanation: relatedFinding ? buildCauseChain(graph, relatedFinding) : undefined
    };
  });
}
