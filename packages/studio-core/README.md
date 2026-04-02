# `@manifesto-ai/studio-core`

Read-only analysis engine for Manifesto domain models. The package builds a static graph from `DomainSchema`, optionally enriches it with runtime and control-plane overlays, and returns surface-neutral JSON projections for CLI, MCP, and dashboard consumers.

## Entry Point

```ts
import { createStudioSession } from "@manifesto-ai/studio-core";

const session = createStudioSession({
  schema,
  snapshot,
  trace,
  lineage,
  governance
}, {
  validationMode: "lenient",
  lineageStaleMs: 1000 * 60 * 60 * 24,
  governanceProposalStaleMs: 1000 * 60 * 60 * 24
});
```

`createStudioSession(bundle, options?)` is the only supported runtime entrypoint.

Session options:

- `validationMode`: `"lenient"` or `"strict"`
- `lineageStaleMs`: stale threshold for `branch-stale`
- `governanceProposalStaleMs`: stale threshold for `proposal-stale`

## Session Flow

```ts
const session = createStudioSession({ schema });

const graph = session.getGraph("full");
const findings = session.getFindings();

session.attachSnapshot(snapshot);
const availability = session.getActionAvailability();
const blocker = session.explainActionBlocker("submit");

session.attachTrace(trace);
const replay = session.analyzeTrace();

session.attachLineage(lineage);
const lineageState = session.getLineageState();

session.attachGovernance(governance);
const governanceState = session.getGovernanceState();
```

Supported session methods:

- `attachSnapshot(snapshot)`
- `attachTrace(trace)`
- `attachLineage(lineage)`
- `attachGovernance(governance)`
- `detachOverlay(kind)`
- `getGraph(format?)`
- `getFindings(filter?)`
- `getActionAvailability()`
- `explainActionBlocker(actionId)`
- `inspectSnapshot()`
- `analyzeTrace()`
- `getLineageState()`
- `getGovernanceState()`
- `dispose()`

## Projection Contracts

Stable projections are renderer-agnostic JSON payloads.

- `getGraph()` returns `DomainGraphProjection`
- `getFindings()` returns `FindingsReportProjection`
- `getActionAvailability()` returns `ActionAvailabilityProjection[]`
- `explainActionBlocker()` returns `ActionBlockerProjection`
- `inspectSnapshot()` returns `SnapshotInspectorProjection`
- `analyzeTrace()` returns `TraceReplayProjection`
- `getLineageState()` returns `LineageStateProjection`
- `getGovernanceState()` returns `GovernanceStateProjection`

All stable projections and findings are JSON-serializable. Golden fixtures for the current package contract live under [test/golden](./test/golden).

## Input Adaptation

`lineage` and `governance` accept both canonical studio exports and plain query-like inputs.

- canonical exports: `LineageExport`, `GovernanceExport`
- widened input: records, tuple-entry arrays, and value arrays for `worlds`, `attempts`, `proposals`, and `gates`
- keyed inputs may omit `worldId`, `id`, or `branchId` when the surrounding key already provides it

Inputs are normalized into canonical `Map`-backed export shapes before graph or analyzer code runs.

## Overlay Absence

Optional overlays never fail the entire session. Overlay-specific APIs return structured `"not-provided"` payloads when the required input is absent.

- no `snapshot`: runtime availability, blocker explanation, and snapshot inspection return `"not-provided"`
- no `trace`: trace replay returns `"not-provided"`
- no `lineage`: lineage state returns `"not-provided"`
- no `governance`: governance state returns `"not-provided"`

`getGraph()` and `getFindings()` always work with `schema` alone.

Validation behavior is session-scoped.

- `validationMode: "lenient"` drops malformed optional overlays and degrades to `"not-provided"`
- `validationMode: "strict"` throws during session creation or overlay attach when an overlay is malformed

## Heuristics

Two analyzers are intentionally heuristic and may over-report:

- `guard-unsatisfiable`
  Detects guards that fold to a static false result under local expression reasoning. It does not model all runtime-dependent values, so complex guards can be flagged conservatively.
- `convergence-risk`
  Flags flows that appear not to converge on a terminal halt/fail boundary. It does not model every indirect control transfer or external stabilizing effect.

Consumers should treat both findings as investigation prompts, not proof of invalid runtime behavior.

## Compatibility Notes

- Runtime oracle integration uses `@manifesto-ai/core` public APIs only.
- `@manifesto-ai/compiler`, `@manifesto-ai/sdk`, and `@manifesto-ai/codegen` are installed in this workspace for end-to-end integration work, but `studio-core` has a single production dependency: `@manifesto-ai/core`.
- `@manifesto-ai/codegen@0.2.1` currently emits a peer warning against newer `@manifesto-ai/core` versions. The warning is non-blocking for the current `studio-core` build and test matrix.
