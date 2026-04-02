import type {
  DomainSchema,
  Snapshot,
  TraceGraph
} from "@manifesto-ai/core";

export type {
  DomainSchema,
  ExplainResult,
  FieldSpec,
  SemanticPath,
  Snapshot,
  TraceGraph
} from "@manifesto-ai/core";

export type KeyedEntries<T> = ReadonlyArray<readonly [string, T]>;

export type KeyedRecord<T> = Record<string, T>;

export type KeyedCollection<T> =
  | Map<string, T>
  | ReadonlyMap<string, T>
  | KeyedEntries<T>
  | KeyedRecord<T>;

export type AnalysisBundle = {
  schema: DomainSchema;
  snapshot?: Snapshot;
  trace?: TraceGraph;
  lineage?: LineageExport | LineageInput;
  governance?: GovernanceExport | GovernanceInput;
};

export type BranchSummary = {
  id: string;
  headWorldId: string | null;
  tipWorldId: string | null;
  epoch: number;
  headAdvancedAt: number | null;
};

export type WorldSummary = {
  worldId: string;
  parentWorldId: string | null;
  schemaHash: string;
  snapshotHash: string;
  terminalStatus: "completed" | "failed";
  createdAt: number;
};

export type SealAttemptSummary = {
  worldId: string;
  branchId: string;
  reused: boolean;
  createdAt: number;
};

export type LineageExport = {
  branches: BranchSummary[];
  activeBranchId: string;
  worlds: Map<string, WorldSummary>;
  attempts: Map<string, SealAttemptSummary[]>;
};

export type LineageWorldInput = Omit<WorldSummary, "worldId"> & {
  worldId?: string;
};

export type SealAttemptInput = Omit<SealAttemptSummary, "worldId"> & {
  worldId?: string;
};

export type LineageInput = {
  branches: BranchSummary[];
  activeBranchId: string;
  worlds: KeyedCollection<LineageWorldInput> | ReadonlyArray<LineageWorldInput>;
  attempts:
    | KeyedCollection<SealAttemptInput | SealAttemptInput[]>
    | ReadonlyArray<SealAttemptInput>;
};

export type ProposalSummary = {
  id: string;
  branchId: string;
  stage: "ingress" | "execution" | "terminal";
  outcome?: "approved" | "rejected" | "abandoned";
  actorId: string;
  createdAt: number;
  terminalizedAt?: number;
};

export type ActorBindingSummary = {
  actorId: string;
  authorityId: string;
  permissions: string[];
};

export type GateStateSummary = {
  branchId: string;
  locked: boolean;
  currentProposalId?: string;
  epoch: number;
};

export type GovernanceExport = {
  proposals: Map<string, ProposalSummary>;
  bindings: ActorBindingSummary[];
  gates: Map<string, GateStateSummary>;
};

export type ProposalInput = Omit<ProposalSummary, "id"> & {
  id?: string;
};

export type GateStateInput = Omit<GateStateSummary, "branchId"> & {
  branchId?: string;
};

export type GovernanceInput = {
  proposals: KeyedCollection<ProposalInput> | ReadonlyArray<ProposalInput>;
  bindings: ActorBindingSummary[];
  gates: KeyedCollection<GateStateInput> | ReadonlyArray<GateStateInput>;
};

export type GuardBreakdownFact = {
  expression: string;
  evaluated: boolean;
  dependencies: string[];
};

export type ActionRuntimeFact = {
  actionId: string;
  available: boolean;
  guardExpression?: string;
  breakdown: GuardBreakdownFact[];
};

export type ExplainedValueFact = {
  value: unknown;
  deps: string[];
};

export type RuntimeOverlayContext = {
  snapshotVersion: number;
  snapshotTimestamp: number;
  nodeValues: Record<string, unknown>;
  actionFacts: Record<string, ActionRuntimeFact>;
  availableActions: string[];
  explainedValues: Record<string, ExplainedValueFact>;
};
