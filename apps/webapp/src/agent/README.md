# Studio Agent (in-app prototype)

Phase α–δ implementation of the Studio agent layer, structured as if it
were a package so extraction to `@manifesto-ai/studio-agent-core` /
`@manifesto-ai/studio-agent-react` is mechanical when the criteria in
`docs/studio-agent-roadmap.md §0.3` fire.

## Directory contract

| Dir | Role | Future home | React allowed? |
|---|---|---|---|
| `tools/` | Deterministic wrappers around Studio SDK / core verbs — legality, simulate, source-map, graph, snapshot, dispatch, proposal creation. Return LLM-facing JSON. | `studio-agent-core` | ❌ |
| `agents/` | Future sub-agents (Repair, Critic, UI Intent). Not used by the current AgentLens surface. | `studio-agent-core` | ❌ |
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

All tools execute client-side in `AgentLens` because they read/mutate the
live Manifesto runtime in the browser. The server receives tool schemas only
and never runs tool implementations.

## Schema freshness

The host syncs `{ userModuleReady, schemaHash }` into `studio.mel`. When the
compiled schema hash changes, MEL clears the observed schema hash and blocks
schema-dependent tools such as `dispatch`, `simulateIntent`, `generateMock`,
`seedMock`, `inspectAvailability`, and `inspectNeighbors`.

`inspectSchema` is the refresh checkpoint. After it returns the current
`schemaHash`, AgentLens dispatches `markAgentSchemaObserved(schemaHash)`, and
MEL admits schema-dependent tools again.

## Focus freshness

The host also tracks whether the selected Studio graph node has changed since
the last `inspectFocus` result. When it has, `studio.mel` blocks focus-dependent
domain tools and the prompt receives a coarse `selected_node_changed` signal.
The signal deliberately omits the focused node identity and projection. It only
tells the model that prior selected-node grounding is stale and should be
refreshed with `inspectFocus`.

## Prompt Contract

The system prompt includes the Fine MEL projection of the compiled Studio
UI/runtime/tool-admission contract. It does not include the full Studio MEL
source, user-domain MEL source, or runtime snapshot values; those stay behind
live inspect tools such as `inspectSchema`, `inspectSnapshot`, and
`inspectAvailability`.

On the first model request for a user turn, the prompt also includes a compact
`Turn Start Snapshot`. It is captured before the model's first step and is not
repeated on tool-result continuation requests. After any mutating tool result,
the model must treat it as stale and use live inspect tools.

## Long-horizon inspect tools

`inspectLineage` and `inspectConversation` are the escape hatches for context
that should not live in the system prompt. The prompt keeps only a short
recent-turn tail; older chat context is pulled through `inspectConversation`.
Past runtime changes are pulled through `inspectLineage`.

Both default to compact projections and expose pagination cursors. Lineage is
admitted only after the user MEL module is compiled; conversation history is
always admitted because it is owned by the chat framework, not the user module.

## Mock data tools

The live AgentLens catalog includes `generateMock` and `seedMock` once the
current MEL module is compiled and its schema has been observed through
`inspectSchema`. Both are admitted through tool-specific `studio.mel`
actions (`admitGenerateMock`, `admitSeedMock`), so they disappear from the
model-facing tool schema when the user runtime is not ready or schema knowledge
is stale.

- `generateMock` previews sample argument arrays for a domain action.
- `seedMock` generates those samples and dispatches them sequentially.

## Message Transport

The browser keeps the full chat transcript for rendering and
`inspectConversation`, but the model request sends only the active turn: the
latest user message plus any assistant/tool parts after it. Older turns enter
the model context through the compact recent-turn prompt tail or explicit
`inspectConversation` calls.

## MEL source edits

The current AgentLens runtime does not register source-authoring tools.
If the user asks for a MEL edit from this surface, the model should say the
admitted tool catalog cannot edit source instead of inventing a tool.

Workspace / proposal helpers still live under `tools/` and `workspace/` for
future authoring surfaces, but they are not part of the live AgentLens tool
catalog.

## Why no React in `tools/agents/session/`

The whole point of the in-app prototype is that once these three
directories' API settles, we can lift them verbatim into a package with
`package.json` + `tsconfig` + `tsup` and nothing else. React / Monaco /
webapp-local imports would break that promise. The import-boundaries
test fails loudly on violations so the discipline lives in CI, not in
anyone's head.
