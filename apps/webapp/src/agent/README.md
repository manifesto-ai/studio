# Studio Agent (in-app prototype)

Phase α–δ implementation of the Studio agent layer, structured as if it
were a package so extraction to `@manifesto-ai/studio-agent-core` /
`@manifesto-ai/studio-agent-react` is mechanical when the criteria in
`docs/studio-agent-roadmap.md §0.3` fire.

## Directory contract

| Dir | Role | Future home | React allowed? |
|---|---|---|---|
| `tools/` | Deterministic wrappers around Studio SDK / core verbs — `legality`, `simulate`, `sourceMap`, `graph`, `schema`, `snapshot`. Return LLM-facing JSON. | `studio-agent-core` | ❌ |
| `agents/` | LLM-reasoning orchestrator + sub-agents (Author, Refactor, Critic, UI Intent). | `studio-agent-core` | ❌ |
| `session/` | Transcript / proposal buffer / per-project storage. | `studio-agent-core` | ❌ |
| `provider/` | LLM vendor adapter (Ollama for now). | `apps/webapp` (stays) | ✅ |
| `ui/` | React components for Agent lens, chat, proposal preview. | `studio-agent-react` | ✅ |

The "React allowed?" column is enforced by `src/agent/__tests__/import-boundaries.test.ts`
so the three "future-core" dirs cannot accidentally pull React / Monaco /
webapp-local modules. See that test for the exact rules.

## LLM provider

Self-hosted Ollama, endpoint + model configured via Vite env:

```
VITE_OLLAMA_URL=http://100.84.214.42:11434
VITE_OLLAMA_MODEL=gemma4:e4b
```

The provider (`provider/ollama.ts`) tries the OpenAI-compatible endpoint
(`/v1/chat/completions`) first — standard function-calling spec — and
falls back to the native `/api/chat` shape if needed. No vendor
abstraction layer: swapping providers later is a file replacement, not
an interface expansion.

## Why no React in `tools/agents/session/`

The whole point of the in-app prototype is that once these three
directories' API settles, we can lift them verbatim into a package with
`package.json` + `tsconfig` + `tsup` and nothing else. React / Monaco /
webapp-local imports would break that promise. The import-boundaries
test fails loudly on violations so the discipline lives in CI, not in
anyone's head.
