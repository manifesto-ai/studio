import type {
  SnapshotInspectorProjection,
  SnapshotFieldInspection
} from "../contracts/projections.js";
import type { Finding } from "../contracts/findings.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";
import type { Snapshot } from "../contracts/inputs.js";

import { getNodesByKind, getOverlayFact } from "../internal/query.js";

export function projectSnapshotInspection(
  graph: SemanticGraphIR,
  snapshot: Snapshot | undefined,
  findings: Finding[]
): SnapshotInspectorProjection {
  if (!snapshot) {
    return {
      status: "not-provided",
      requiredOverlay: "snapshot",
      message: "Snapshot overlay was not attached."
    };
  }

  const fields: SnapshotFieldInspection[] = [];
  for (const node of getNodesByKind(graph, ["state", "computed"])) {
    const value = getOverlayFact(node, "runtime:value", "runtime");
    if (!value) {
      continue;
    }

    const depsFact = getOverlayFact(node, "runtime:deps", "runtime");
    fields.push({
      nodeId: node.id,
      path: String(node.metadata.path ?? node.metadata.actionId ?? node.id),
      kind: node.kind === "state" ? "state" : "computed",
      value: value.value,
      dependencies: Array.isArray(depsFact?.value)
        ? (depsFact!.value as string[])
        : undefined
    });
  }

  return {
    status: "ready",
    version: snapshot.meta.version,
    schemaHash: snapshot.meta.schemaHash,
    fields: fields.sort((left, right) => left.path.localeCompare(right.path)),
    findings
  };
}

