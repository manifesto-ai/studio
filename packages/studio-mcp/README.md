# @manifesto-ai/studio-mcp

Stateful MCP surface over `@manifesto-ai/studio-core`.

## Usage

```bash
pnpm build
pnpm studio:mcp --help
pnpm studio:mcp --mel apps/web/src/domain/coin-sapiens.mel
pnpm studio:mcp:http -- --host 0.0.0.0 --port 8787 --mel apps/web/src/domain/coin-sapiens.mel
```

Start the server with a default schema or bundle, then reuse that context across tool calls.

## Transports

### Stdio

Use stdio for local MCP clients that spawn the server as a subprocess.

```bash
pnpm studio:mcp --mel apps/web/src/domain/coin-sapiens.mel
```

### HTTP

Use HTTP for remote clients and hosted deployments.

```bash
pnpm studio:mcp:http -- --host 0.0.0.0 --port 8787 --endpoint /mcp --mel apps/web/src/domain/coin-sapiens.mel
```

The HTTP server exposes:

- `GET /` metadata
- `GET /healthz` health check
- `POST /mcp` Streamable HTTP MCP requests
- `GET /mcp` Streamable HTTP session stream
- `DELETE /mcp` session termination

For Claude Desktop custom connectors, place this server behind a remotely reachable HTTPS URL and use the `/mcp` endpoint URL in Claude.

In Claude Desktop, add it from `Settings > Connectors > Add custom connector`, then enter the public connector name and URL.

Example public URL:

```text
https://studio-mcp.example.com/mcp
```

## Tool Surface

- `explain_action_blocker`
- `get_domain_graph`
- `find_issues`
- `get_action_availability`
- `analyze_trace`
- `get_lineage_state`
- `get_governance_state`

## Resource Surface

- `studio://domain/graph`
- `studio://domain/findings`
- `studio://domain/schema`
