import type {
  AnalysisBundle,
  GovernanceExport,
  LineageExport,
  Snapshot,
  TraceGraph
} from "../contracts/inputs.js";
import type { StudioValidationMode } from "../contracts/session.js";
import type { IngestResult, IngestValidationIssue } from "./issues.js";
import type { IngestedSchema } from "./schema-ingest.js";

import { formatIssues } from "./issues.js";
import { ingestGovernance } from "./governance-ingest.js";
import { ingestLineage } from "./lineage-ingest.js";
import { ingestSchema } from "./schema-ingest.js";
import {
  createInvalidSnapshotOverlayError,
  ingestSnapshot
} from "./snapshot-ingest.js";
import { ingestTrace } from "./trace-ingest.js";

export type NormalizedOverlayState<T> = {
  provided: boolean;
  value?: T;
  issues: IngestValidationIssue[];
};

export type NormalizedAnalysisBundle = IngestedSchema & {
  snapshot: NormalizedOverlayState<Snapshot>;
  trace: NormalizedOverlayState<TraceGraph>;
  lineage: NormalizedOverlayState<LineageExport>;
  governance: NormalizedOverlayState<GovernanceExport>;
};

function absentOverlay<T>(): NormalizedOverlayState<T> {
  return {
    provided: false,
    issues: []
  };
}

function normalizeProvidedOverlay<T>(
  provided: boolean,
  ingestResult: IngestResult<T> | T,
  overlayName: string,
  validationMode: StudioValidationMode
): NormalizedOverlayState<T> {
  if (!provided) {
    return absentOverlay<T>();
  }

  const result =
    typeof ingestResult === "object" && ingestResult !== null && "issues" in ingestResult
      ? (ingestResult as IngestResult<T>)
      : ({
          value: ingestResult as T,
          issues: []
        } satisfies IngestResult<T>);

  if (validationMode === "strict" && result.issues.length > 0) {
    throw new Error(`Invalid ${overlayName} overlay.\n${formatIssues(result.issues)}`);
  }

  return {
    provided: true,
    value: result.value,
    issues: result.issues
  };
}

export function normalizeAnalysisBundle(
  bundle: AnalysisBundle,
  options: { validationMode?: StudioValidationMode } = {}
): NormalizedAnalysisBundle {
  const validationMode = options.validationMode ?? "lenient";
  const { schema, schemaHash } = ingestSchema(bundle.schema);
  const snapshotResult =
    bundle.snapshot !== undefined ? ingestSnapshot(bundle.snapshot) : undefined;

  if (snapshotResult && snapshotResult.issues.length > 0) {
    throw createInvalidSnapshotOverlayError(snapshotResult.issues);
  }

  return {
    schema,
    schemaHash,
    snapshot: normalizeProvidedOverlay(
      bundle.snapshot !== undefined,
      snapshotResult ?? absentOverlay<Snapshot>(),
      "snapshot",
      validationMode
    ),
    trace: normalizeProvidedOverlay(
      bundle.trace !== undefined,
      bundle.trace ? ingestTrace(bundle.trace) : absentOverlay<TraceGraph>(),
      "trace",
      validationMode
    ),
    lineage: normalizeProvidedOverlay(
      bundle.lineage !== undefined,
      bundle.lineage ? ingestLineage(bundle.lineage) : absentOverlay<LineageExport>(),
      "lineage",
      validationMode
    ),
    governance: normalizeProvidedOverlay(
      bundle.governance !== undefined,
      bundle.governance ? ingestGovernance(bundle.governance) : absentOverlay<GovernanceExport>(),
      "governance",
      validationMode
    )
  };
}
