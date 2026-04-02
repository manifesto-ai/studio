import type { CauseChain } from "./explanations.js";
import type { FactProvenance } from "./graph-ir.js";

export const FINDING_REGISTRY = {
  "unreachable-action": {
    severity: "error",
    confidence: "exact",
    description: "Action can never be dispatched given current schema structure.",
    provenance: ["static"]
  },
  "missing-producer": {
    severity: "error",
    confidence: "exact",
    description: "State field has no action that writes to it.",
    provenance: ["static"]
  },
  "dead-state": {
    severity: "warn",
    confidence: "exact",
    description: "State field exists but is never read by computed or guard.",
    provenance: ["static"]
  },
  "cyclic-dependency": {
    severity: "error",
    confidence: "exact",
    description: "Computed dependency graph contains a cycle.",
    provenance: ["static"]
  },
  "guard-unsatisfiable": {
    severity: "error",
    confidence: "heuristic",
    description: "Guard expression appears unsatisfiable.",
    provenance: ["static"]
  },
  "convergence-risk": {
    severity: "warn",
    confidence: "heuristic",
    description: "Flow may not converge to a terminal state.",
    provenance: ["static"]
  },
  "name-collision": {
    severity: "error",
    confidence: "exact",
    description: "Two schema elements share an ambiguous name.",
    provenance: ["static"]
  },
  "action-blocked": {
    severity: "info",
    confidence: "exact",
    description: "Action is currently unavailable due to guard evaluation.",
    provenance: ["runtime"]
  },
  "guard-partial-block": {
    severity: "info",
    confidence: "exact",
    description: "Guard has multiple sub-expressions; some pass and some fail.",
    provenance: ["runtime"]
  },
  "snapshot-drift": {
    severity: "warn",
    confidence: "exact",
    description: "Snapshot does not match schema field expectations.",
    provenance: ["runtime"]
  },
  "unused-branch": {
    severity: "info",
    confidence: "exact",
    description: "Conditional branch in flow was never taken in this trace.",
    provenance: ["trace"]
  },
  "effect-without-patch": {
    severity: "warn",
    confidence: "exact",
    description: "Effect executed but produced no patches.",
    provenance: ["trace"]
  },
  "redundant-patch": {
    severity: "info",
    confidence: "exact",
    description: "Patch sets a value identical to the current state.",
    provenance: ["trace"]
  },
  "branch-stale": {
    severity: "warn",
    confidence: "exact",
    description: "Branch has not advanced head for a stale threshold.",
    provenance: ["lineage"]
  },
  "seal-reuse-detected": {
    severity: "info",
    confidence: "exact",
    description: "World was reused across branches.",
    provenance: ["lineage"]
  },
  "orphan-branch": {
    severity: "warn",
    confidence: "exact",
    description: "Branch exists but is not reachable from the active branch.",
    provenance: ["lineage"]
  },
  "proposal-stale": {
    severity: "warn",
    confidence: "exact",
    description: "Proposal has been in ingress stage beyond threshold.",
    provenance: ["governance"]
  },
  "gate-locked": {
    severity: "info",
    confidence: "exact",
    description: "Branch gate is locked by an in-progress proposal.",
    provenance: ["governance"]
  },
  "actor-unbound": {
    severity: "warn",
    confidence: "exact",
    description: "Actor has no authority binding.",
    provenance: ["governance"]
  }
} as const;

export type FindingKind = keyof typeof FINDING_REGISTRY;

export type FindingSeverity = "error" | "warn" | "info";

export type FindingConfidence = "exact" | "heuristic";

export type GraphRef = {
  nodeId: string;
  path?: string;
};

export type EvidenceRef = {
  ref: GraphRef;
  role: string;
};

export type Finding = {
  id: string;
  kind: FindingKind;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  subject: GraphRef;
  message: string;
  evidence: EvidenceRef[];
  causeChain?: CauseChain;
};

export type FindingDescriptor = (typeof FINDING_REGISTRY)[FindingKind];

export type FindingRegistryRecord = Record<FindingKind, FindingDescriptor>;

export type FindingProvenanceHint = FactProvenance;

