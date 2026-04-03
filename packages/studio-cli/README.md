# @manifesto-ai/studio-cli

`@manifesto-ai/studio-cli` is the terminal interface for `@manifesto-ai/studio-core`.

Use it when you want to inspect a Manifesto domain from the shell without embedding Studio APIs in your own code.

## Install

Global install:

```bash
npm install -g @manifesto-ai/studio-cli
```

Run without installing:

```bash
npx @manifesto-ai/studio-cli analyze path/to/domain.mel
```

## What it does

`studio-cli` can:

- compile a MEL file or load a schema JSON
- attach runtime overlays such as snapshot, trace, lineage, and governance
- print findings in text or JSON
- explain action blockers
- inspect graph, availability, trace replay, lineage, governance, and snapshot projections

## Typical workflow

1. Start with a domain file and inspect findings:

```bash
studio-cli analyze path/to/domain.mel
```

2. Inspect the graph shape:

```bash
studio-cli graph path/to/domain.mel --format summary
studio-cli graph path/to/domain.mel --format full --output json
studio-cli graph path/to/domain.mel --format dot
```

3. Attach a canonical runtime snapshot and inspect runtime state:

```bash
studio-cli snapshot path/to/domain.mel --snapshot path/to/canonical-snapshot.json
studio-cli availability path/to/domain.mel --snapshot path/to/canonical-snapshot.json
studio-cli explain submit path/to/domain.mel --snapshot path/to/canonical-snapshot.json
```

4. Add richer overlays when needed:

```bash
studio-cli trace path/to/trace.json --schema path/to/domain.json
studio-cli lineage path/to/domain.mel --lineage path/to/lineage.json
studio-cli governance path/to/domain.mel --governance path/to/governance.json
```

## Inputs

Primary input, choose one:

- `--mel <file>`: compile a MEL file
- `--schema <file>`: load a `DomainSchema` JSON file
- `--bundle <file>`: load a full analysis bundle JSON file

Overlays:

- `--snapshot <file>`: canonical snapshot JSON from `runtime.getCanonicalSnapshot()`
- `--trace <file>`: trace graph JSON
- `--lineage <file>`: lineage export JSON
- `--governance <file>`: governance export JSON

Session options:

- `--validation-mode <lenient|strict>`
- `--lineage-stale-ms <number>`
- `--governance-proposal-stale-ms <number>`

Output:

- `--output <text|json>`: default is `text`

## Commands

### `analyze`, `check`

Run findings analysis.

```bash
studio-cli analyze path/to/domain.mel
studio-cli analyze path/to/domain.mel --severity error,warn
studio-cli analyze path/to/domain.mel --kind action-blocked --output json
studio-cli analyze --bundle path/to/studio-bundle.json
```

Available findings filters:

- `--severity <error,warn,info>`
- `--kind <finding-kind>`
- `--subject <node-id>`
- `--provenance <static,runtime,trace,lineage,governance>`

### `graph`

Render the semantic graph.

```bash
studio-cli graph path/to/domain.mel --format summary
studio-cli graph path/to/domain.mel --format full --output json
studio-cli graph path/to/domain.mel --format dot
```

Formats:

- `summary`: compact text-oriented summary
- `full`: full projection object
- `json`: same graph payload, emitted as JSON
- `dot`: Graphviz DOT output

### `explain`

Explain why an action is blocked.

```bash
studio-cli explain submit path/to/domain.mel --snapshot path/to/canonical-snapshot.json
studio-cli explain --action submit --bundle path/to/studio-bundle.json
```

### `availability`

Inspect action availability from a canonical snapshot.

```bash
studio-cli availability path/to/domain.mel --snapshot path/to/canonical-snapshot.json
```

### `snapshot`

Inspect state and computed values from a canonical snapshot.

```bash
studio-cli snapshot path/to/domain.mel --snapshot path/to/canonical-snapshot.json
```

### `trace`

Analyze trace replay.

```bash
studio-cli trace path/to/trace.json --schema path/to/domain.json
studio-cli trace path/to/trace.json --mel path/to/domain.mel --output json
```

### `lineage`

Inspect lineage branch, world, and seal state.

```bash
studio-cli lineage path/to/domain.mel --lineage path/to/lineage.json
```

### `governance`

Inspect governance proposal, actor, and gate state.

```bash
studio-cli governance path/to/domain.mel --governance path/to/governance.json
```

## File expectations

- Snapshot input must be a canonical snapshot, not a raw runtime snapshot-like object.
- If you already have everything in one file, prefer `--bundle`.
- For `trace`, the positional argument is the trace path. Supply the schema with `--schema` or `--mel` if it is not already inside a bundle.

## Recommended usage patterns

Use `--bundle` when:

- you want repeatable analysis across multiple commands
- you already export schema and overlays together

Use `--mel` when:

- you are iterating on a domain authoring workflow
- you want the CLI to compile the MEL file directly

Use `--output json` when:

- another tool or script will consume the result
- you want stable machine-readable output
