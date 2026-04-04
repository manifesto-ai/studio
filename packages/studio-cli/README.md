# @manifesto-ai/studio-cli

`@manifesto-ai/studio-cli` is the terminal surface for `@manifesto-ai/studio-core`.

Use it when you want to compile a MEL domain, attach runtime overlays, and inspect Studio projections from a shell script, CI job, or local terminal.

## Install

Global install:

```bash
npm install -g @manifesto-ai/studio-cli
```

Run without installing:

```bash
npx @manifesto-ai/studio-cli --help
```

## Runnable example files in this repo

The package includes runnable example inputs under `packages/studio-cli/examples/`.

- `demo-schema.json`: `DomainSchema`
- `canonical-snapshot.json`: ready canonical snapshot
- `canonical-snapshot-blocked.json`: blocked canonical snapshot
- `trace.json`: `TraceGraph`
- `lineage.json`: lineage input JSON
- `governance.json`: governance input JSON
- `observations.json`: `ObservationRecord[]`
- `projection-preset.json`: `ProjectionPreset`
- `studio-bundle.json`: bundle with schema + overlays

You can run every command in this README directly against those files.

## Input JSON cheat sheet

### Domain schema

`graph`, `analyze`, `check`, `explain`, `availability`, `snapshot`, `lineage`, and `governance` all start from a schema or bundle.

Top-level shape:

```json
{
  "id": "demo.studio",
  "version": "0.1.0",
  "state": { "fields": {} },
  "computed": { "fields": {} },
  "actions": {},
  "meta": {},
  "hash": "..."
}
```

Runnable example:

- `packages/studio-cli/examples/demo-schema.json`

### Canonical snapshot

Snapshot input must be a canonical snapshot from `runtime.getCanonicalSnapshot()`.

Top-level shape:

```json
{
  "data": {},
  "computed": {},
  "system": {
    "status": "idle",
    "lastError": null,
    "pendingRequirements": [],
    "currentAction": null
  },
  "meta": {
    "version": 0,
    "timestamp": 1710000000000,
    "randomSeed": "studio-seed",
    "schemaHash": "..."
  },
  "input": null
}
```

Runnable examples:

- `packages/studio-cli/examples/canonical-snapshot.json`
- `packages/studio-cli/examples/canonical-snapshot-blocked.json`

### Trace graph

Top-level shape:

```json
{
  "root": {},
  "nodes": {},
  "intent": {},
  "baseVersion": 1,
  "resultVersion": 2,
  "duration": 5,
  "terminatedBy": "complete"
}
```

Runnable example:

- `packages/studio-cli/examples/trace.json`

### Lineage input

For JSON input, use arrays or plain keyed objects. You do not need to encode JavaScript `Map` values directly.

Top-level shape:

```json
{
  "activeBranchId": "main",
  "branches": [],
  "worlds": [],
  "attempts": []
}
```

Runnable example:

- `packages/studio-cli/examples/lineage.json`

### Governance input

For JSON input, use arrays or plain keyed objects.

Top-level shape:

```json
{
  "proposals": [],
  "bindings": [],
  "gates": []
}
```

Runnable example:

- `packages/studio-cli/examples/governance.json`

### Transition graph inputs

`transition-graph` does not infer itself from `trace`. It takes explicit observation records plus a preset.

Observation record shape:

```json
[
  {
    "id": "record-1",
    "mode": "live",
    "actionId": "submit",
    "args": [],
    "outcome": "committed",
    "beforeSnapshot": {},
    "afterSnapshot": {},
    "timestamp": 1
  }
]
```

Preset shape:

```json
{
  "id": "runtime-readiness",
  "name": "Runtime Readiness",
  "observe": [],
  "groupBy": [],
  "options": {
    "includeBlocked": true,
    "includeDryRun": true
  }
}
```

Runnable examples:

- `packages/studio-cli/examples/observations.json`
- `packages/studio-cli/examples/projection-preset.json`

## Quick start

Run findings:

```bash
studio-cli analyze packages/studio-cli/examples/demo-schema.json
```

Actual output:

```text
ERROR missing-producer: state:draft
  → State field "draft" has no patch producer.
  ↳ state: state.draft

WARN  dead-state: state:lastSubmittedAt
  → State field "lastSubmittedAt" is not referenced by computed fields or action guards.
  ↳ state: state.lastSubmittedAt

Summary: 1 errors, 1 warnings, 0 info
```

Inspect runtime state:

```bash
studio-cli snapshot packages/studio-cli/examples/demo-schema.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot.json
```

Actual output:

```text
Snapshot version: 0
Schema hash: b307e0e4301312154d1d4d261558e7cbdd5600889a97383e5e20684c281b68ac
  - draft: "hello"
  - hasUser: undefined
  - lastSubmittedAt: 123
  - userId: "user-1"
```

## Command reference

### `analyze`

Run findings analysis across the schema and attached overlays.

```bash
studio-cli analyze packages/studio-cli/examples/demo-schema.json
studio-cli analyze packages/studio-cli/examples/demo-schema.json --severity error,warn
studio-cli analyze packages/studio-cli/examples/demo-schema.json --kind missing-producer --subject state:draft --output json
studio-cli analyze --bundle packages/studio-cli/examples/studio-bundle.json
```

### `check`

`check` is the same analysis surface as `analyze`.

```bash
studio-cli check packages/studio-cli/examples/demo-schema.json --severity error
```

### `graph`

Inspect the semantic domain graph.

```bash
studio-cli graph packages/studio-cli/examples/demo-schema.json
studio-cli graph packages/studio-cli/examples/demo-schema.json --format full --output json
studio-cli graph packages/studio-cli/examples/demo-schema.json --format dot
```

Actual summary output:

```text
Domain graph
Schema hash: b307e0e4301312154d1d4d261558e7cbdd5600889a97383e5e20684c281b68ac
Nodes: 10
Edges: 12
Node kinds:
  - action: 2
  - computed: 1
  - effect: 1
  - guard: 1
  - patch-target: 2
  - state: 3
```

Formats:

- `summary`: compact text summary
- `full`: full projection object
- `json`: graph payload as JSON
- `dot`: Graphviz DOT output

### `explain`

Explain why an action is available, blocked, or unreachable.

```bash
studio-cli explain submit packages/studio-cli/examples/demo-schema.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot-blocked.json
```

Actual blocked output:

```text
submit is BLOCKED
Action "submit" is currently blocked by its availability guard.
  ✗ (userId neq null)
  ✗ (draft neq "")
Cause chain:
  - static: action: actions.submit
  - static: guard: actions.submit.available
```

Ready snapshot example:

```bash
studio-cli explain submit packages/studio-cli/examples/demo-schema.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot.json
```

### `availability`

Return availability state for every action in the current snapshot.

```bash
studio-cli availability packages/studio-cli/examples/demo-schema.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot-blocked.json
```

Actual blocked output:

```text
setUser: available
submit: blocked (2 blockers)
```

Ready snapshot example:

```bash
studio-cli availability packages/studio-cli/examples/demo-schema.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot.json
```

### `snapshot`

Inspect state and computed values from a canonical snapshot.

```bash
studio-cli snapshot packages/studio-cli/examples/demo-schema.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot.json
studio-cli snapshot packages/studio-cli/examples/demo-schema.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot.json \
  --output json
```

### `trace`

Analyze a trace replay overlay.

```bash
studio-cli trace packages/studio-cli/examples/trace.json \
  --schema packages/studio-cli/examples/demo-schema.json
```

Actual output:

```text
Intent: submit
Duration: 5
Terminated by: complete
Steps:
  - root (flow) @ actions.submit.flow
  - effect1 (effect) @ actions.submit.flow.steps.0
  - patch1 (patch) @ actions.submit.flow.steps.1
```

### `lineage`

Inspect lineage branch, world, and seal state.

```bash
studio-cli lineage packages/studio-cli/examples/demo-schema.json \
  --lineage packages/studio-cli/examples/lineage.json
```

Actual output:

```text
Active branch: main
Branches: 2
Worlds: 2
  - main: head=world-1 tip=world-2 epoch=2
  - orphan: head=none tip=none epoch=1
```

### `governance`

Inspect governance proposal, actor, and gate state.

```bash
studio-cli governance packages/studio-cli/examples/demo-schema.json \
  --governance packages/studio-cli/examples/governance.json
```

Actual output:

```text
Proposals: 2
Bindings: 2
Gates: 2
  - proposal-1: ingress on main by alice
  - proposal-2: terminal on release by lead
```

### `transition-graph`

Project observed runtime transitions into grouped nodes and edges.

```bash
studio-cli transition-graph \
  --observations packages/studio-cli/examples/observations.json \
  --preset packages/studio-cli/examples/projection-preset.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot.json
```

Actual output:

```text
Preset: Runtime Readiness (runtime-readiness)
Current node: projection:[{"key":"draft","value":"true"},{"key":"userId","value":"true"}]
Nodes: 3
Edges: 3
Nodes:
  - Draft=false · Has User=false [id=projection:[{"key":"draft","value":"false"},{"key":"userId","value":"false"}]] observations=2 current=false
  - Draft=true · Has User=false [id=projection:[{"key":"draft","value":"true"},{"key":"userId","value":"false"}]] observations=1 current=false
  - Draft=true · Has User=true [id=projection:[{"key":"draft","value":"true"},{"key":"userId","value":"true"}]] observations=3 current=true
Edges:
  - submit: projection:[{"key":"draft","value":"false"},{"key":"userId","value":"false"}] -> projection:[{"key":"draft","value":"false"},{"key":"userId","value":"false"}] changed=none live=1 dryRun=0 blocked=1
  - submit: projection:[{"key":"draft","value":"true"},{"key":"userId","value":"false"}] -> projection:[{"key":"draft","value":"true"},{"key":"userId","value":"true"}] changed=Has User live=1 dryRun=0 blocked=0
  - submit: projection:[{"key":"draft","value":"true"},{"key":"userId","value":"true"}] -> projection:[{"key":"draft","value":"true"},{"key":"userId","value":"true"}] changed=none live=0 dryRun=1 blocked=0
```

JSON output:

```bash
studio-cli transition-graph \
  --observations packages/studio-cli/examples/observations.json \
  --preset packages/studio-cli/examples/projection-preset.json \
  --snapshot packages/studio-cli/examples/canonical-snapshot.json \
  --output json
```

## Common usage patterns

Use `--bundle` when:

- you want repeatable analysis inputs across multiple commands
- your CI pipeline already materializes schema and overlays together

Use `--mel` when:

- you are actively authoring MEL and want on-the-fly compilation
- you do not want to generate a separate schema JSON first

Use `--output json` when:

- another tool or script will consume the result
- you want a stable machine-readable payload in CI or automation

## Notes

- Snapshot input must be a canonical snapshot from `runtime.getCanonicalSnapshot()`.
- For `trace`, the positional argument is the trace file path.
- For JSON lineage/governance input, arrays are the safest interchange format.
- `transition-graph` consumes explicit observation records and a preset. It does not derive itself from trace data.
