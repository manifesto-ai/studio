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

All tools execute client-side in `AgentLens` because they read/mutate the
live Manifesto runtime in the browser. The server receives tool schemas only
and never runs tool implementations.

## MEL source edits

Source-change requests use the same single-loop agent as everything else —
there is no separate Author server agent. The model is given four source-
aware tools:

- `inspectSourceOutline` — list every declaration with line ranges.
- `readDeclaration` — return the exact source text for one declaration.
- `findInSource` — grep the current MEL source.
- `createProposal` — submit a full proposed source; the shadow verifier
  (`session/proposal-verifier`) builds it and gates acceptance.

The system prompt tells the model to outline, read the targets it intends
to touch, and only then call `createProposal` with the complete file.
`createProposal` does NOT edit source directly — the proposal is rendered
by `ui/ProposalPreview` and applied only when the user clicks Accept
(`adapter.setSource` + `adapter.requestBuild`).

## Why no React in `tools/agents/session/`

The whole point of the in-app prototype is that once these three
directories' API settles, we can lift them verbatim into a package with
`package.json` + `tsconfig` + `tsup` and nothing else. React / Monaco /
webapp-local imports would break that promise. The import-boundaries
test fails loudly on violations so the discipline lives in CI, not in
anyone's head.
