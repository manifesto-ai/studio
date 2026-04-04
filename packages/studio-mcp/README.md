# @manifesto-ai/studio-mcp

`@manifesto-ai/studio-mcp` exposes `@manifesto-ai/studio-core` as a read-only MCP server.

Use it when an MCP client needs to inspect a Manifesto domain through tools instead of calling Studio APIs directly. If you are just inspecting locally in a shell, start with `@manifesto-ai/studio-cli`.

Most users should start with stdio transport:

```bash
npx @manifesto-ai/studio-mcp --transport stdio --mel path/to/domain.mel
```

## Install

Global install:

```bash
npm install -g @manifesto-ai/studio-mcp
```

Run without installing:

```bash
npx @manifesto-ai/studio-mcp --transport stdio --mel path/to/domain.mel
```

## What It Does

`studio-mcp` can:

- start with a default domain context from MEL, schema JSON, or bundle JSON
- attach default overlays such as canonical snapshot, trace, lineage, and governance
- serve graph, findings, availability, trace, lineage, and governance through MCP tools
- expose default graph, findings, and schema summaries as MCP resources

## Typical Usage

### Local stdio server

Use this when your MCP client spawns the server as a subprocess.

```bash
studio-mcp --mel path/to/domain.mel
```

### Remote HTTP server

Use this when you need a remotely reachable MCP endpoint.

```bash
studio-mcp \
  --transport http \
  --host 0.0.0.0 \
  --port 8787 \
  --endpoint /mcp \
  --mel path/to/domain.mel
```

HTTP endpoints:

- `GET /`: metadata
- `GET /healthz`: health check
- `POST /mcp`: Streamable HTTP MCP requests
- `GET /mcp`: Streamable HTTP session stream
- `DELETE /mcp`: Streamable HTTP session termination

For remote connector products, front this server with HTTPS and point the client at the `/mcp` endpoint.

## Startup context

At startup you can establish a default server context with:

- `--bundle <file>`: analysis bundle JSON
- `--schema <file>`: `DomainSchema` JSON
- `--mel <file>`: MEL file compiled at startup
- `--snapshot <file>`: canonical snapshot JSON from `runtime.getCanonicalSnapshot()`
- `--trace <file>`: trace graph JSON
- `--lineage <file>`: lineage export JSON
- `--governance <file>`: governance export JSON
- `--validation-mode <lenient|strict>`
- `--lineage-stale-ms <number>`
- `--governance-proposal-stale-ms <number>`

The server keeps that context as the default for later tool calls.

This is useful when:

- one MCP session is focused on one domain
- you do not want to repeat schema or overlay paths on every request

## Tool surface

### `get_domain_graph`

Return the semantic domain graph.

Inputs:

- optional `format`: `summary` or `full`
- optional file-path or inline overrides

### `find_issues`

Run Studio findings analysis.

Filters:

- `severity`
- `kinds`
- `subjects`
- `provenance`

### `explain_action_blocker`

Explain why a specific action is blocked.

Input:

- `action_id`

### `get_action_availability`

Return availability for all actions using the current or overridden canonical snapshot.

### `analyze_trace`

Return trace replay analysis.

### `get_lineage_state`

Return lineage branch, world, and seal state.

### `get_governance_state`

Return governance proposal, actor, and gate state.

## Resource surface

These resources reflect the current default server context:

- `studio://domain/graph`
- `studio://domain/findings`
- `studio://domain/schema`

If the server starts without a default schema, these resources return an error payload telling the client to provide `--bundle`, `--schema`, or `--mel`.

## Per-request overrides

MCP clients can override the startup defaults on individual tool calls with:

- `bundle_path`, `schema_path`, `mel_path`
- `snapshot_path`, `trace_path`, `lineage_path`, `governance_path`
- `validation_mode`
- `lineage_stale_ms`, `governance_proposal_stale_ms`
- inline `schema`, `snapshot`, `trace_graph`, `lineage`, `governance`

Use startup defaults when one server instance is centered on one domain.

Use per-request overrides when:

- one server needs to inspect multiple domains
- the client wants to swap snapshots or traces per call
- the caller sends inline payloads instead of file paths

## File expectations

- Snapshot input must be a canonical snapshot.
- If you already have all inputs collected together, prefer `--bundle`.
- HTTP transport only changes how the server is reached. The Studio analysis surface is the same in stdio and HTTP modes.
