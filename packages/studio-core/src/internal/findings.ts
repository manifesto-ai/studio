import type { Finding, FindingKind } from "../contracts/findings.js";
import { FINDING_REGISTRY } from "../contracts/findings.js";

function toIdSegment(value: string | undefined): string {
  return (value ?? "none")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createFinding(input: Omit<Finding, "id" | "severity" | "confidence"> & {
  kind: FindingKind;
}): Finding {
  const descriptor = FINDING_REGISTRY[input.kind];
  const evidenceKey = input.evidence
    .map((entry) => `${entry.role}:${entry.ref.nodeId}:${entry.ref.path ?? ""}`)
    .sort()
    .join("|");
  const id = [
    input.kind,
    toIdSegment(input.subject.nodeId),
    toIdSegment(input.subject.path),
    toIdSegment(evidenceKey)
  ].join(":");

  return {
    ...input,
    id,
    severity: descriptor.severity,
    confidence: descriptor.confidence
  };
}
