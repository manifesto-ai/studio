# @manifesto-ai/studio

Read-only inspection surfaces for Manifesto domains.

Use Studio after a domain already exists and you want findings, graphs, snapshot inspection, trace replay, or agent-facing analysis tools. Studio is not the runtime bootstrap path.

Most users should start with:

- `@manifesto-ai/studio-cli` for local terminal inspection
- `@manifesto-ai/studio-mcp` for agent or remote-tool access
- `@manifesto-ai/studio-core` only when embedding Studio into a service or dashboard

This `pnpm` + `turborepo` monorepo contains:

- `apps/web`: Vite 8 + TypeScript web app
- `packages/studio-core`: `tsup` bundled Node/TypeScript package
- `packages/studio-node`: shared Node surface for file loading and Studio operations
- `packages/studio-cli`: CLI wrapper around `studio-core`
- `packages/studio-mcp`: MCP server wrapper around `studio-core`

## Quick Start

```bash
pnpm install
pnpm build
pnpm studio:cli analyze path/to/domain.mel
pnpm studio:cli snapshot path/to/domain.mel --snapshot path/to/canonical-snapshot.json
pnpm studio:mcp --help
```

## Choose A Surface

| Surface | Use It When |
|---------|-------------|
| `studio-cli` | You want read-only inspection in a terminal or CI job |
| `studio-mcp` | An MCP client needs graph, findings, or overlay tools |
| `studio-core` | You are building a custom dashboard or analysis service |
| `studio-node` | You need the shared file-loading adapter used by CLI and MCP |

## Workspace Commands

```bash
pnpm install
pnpm dev
pnpm dev:mcp
pnpm build
pnpm typecheck
pnpm mel:lsp
pnpm studio:cli help
pnpm studio:cli analyze path/to/domain.mel
pnpm studio:cli graph path/to/domain.mel --format json
pnpm studio:cli graph path/to/domain.mel --format dot
pnpm studio:cli snapshot path/to/domain.mel --snapshot path/to/canonical-snapshot.json
pnpm studio:cli transition-graph --observations path/to/observations.json --preset path/to/projection-preset.json
pnpm studio:mcp --help
pnpm studio:mcp:http -- --host 0.0.0.0 --port 8787 --mel path/to/domain.mel
```

## MEL Tooling

- `apps/web/src/domain/*.mel` files are compiled by `@manifesto-ai/compiler/vite`.
- Web builds emit generated domain interfaces into `apps/web/src/generated/*.domain.ts`.
- `pnpm mel:lsp` starts `@manifesto-ai/mel-lsp` over stdio for editor integration.

## Studio Surfaces

- `studio-cli` and `studio-mcp` both resolve `.mel` or JSON inputs through the shared `@manifesto-ai/studio-node` package.
- Both surfaces ultimately call the same `createStudioSession(bundle, options?)` flow from `@manifesto-ai/studio-core`.
- `studio-cli` supports `analyze`, `check`, `graph`, `explain`, `trace`, `availability`, `snapshot`, `lineage`, `governance`, and `transition-graph`.
- `studio-mcp` exposes `explain_action_blocker`, `get_domain_graph`, `find_issues`, `get_action_availability`, `analyze_trace`, `get_lineage_state`, and `get_governance_state`.
- `studio-mcp` supports both stdio and Streamable HTTP transport. Remote connectors should target a public HTTPS URL ending in `/mcp`.
- Package-level usage docs live in `packages/studio-cli/README.md` and `packages/studio-mcp/README.md`.
- Runnable JSON inputs for `studio-cli` live in `packages/studio-cli/examples/`.
