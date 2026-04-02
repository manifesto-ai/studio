import type {
  ActionAvailabilityProjection,
  ActionBlockerProjection,
  DomainGraphProjection,
  FindingsReportProjection,
  GovernanceStateProjection,
  LineageStateProjection,
  SnapshotInspectorProjection,
  TraceReplayProjection
} from "../contracts/projections.js";
import type {
  AnalysisBundle,
  GovernanceExport,
  GovernanceInput,
  LineageExport,
  LineageInput,
  Snapshot,
  TraceGraph
} from "../contracts/inputs.js";
import type { Finding } from "../contracts/findings.js";
import type {
  FindingsFilter,
  OverlayKind,
  StudioSession,
  StudioSessionOptions
} from "../contracts/session.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";
import type { SessionCaches } from "./caches.js";
import type { IngestResult } from "../ingest/issues.js";

import { normalizeAnalysisBundle } from "../ingest/normalize-analysis-bundle.js";
import { analyzeGovernedPaths } from "../analysis/governance/governed-path-analyzer.js";
import { analyzeGateState } from "../analysis/governance/gate-state-analyzer.js";
import { analyzeProposalState } from "../analysis/governance/proposal-state-analyzer.js";
import { analyzeBranchState } from "../analysis/lineage/branch-state-analyzer.js";
import { analyzeDagState } from "../analysis/lineage/dag-state-analyzer.js";
import { analyzeSealAttempts } from "../analysis/lineage/seal-attempt-analyzer.js";
import { analyzeActionAvailability } from "../analysis/runtime/action-availability-analyzer.js";
import { analyzeGuardBreakdowns } from "../analysis/runtime/guard-breakdown-analyzer.js";
import { analyzeSnapshotDiff } from "../analysis/runtime/snapshot-diff-analyzer.js";
import { analyzeComputedCycles } from "../analysis/static/computed-cycle-analyzer.js";
import { analyzeConvergenceRisk } from "../analysis/static/convergence-risk-analyzer.js";
import { analyzeDeadState } from "../analysis/static/dead-state-analyzer.js";
import { analyzeGuardSatisfiability } from "../analysis/static/guard-satisfiability-analyzer.js";
import { analyzeMissingProducers } from "../analysis/static/missing-producer-analyzer.js";
import { analyzeNameCollisions } from "../analysis/static/name-collision-analyzer.js";
import { analyzeReachability } from "../analysis/static/reachability-analyzer.js";
import { analyzeEffectSummary } from "../analysis/trace/effect-summary-analyzer.js";
import { analyzeExecutionPath } from "../analysis/trace/execution-path-analyzer.js";
import { analyzePatchSummary } from "../analysis/trace/patch-summary-analyzer.js";
import { explainActionBlocker as explainActionBlockerProjection } from "../explanation/action-blocker-explainer.js";
import { explainFinding } from "../explanation/finding-explainer.js";
import { applyGovernanceOverlay } from "../graph/governance-overlay-builder.js";
import { applyLineageOverlay } from "../graph/lineage-overlay-builder.js";
import { applyRuntimeOverlay } from "../graph/runtime-overlay-builder.js";
import { buildStaticGraph } from "../graph/static-graph-builder.js";
import { applyTraceOverlay } from "../graph/trace-overlay-builder.js";
import { getNode } from "../internal/query.js";
import { projectActionAvailability } from "../projection/action-availability-projection.js";
import { projectDomainGraph } from "../projection/domain-graph-projection.js";
import { projectFindingsReport } from "../projection/findings-report-projection.js";
import { projectGovernanceState } from "../projection/governance-state-projection.js";
import { projectLineageState } from "../projection/lineage-state-projection.js";
import { projectSnapshotInspection } from "../projection/snapshot-inspector-projection.js";
import { projectTraceReplay } from "../projection/trace-replay-projection.js";
import { formatIssues } from "../ingest/issues.js";
import { ingestGovernance } from "../ingest/governance-ingest.js";
import { ingestLineage } from "../ingest/lineage-ingest.js";
import { ingestSnapshot } from "../ingest/snapshot-ingest.js";
import { ingestTrace } from "../ingest/trace-ingest.js";
import { buildRuntimeOverlayContext } from "./core-oracle.js";

type ResolvedStudioSessionOptions = {
  validationMode: "strict" | "lenient";
  lineageStaleMs: number;
  governanceProposalStaleMs: number;
};

const DAY_MS = 1000 * 60 * 60 * 24;

function combinedFindings(...lists: Finding[][]): Finding[] {
  return lists.flat();
}

function coercePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function resolveSessionOptions(
  options: StudioSessionOptions | undefined
): ResolvedStudioSessionOptions {
  return {
    validationMode: options?.validationMode ?? "lenient",
    lineageStaleMs: coercePositiveNumber(options?.lineageStaleMs, DAY_MS),
    governanceProposalStaleMs: coercePositiveNumber(
      options?.governanceProposalStaleMs,
      DAY_MS
    )
  };
}

function applyFilter(
  graph: SemanticGraphIR,
  findings: Finding[],
  filter?: FindingsFilter
): Finding[] {
  if (!filter) {
    return findings;
  }

  return findings.filter((finding) => {
    if (filter.severity && !filter.severity.includes(finding.severity)) {
      return false;
    }

    if (filter.kinds && !filter.kinds.includes(finding.kind)) {
      return false;
    }

    if (filter.subjects && !filter.subjects.includes(finding.subject.nodeId)) {
      return false;
    }

    if (!filter.provenance || filter.provenance.length === 0) {
      return true;
    }

    const subjectProvenance = getNode(graph, finding.subject.nodeId)?.provenance;
    if (subjectProvenance && filter.provenance.includes(subjectProvenance)) {
      return true;
    }

    return finding.evidence.some((evidence) => {
      const provenance = getNode(graph, evidence.ref.nodeId)?.provenance;
      return provenance ? filter.provenance!.includes(provenance) : false;
    });
  });
}

export class StudioSessionImpl implements StudioSession {
  readonly schema;

  private readonly staticGraph: SemanticGraphIR;
  private readonly staticFindings: Finding[];
  private readonly options: ResolvedStudioSessionOptions;

  private snapshot?: Snapshot;
  private trace?: TraceGraph;
  private lineage?: LineageExport;
  private governance?: GovernanceExport;
  private caches: SessionCaches = {};

  constructor(bundle: AnalysisBundle, options?: StudioSessionOptions) {
    this.options = resolveSessionOptions(options);
    const normalized = normalizeAnalysisBundle(bundle, {
      validationMode: this.options.validationMode
    });
    this.schema = normalized.schema;
    this.snapshot = normalized.snapshot.value;
    this.trace = normalized.trace.value;
    this.lineage = normalized.lineage.value;
    this.governance = normalized.governance.value;
    this.staticGraph = buildStaticGraph(normalized.schema);
    this.staticFindings = this.runStaticAnalysis();
  }

  attachSnapshot(snapshot: Snapshot): void {
    this.snapshot = ingestSnapshot(snapshot);
    this.invalidate("snapshot");
  }

  attachTrace(trace: TraceGraph): void {
    this.trace = this.unwrapOverlay(ingestTrace(trace), "trace");
    this.invalidate("trace");
  }

  attachLineage(lineage: LineageExport | LineageInput): void {
    this.lineage = this.unwrapOverlay(ingestLineage(lineage), "lineage");
    this.invalidate("lineage");
  }

  attachGovernance(governance: GovernanceExport | GovernanceInput): void {
    this.governance = this.unwrapOverlay(
      ingestGovernance(governance),
      "governance"
    );
    this.invalidate("governance");
  }

  detachOverlay(kind: OverlayKind): void {
    if (kind === "snapshot") {
      this.snapshot = undefined;
    } else if (kind === "trace") {
      this.trace = undefined;
    } else if (kind === "lineage") {
      this.lineage = undefined;
    } else if (kind === "governance") {
      this.governance = undefined;
    }

    this.invalidate(kind);
  }

  getGraph(format: "summary" | "full" = "summary"): DomainGraphProjection {
    return projectDomainGraph(this.ensureGraph(), format);
  }

  getFindings(filter?: FindingsFilter): FindingsReportProjection {
    const graph = this.ensureGraph();
    const findings = applyFilter(
      graph,
      this.getExplainedFindings(graph),
      filter
    );

    return projectFindingsReport(findings);
  }

  explainActionBlocker(actionId: string): ActionBlockerProjection {
    return explainActionBlockerProjection(
      this.ensureGraph(),
      this.getExplainedFindings(this.ensureGraph()),
      actionId
    );
  }

  getActionAvailability(): ActionAvailabilityProjection[] {
    const graph = this.ensureGraph();
    return projectActionAvailability(
      graph,
      this.getExplainedFindings(graph),
      Boolean(this.snapshot)
    );
  }

  analyzeTrace(): TraceReplayProjection {
    return projectTraceReplay(this.trace, this.ensureTraceFindings());
  }

  getLineageState(): LineageStateProjection {
    return projectLineageState(this.lineage, this.ensureLineageFindings());
  }

  getGovernanceState(): GovernanceStateProjection {
    return projectGovernanceState(this.governance, this.ensureGovernanceFindings());
  }

  inspectSnapshot(): SnapshotInspectorProjection {
    return projectSnapshotInspection(
      this.ensureGraph(),
      this.snapshot,
      this.ensureRuntimeFindings()
    );
  }

  dispose(): void {
    this.snapshot = undefined;
    this.trace = undefined;
    this.lineage = undefined;
    this.governance = undefined;
    this.caches = {};
  }

  private runStaticAnalysis(): Finding[] {
    return combinedFindings(
      analyzeReachability(this.staticGraph),
      analyzeMissingProducers(this.staticGraph),
      analyzeDeadState(this.staticGraph),
      analyzeComputedCycles(this.staticGraph),
      analyzeGuardSatisfiability(this.staticGraph),
      analyzeConvergenceRisk(this.staticGraph),
      analyzeNameCollisions(this.staticGraph)
    );
  }

  private ensureGraph(): SemanticGraphIR {
    if (this.caches.graph) {
      return this.caches.graph;
    }

    let graph = this.staticGraph;

    if (this.snapshot) {
      const runtimeContext =
        this.caches.runtimeContext ??
        buildRuntimeOverlayContext(this.schema, this.snapshot, this.staticGraph);
      this.caches.runtimeContext = runtimeContext;
      graph = applyRuntimeOverlay(graph, runtimeContext);
    }

    if (this.trace) {
      graph = applyTraceOverlay(graph, this.trace);
    }

    if (this.lineage) {
      graph = applyLineageOverlay(graph, this.lineage);
    }

    if (this.governance) {
      graph = applyGovernanceOverlay(graph, this.governance);
    }

    this.caches.graph = graph;
    return graph;
  }

  private ensureRuntimeFindings(): Finding[] {
    if (!this.snapshot) {
      return [];
    }

    if (!this.caches.runtimeFindings) {
      const graph = this.ensureGraph();
      this.caches.runtimeFindings = combinedFindings(
        analyzeActionAvailability(graph),
        analyzeGuardBreakdowns(graph),
        analyzeSnapshotDiff(graph)
      );
    }

    return this.caches.runtimeFindings;
  }

  private ensureTraceFindings(): Finding[] {
    if (!this.trace) {
      return [];
    }

    if (!this.caches.traceFindings) {
      this.caches.traceFindings = combinedFindings(
        analyzeExecutionPath(this.trace),
        analyzePatchSummary(this.trace),
        analyzeEffectSummary(this.trace)
      );
    }

    return this.caches.traceFindings;
  }

  private ensureLineageFindings(): Finding[] {
    if (!this.lineage) {
      return [];
    }

    if (!this.caches.lineageFindings) {
      this.caches.lineageFindings = combinedFindings(
        analyzeBranchState(this.lineage, {
          staleMs: this.options.lineageStaleMs
        }),
        analyzeDagState(this.lineage),
        analyzeSealAttempts(this.lineage)
      );
    }

    return this.caches.lineageFindings;
  }

  private ensureGovernanceFindings(): Finding[] {
    if (!this.governance) {
      return [];
    }

    if (!this.caches.governanceFindings) {
      this.caches.governanceFindings = combinedFindings(
        analyzeProposalState(this.governance, {
          staleMs: this.options.governanceProposalStaleMs
        }),
        analyzeGateState(this.governance),
        analyzeGovernedPaths(this.governance)
      );
    }

    return this.caches.governanceFindings;
  }

  private getExplainedFindings(graph: SemanticGraphIR): Finding[] {
    return combinedFindings(
      this.staticFindings,
      this.ensureRuntimeFindings(),
      this.ensureTraceFindings(),
      this.ensureLineageFindings(),
      this.ensureGovernanceFindings()
    ).map((finding) => explainFinding(graph, finding));
  }

  private unwrapOverlay<T>(
    result: IngestResult<T>,
    overlayName: OverlayKind
  ): T | undefined {
    if (this.options.validationMode === "strict" && result.issues.length > 0) {
      throw new Error(`Invalid ${overlayName} overlay.\n${formatIssues(result.issues)}`);
    }

    return result.value;
  }

  private invalidate(kind: OverlayKind): void {
    this.caches.graph = undefined;

    if (kind === "snapshot") {
      this.caches.runtimeContext = undefined;
      this.caches.runtimeFindings = undefined;
      return;
    }

    if (kind === "trace") {
      this.caches.traceFindings = undefined;
      return;
    }

    if (kind === "lineage") {
      this.caches.lineageFindings = undefined;
      return;
    }

    this.caches.governanceFindings = undefined;
  }
}
