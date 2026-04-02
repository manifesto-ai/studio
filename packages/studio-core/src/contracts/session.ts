import type { FactProvenance } from "./graph-ir.js";
import type {
  ActionAvailabilityProjection,
  ActionBlockerProjection,
  DomainGraphProjection,
  FindingsReportProjection,
  GovernanceStateProjection,
  LineageStateProjection,
  SnapshotInspectorProjection,
  TraceReplayProjection
} from "./projections.js";
import type {
  AnalysisBundle,
  DomainSchema,
  GovernanceExport,
  GovernanceInput,
  LineageExport,
  LineageInput,
  Snapshot,
  TraceGraph
} from "./inputs.js";
import type { FindingSeverity } from "./findings.js";

export type OverlayKind = "snapshot" | "trace" | "lineage" | "governance";
export type StudioValidationMode = "strict" | "lenient";

export type FindingsFilter = {
  severity?: FindingSeverity[];
  kinds?: string[];
  subjects?: string[];
  provenance?: FactProvenance[];
};

export type StudioSessionOptions = {
  validationMode?: StudioValidationMode;
  lineageStaleMs?: number;
  governanceProposalStaleMs?: number;
};

export type StudioSession = {
  readonly schema: DomainSchema;
  attachSnapshot(snapshot: Snapshot): void;
  attachTrace(trace: TraceGraph): void;
  attachLineage(lineage: LineageExport | LineageInput): void;
  attachGovernance(governance: GovernanceExport | GovernanceInput): void;
  detachOverlay(kind: OverlayKind): void;
  getGraph(format?: "summary" | "full"): DomainGraphProjection;
  getFindings(filter?: FindingsFilter): FindingsReportProjection;
  explainActionBlocker(actionId: string): ActionBlockerProjection;
  getActionAvailability(): ActionAvailabilityProjection[];
  analyzeTrace(): TraceReplayProjection;
  getLineageState(): LineageStateProjection;
  getGovernanceState(): GovernanceStateProjection;
  inspectSnapshot(): SnapshotInspectorProjection;
  dispose(): void;
};

export type CreateStudioSession = (
  bundle: AnalysisBundle,
  options?: StudioSessionOptions
) => StudioSession;
