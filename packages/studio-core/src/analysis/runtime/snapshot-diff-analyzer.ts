import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";

import { createFinding } from "../../internal/findings.js";
import { getNodesByKind, getOverlayFact } from "../../internal/query.js";

export function analyzeSnapshotDiff(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];

  for (const stateNode of getNodesByKind(graph, ["state"])) {
    const valueFact = getOverlayFact(stateNode, "runtime:value", "runtime");
    if (!valueFact) {
      continue;
    }

    const type = stateNode.metadata.type;
    const value = valueFact.value;
    const mismatch =
      (type === "string" && value != null && typeof value !== "string") ||
      (type === "number" && value != null && typeof value !== "number") ||
      (type === "boolean" && value != null && typeof value !== "boolean") ||
      (type === "array" && value != null && !Array.isArray(value)) ||
      (type === "object" && value != null && (typeof value !== "object" || Array.isArray(value)));

    if (!mismatch) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "snapshot-drift",
        subject: { nodeId: stateNode.id, path: stateNode.sourcePath },
        message: `Snapshot value for "${stateNode.metadata.path}" does not match declared field type "${type}".`,
        evidence: [{ ref: { nodeId: stateNode.id, path: stateNode.sourcePath }, role: "state" }]
      })
    );
  }

  return findings;
}

