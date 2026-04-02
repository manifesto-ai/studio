import type { CauseChain } from "./explanations.js";
import type {
  Finding,
  FindingKind,
  FindingSeverity,
  GraphRef
} from "./findings.js";
import type {
  FactProvenance,
  GraphEdge,
  GraphNodeKind,
  OverlayVersionMap
} from "./graph-ir.js";
import type { OverlayKind } from "./session.js";

export type ProjectionUnavailable = {
  status: "not-provided";
  requiredOverlay: OverlayKind;
  message: string;
};

export type DomainGraphProjectionNode = {
  id: string;
  kind: GraphNodeKind;
  sourcePath: string;
  provenance: FactProvenance;
  metadata?: Record<string, unknown>;
  overlayFacts?: Array<{
    key: string;
    value: unknown;
    provenance: FactProvenance;
    observedAt?: number;
  }>;
};

export type DomainGraphProjection = {
  format: "summary" | "full";
  schemaHash: string;
  overlayVersions: OverlayVersionMap;
  nodeCount: number;
  edgeCount: number;
  nodes: DomainGraphProjectionNode[];
  edges: GraphEdge[];
};

export type FindingsSummary = {
  total: number;
  bySeverity: Record<FindingSeverity, number>;
  byKind: Partial<Record<FindingKind, number>>;
};

export type FindingsReportProjection = {
  status: "ready";
  summary: FindingsSummary;
  findings: Finding[];
};

export type GuardBreakdownEntry = {
  subExpression: string;
  evaluated: boolean;
  ref: GraphRef;
};

export type ActionAvailabilityProjection = {
  status: "ready" | "not-provided";
  actionId: string;
  available?: boolean;
  guard?: {
    expression: string;
    evaluation?: boolean;
  };
  blockers?: GuardBreakdownEntry[];
  explanation?: CauseChain;
  message?: string;
};

export type ActionBlockerProjection =
  | {
      status: "ready";
      actionId: string;
      available: boolean;
      blockerSource: "runtime" | "static";
      blockers: GuardBreakdownEntry[];
      explanation?: CauseChain;
      summary: string;
    }
  | {
      status: "not-provided";
      actionId: string;
      summary: string;
    }
  | {
      status: "not-found";
      actionId: string;
      summary: string;
    };

export type SnapshotFieldInspection = {
  nodeId: string;
  path: string;
  kind: "state" | "computed";
  value: unknown;
  dependencies?: string[];
};

export type SnapshotInspectorProjection =
  | ProjectionUnavailable
  | {
      status: "ready";
      version: number;
      schemaHash: string;
      fields: SnapshotFieldInspection[];
      findings: Finding[];
    };

export type TraceReplayStep = {
  traceNodeId: string;
  kind: string;
  sourcePath: string;
  timestamp: number;
  output: unknown;
  childCount: number;
};

export type TraceReplayProjection =
  | ProjectionUnavailable
  | {
      status: "ready";
      intentType: string;
      baseVersion: number;
      resultVersion: number;
      duration: number;
      terminatedBy: string;
      steps: TraceReplayStep[];
      findings: Finding[];
    };

export type LineageBranchProjection = {
  id: string;
  epoch: number;
  headWorldId: string | null;
  tipWorldId: string | null;
  active: boolean;
  headAdvancedAt: number | null;
};

export type LineageWorldProjection = {
  worldId: string;
  parentWorldId: string | null;
  schemaHash: string;
  snapshotHash: string;
  terminalStatus: "completed" | "failed";
  createdAt: number;
};

export type LineageStateProjection =
  | ProjectionUnavailable
  | {
      status: "ready";
      activeBranchId: string;
      branches: LineageBranchProjection[];
      worlds: LineageWorldProjection[];
      findings: Finding[];
    };

export type GovernanceProposalProjection = {
  id: string;
  branchId: string;
  stage: "ingress" | "execution" | "terminal";
  outcome?: "approved" | "rejected" | "abandoned";
  actorId: string;
  createdAt: number;
  terminalizedAt?: number;
};

export type GovernanceBindingProjection = {
  actorId: string;
  authorityId: string;
  permissions: string[];
};

export type GovernanceGateProjection = {
  branchId: string;
  locked: boolean;
  currentProposalId?: string;
  epoch: number;
};

export type GovernanceStateProjection =
  | ProjectionUnavailable
  | {
      status: "ready";
      proposals: GovernanceProposalProjection[];
      bindings: GovernanceBindingProjection[];
      gates: GovernanceGateProjection[];
      findings: Finding[];
    };
