# Studio Agent (in-app prototype)

Phase α–δ implementation of the Studio agent layer, structured as if it
were a package so extraction to `@manifesto-ai/studio-agent-core` /
`@manifesto-ai/studio-agent-react` is mechanical when the criteria in
`docs/studio-agent-roadmap.md §0.3` fire.

## Directory contract

| Dir | Role | Future home | React allowed? |
|---|---|---|---|
| `tools/` | Deterministic wrappers around Studio SDK / core verbs — legality, simulate, source-map, graph, snapshot, dispatch, proposal creation. Return LLM-facing JSON. | `studio-agent-core` | ❌ |
| `agents/` | Future sub-agents (Repair, Critic, UI Intent). Not used in the AI SDK MVP loop yet. | `studio-agent-core` | ❌ |
| `session/` | Prompt context, recent-turn projection, single proposal buffer, proposal verifier. | `studio-agent-core` | ❌ |
| `adapters/` | Bridges local `AgentTool` registry to AI SDK schema/tool-result shapes. | `studio-agent-core` | ❌ |
| `ui/` | React components for Agent lens, chat, proposal preview. | `studio-agent-react` | ✅ |

The "React allowed?" column is enforced by `src/agent/__tests__/import-boundaries.test.ts`
so the three "future-core" dirs cannot accidentally pull React / Monaco /
webapp-local modules. See that test for the exact rules.

## LLM provider

Transport is Vercel AI SDK through the server proxy
`/api/agent/chat`. The browser sends the current system prompt and
tool schemas; the server forwards to the configured provider and
streams AI SDK UI messages back.

Gateway:

```
AGENT_MODEL_PROVIDER=gateway
AI_GATEWAY_API_KEY=...
AI_GATEWAY_MODEL=google/gemma-4-26b-a4b-it
```

Ollama:

```
AGENT_MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=gemma4:e4b
# OLLAMA_API_KEY=... # optional, only for protected proxies
```

`OLLAMA_HOST` is also accepted and normalized to `/v1`, so either
`http://localhost:11434` or `http://localhost:11434/v1` works. If
`AGENT_MODEL_PROVIDER` is omitted, the handler picks Ollama when any
`OLLAMA_*` env is present, otherwise Gateway when `AI_GATEWAY_*` env is
present, otherwise local Ollama defaults.

Most tools execute client-side in `AgentLens` because they read/mutate the
live Manifesto runtime in the browser. The server receives schemas only,
never those live-runtime tool implementations.

Exception: `authorMelProposal` calls `/api/agent/author`, where the server
runs the headless MEL Author Agent against a source string in an ephemeral
workspace. That route has no access to the live browser runtime and returns
only a draft source for the normal proposal verifier. The Author Agent also
gets a package-local `searchAuthorGuide` tool backed by bundled MEL reference,
syntax, and error-guide Markdown; it uses this for uncertain constructs and
compiler diagnostics instead of relying only on model memory.

Author tool calls are also recorded into the Author Agent's own lifecycle
lineage and returned as `authorLineage` on `/api/agent/author` responses.
This makes silent failures observable without server log scraping; a
`readSource`-only stop is classified as `stalled` and recorded through
`markStalled("read_source_only_stop")`. The lifecycle also caps retry
records with `maxRetries` / `canRetry`; the host does not automatically
retry from this signal yet.

If authoring fails, the route returns a structured `failureReport`
(`failureKind`, diagnostics, compact tool trace, source excerpt, retry
advice). The UI Agent uses that report to explain the failure, ask the
user when the request is ambiguous, or retry once with a narrower request.

## MEL Author + Verified Patch

Source-change requests now prefer `authorMelProposal`, which delegates to
`@manifesto-ai/studio-mel-author-agent`. That package runs a headless,
ephemeral MEL workspace and returns a full-source draft. The webapp then
passes the draft through the same verified proposal buffer.

`createProposal` remains as a low-level fallback when a complete proposed
source is already available. Neither path edits source directly. The
proposal is shadow-built by the verifier in `session/`, rendered by
`ui/ProposalPreview`, and applied only when the user clicks Accept
(`adapter.setSource` + `adapter.requestBuild`).

## Why no React in `tools/agents/session/`

The whole point of the in-app prototype is that once these three
directories' API settles, we can lift them verbatim into a package with
`package.json` + `tsconfig` + `tsup` and nothing else. React / Monaco /
webapp-local imports would break that promise. The import-boundaries
test fails loudly on violations so the discipline lives in CI, not in
anyone's head.
