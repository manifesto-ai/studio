# @manifesto-ai/studio

`pnpm` + `turborepo` monorepo with:

- `apps/web`: Vite 8 + TypeScript web app
- `packages/studio-core`: `tsup` bundled Node/TypeScript package
- `packages/studio-node`: shared Node surface for file loading and studio operations
- `packages/studio-cli`: CLI wrapper around `studio-core`
- `packages/studio-mcp`: MCP server wrapper around `studio-core`

## Commands

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
- `studio-cli` supports `analyze`, `check`, `graph`, `explain`, `trace`, `availability`, `snapshot`, `lineage`, and `governance`.
- `studio-mcp` exposes the PRD MVP tools `explain_action_blocker`, `get_domain_graph`, `find_issues`, `get_action_availability`, `analyze_trace`, `get_lineage_state`, and `get_governance_state`.
- `studio-mcp` supports both stdio and Streamable HTTP transport. Remote Claude connectors should target a public HTTPS URL ending in `/mcp`.
- Package-level usage docs live in `packages/studio-cli/README.md` and `packages/studio-mcp/README.md`.
