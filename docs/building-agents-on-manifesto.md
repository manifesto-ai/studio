# Building Agents on Manifesto — Happy Path

> Captured from the Studio Agent α landing (Phase α). This document
> is prescriptive: it encodes the patterns that worked after we
> discovered what didn't. Use it as a starting recipe when you wire
> an agent onto a new Manifesto runtime.

The TL;DR in one sentence:

> **MEL is identity (prompt), snapshot is state (tools). The runtime
> is a live object the agent investigates — never a dashboard you
> pre-render into prose.**

Every pattern below follows from that one split.

---

## 1. The System Prompt Contract

### Rule: put only what's stable-per-session in the prompt

| In the prompt | Pulled via tools |
|---|---|
| Identity anchor ("you know this runtime from the inside") | Current snapshot data + computed values |
| Tool catalog (names + what to call them for) | Which node is focused / active lens / view mode |
| Grounding recipe ("inspect first for deictics") | Which actions are available right now |
| The **MEL source** (identity, stable until edit) | Graph neighborhood of any node |
| Recent conversation tail (last N turns, compact) | Lineage / world history |

Why the split:
1. **Prompt caching.** Identity + tools + MEL is stable within a
   session. Dynamic state changes every dispatch; mixing it into the
   prompt invalidates the KV cache every turn.
2. **Freshness.** A tool call runs at call time; a prompt value is
   captured at prompt-build time. For any state that mutates inside
   a turn (dispatches happen between tool calls), the prompt would
   ship stale data.
3. **Agent-shaped reasoning.** The model learns to investigate
   before answering. This is where multi-step ReAct behavior comes
   from on small models, not from harder prompting.

### What the prompt actually looks like

Canonical structure (see
`apps/webapp/src/agent/session/agent-context.ts`):

```
You know this Manifesto runtime from the inside. The MEL below is
your soul source code — lived knowledge, not reference material.
Everything dynamic (focus, snapshot, availability, graph neighbors)
you introspect via tools; never guess.

# Tools
Inspect (dynamic state — call these first when questions touch 'this',
'now', 'current', counts, or relations):
- inspectFocus() — which node is focused + active lens / view mode.
- inspectSnapshot() — current state data + computed field values.
- inspectAvailability() — list of actions with live availability.
- inspectNeighbors(nodeId) — graph edges (feeds / mutates / unlocks).
- inspectLineage({...}) — recent dispatch history (projection).
- inspectConversation({...}) — search your own prior chat turns.
- explainLegality(action) — why a specific action is blocked.
Act:
- dispatch(action, args) — user-domain writes.
- studioDispatch(action, args) — UI writes (focus, lens, sim, scrub).
- seedMock({action, count, seed?}) — generate + dispatch N samples.
- generateMock({action, count, seed?}) — preview only.

# How to ground yourself
- Deictic ('this', '이거', etc.) → inspectFocus() first.
- State / count / value questions → inspectSnapshot().
- Relation questions → inspectNeighbors(nodeId).
- Blocked action → explainLegality.
- Don't describe the runtime in abstract terms. Answer concretely.

# Your soul (MEL)
```mel
<the domain module source, verbatim>
```

# Recent conversation (N most recent turns, newest first)
Older turns are searchable via `inspectConversation(...)`.

turn 3 · 2 tool
  user: why is this blocked?
  you: `toggleTodo` requires `todoCount > 0`.
...
```

### Anti-patterns that burned time

- **Enumerating deictic phrases ("this/that/it/이것/이거/이건/그거/...")
  in the rules.** Small models can miss the inflection you didn't
  include; writing `resolve ambiguous references to the focused node`
  as a directive beat the enumeration.
- **Stating rules as conditionals.** "When X, resolve Y" forces the
  model to classify first. Flip to directive form: "Default to Y
  unless something explicitly names otherwise."
- **Leaving an escape valve.** A rule like "If ambiguous, ask one
  clarifying question" gets quoted verbatim in the model's
  reasoning trace and pulls the branch every time. Remove the valve
  or the model takes it on requests that aren't actually ambiguous.
- **Baking snapshot JSON into the prompt.** Model reads current
  tasks count, then dispatches a createTask, the next tool call
  sees updated runtime but the prompt still says the old count →
  inconsistent story. Always read via tool.

---

## 2. The Tool Registry

### Split by intent: inspect / act / diagnose

| Channel | Tools | Purpose |
|---|---|---|
| Inspect (read) | `inspectFocus`, `inspectSnapshot`, `inspectNeighbors`, `inspectAvailability`, `inspectLineage`, `inspectConversation` | Pure reads against the runtime. Safe to call speculatively. |
| Act (write) | `dispatch`, `studioDispatch`, `seedMock` | Mutate snapshot / UI state. Run through legality gates. |
| Diagnose | `explainLegality`, `generateMock` (preview) | Explain without mutating. |

Color the UI of each channel (we use Studio's signal tokens:
action = violet, computed = cyan, effect = orange). This is what
makes the transcript read as a runtime op log instead of a generic
function-call trace.

### Projection is load-bearing

Every tool with a potentially-large output must default to a compact
shape and opt into heavy fields. Pattern:

```ts
export type InspectFooInput = {
  readonly limit?: number;
  readonly beforeId?: string;               // pagination cursor
  readonly fields?: readonly FooField[];    // opt-in heavy fields
  readonly filter?: string;                  // server-side filter
};

export type FooField = "largeField1" | "largeField2" | "timestamp";
```

Default payload per entry: just the primary key + one descriptor
(e.g. `{worldId, origin.intentType}` for lineage). Everything else
is `fields`-gated. This alone saved us from context blow-up on
10-step reasoning chains where the model calls `inspectLineage`
three or four times.

Text fields also need caps:

```ts
const ASSISTANT_TEXT_CAP = 2000;
function capText(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap - 1) + "…";
}
```

The model should see an ellipsis-truncated excerpt by default and
re-query with a narrower `limit` or different filter when it wants
full text.

### Error results are structured, not thrown

Tools return `{ok: true, output} | {ok: false, kind, message}`.
`kind` is `"invalid_input" | "runtime_error"`. Errors that surface
to the model never throw — that aborts the whole stream. This
mirrors the "errors are values, not exceptions" rule from Manifesto
itself (see core's SPEC §5).

Within rejected results, carry the runtime's own diagnostics:

```ts
outcomes.push({
  kind: "rejected",
  code: report.rejection?.code,
  message: report.rejection?.message ?? report.rejection?.expression,
});
```

so the agent can tell the user *why* — not just "5/5 rejected".

### Context binding

A tool declares the narrow slice of the core it needs:

```ts
export type InspectNeighborsContext = {
  readonly getEdges: () => readonly SchemaGraphEdge[];
  readonly hasNode?: (nodeId: string) => boolean;
};
```

Then `bindTool(createInspectNeighborsTool(), ctx)` at registration.
Benefits:
1. Tests mock only what the tool reads (one line of stub).
2. The import-boundary lint (`no-restricted-imports`) actually
   enforces that `tools/` doesn't pull in React or the UI layer.
3. When you extract the agent into a package later, the seam is
   already clean.

---

## 3. Runtime Integration

### Core-level dispatch notifier

Add this to the core runtime itself, once:

```ts
readonly subscribeAfterDispatch: (
  listener: (result: DispatchResult, intent: Intent) => void,
) => Detach;
```

Every consumer (React provider, UI runtime, agent tool, programmatic
seeder, autosaver, replay recorder) subscribes **once** and stays in
sync regardless of who issued the dispatch. This is the structural
solution to "the agent dispatched but the UI didn't update": you
cannot forget to fire the notifier because the core does it for you.

Before: every call-site had to remember to call a React bump helper,
and the agent / mock-palette paths silently skipped it. After: none
of them needed to.

Swallow listener exceptions per-listener so one bad subscriber
doesn't poison the chain.

### Treating agent state as first-class Manifesto state

If your runtime has a UI-state module (we have `studio.mel`), add the
agent's single-entry memory there:

```mel
state {
  lastUserPrompt: string | null = null
  lastAgentAnswer: string | null = null
  agentTurnCount: number = 0
}
action recordAgentTurn(prompt: string, answer: string) {
  onceIntent {
    patch lastUserPrompt = prompt
    patch lastAgentAnswer = answer
    patch agentTurnCount = agentTurnCount + 1
  }
}
```

Two wins:
1. The single-entry memory is readable via `inspectFocus` with zero
   new tool.
2. Every turn advances studio.mel's lineage — the conversation
   timeline becomes scrubbable with the same machinery that scrubs
   state changes. For free.

Don't store the *full* transcript here. Full history is React-side,
ephemeral. What the runtime cares about is *that the conversation
advanced*, not its full content.

### Short-horizon grounding + long-horizon search

Auto-inject the last ~5 turns at the **end** of the system prompt
(after MEL, so the stable prefix caches). Give the agent a tool for
older turns. See
`apps/webapp/src/agent/session/agent-context.ts::buildAgentSystemPrompt`.

```
# Recent conversation (N most recent turns, newest first)
Older turns are searchable via `inspectConversation(...)`.
```

Cap each excerpt (~280 chars). The full transcript lives in the
React store and is reachable via `inspectConversation({fields:
["assistantText"]})`.

---

## 4. UI Integration

### Transcript-as-view-not-source

Once you're on Vercel AI SDK (or any streaming framework), let the
framework own the messages. Don't duplicate state between a
framework's `useChat({messages})` and a hand-rolled transcript store
— one of them ends up stale.

The UI reads `messages`, walks `parts`, and renders per-part:

- `text` → markdown bubble (use `react-markdown` + `remark-gfm`).
- `tool-<name>` → compact inline row `▸ toolName { args } → ok`,
  colored by channel, collapsible for full JSON.
- `reasoning` → muted italic monospace, collapsed by default.

A partial markdown fragment during streaming (unclosed fence,
solitary `**`) is fine — react-markdown tolerates it and renders
what it can. The next delta completes the token.

### Visual cues that make it read as Manifesto

- Left-side 2px accent bar on assistant messages (violet-hot). Same
  motif as SnapshotTree's focus highlight. Reads as "speech from the
  runtime's side of the edge."
- Channel-colored tool names (action = violet, computed = cyan,
  effect = orange) — same palette as the schema graph view. The
  transcript becomes a runtime op log instead of a chat widget.
- Hairline status strip (`● model · streaming…`) with a `clear`
  link. No chrome.
- Textarea with `Speak with the runtime…` placeholder. Stop button
  is a square; send is an arrow circle in violet-hot.

The goal: the panel reads as "another surface onto the same
runtime," not "a chatbot grafted on."

### Don't add a tutorial step in the UI — the agent IS the tutorial

Once grounding is working, clicking a graph node + asking "what's
this?" is a free onboarding flow. The agent explains from MEL +
snapshot + legality. You don't need a separate "help" system.

---

## 5. Deployment

### Server-proxy architecture (required for production)

Server-side: `/api/agent/chat` forwards to Vercel AI Gateway.

```ts
// apps/webapp/src/server/agent-chat-handler.ts
export async function handleAgentChat(req: Request): Promise<Response> {
  // 1. Rate-limit BEFORE any gateway call.
  // 2. Parse request body (Zod schema).
  // 3. streamText({ model: gateway(MODEL_ID), messages, tools, ... }).
  // 4. return result.toUIMessageStreamResponse();
}
```

Both Vercel serverless (`/api/agent/chat.ts`) and Vite dev
middleware call the exact same handler. One source of truth for the
proxy logic.

### Client-side tool execution

Tools execute on the client because they touch live runtime state.
The AI SDK pattern is:

1. Server sends only tool *schemas* (description + JSON schema).
2. Model emits a tool call → streamed to client.
3. Client's `onToolCall` runs the tool against the bound registry.
4. `addToolResult` attaches the output; `sendAutomaticallyWhen:
   lastAssistantMessageIsCompleteWithToolCalls` auto-resubmits.
5. Server continues the model with the tool result in context.

This keeps the runtime on the client (where it lives) while the
model transport stays on the server (where the API key lives).

### Rate limiting

Upstash `Ratelimit.slidingWindow(N, window)` keyed by the first
`x-forwarded-for` hop. Graceful bypass when env vars absent so dev
doesn't need an Upstash project. Configurable via
`AGENT_RATELIMIT_MAX` / `AGENT_RATELIMIT_WINDOW`.

Return 429 with `Retry-After` and `X-RateLimit-*` headers so the
client can render a meaningful "try again in N minutes" state.

See `apps/webapp/src/server/rate-limit.ts`.

### Environment variables (server-only — no `VITE_` prefix)

```
AI_GATEWAY_API_KEY        # required
AI_GATEWAY_MODEL          # optional; default google/gemma-4-26b-a4b-it
UPSTASH_REDIS_REST_URL    # required in prod, optional in dev
UPSTASH_REDIS_REST_TOKEN  # required in prod, optional in dev
AGENT_RATELIMIT_MAX       # optional; default 20
AGENT_RATELIMIT_WINDOW    # optional; default "2 h"
```

No AI key on the client. Ever.

---

## 6. Multi-Domain Agents

When you have two Manifesto runtimes (in our case: user domain +
studio.mel UI contract), the agent needs two write tools and one
read tool per cross-cutting concern:

- `dispatch` → user-domain writes.
- `studioDispatch` → UI writes.
- `inspectFocus` → reads **studio.mel** state (focus, lens).
- `inspectSnapshot`, `inspectNeighbors`, `inspectAvailability`,
  `inspectLineage` → read **user-domain** state.
- `inspectConversation` → reads React transcript (neither runtime).

Separate tool names beat a `runtime: "user" | "studio"` parameter
— small models route more reliably on descriptive tool names than
on enum arguments.

---

## 7. Testing

### What to unit-test

- **Prompt builder**: the system prompt includes the tool catalog,
  the identity anchor, the MEL source; does NOT include any dynamic
  state (focus, snapshot, availability). Regression guard against
  "someone put snapshot back in the prompt."
- **Each inspect tool**: default projection + `fields` opt-in +
  pagination cursor + filter. Don't share a fixture across tools —
  each has its own shape.
- **Dispatch / seedMock**: rejection `{kind, code, message}` shape
  so the agent can quote the failing guard.
- **End-to-end snapshot consistency**: build a module, dispatch N
  actions, assert `core.getSnapshot()` reflects them. If
  `inspectSnapshot` ever reports stale state, this test breaks
  first.

### What not to unit-test

- Full LLM round-trips. Too flaky and too slow. Put the model
  testing in a separate manual / staged run.
- Prompt wording ("does it say 'the focused node'?"). Test the
  behavior the prompt enables, not the prose.

---

## 8. What To Skip

Based on the Studio Agent α landing, these are false starts to
avoid:

- **"Smart" prompt builders that auto-summarize snapshot.**
  Projection belongs in the tool response, not the prompt.
- **Tool-call streaming of partial JSON.** Buffer to a complete
  call before handing to the orchestrator. A half-JSON argument in
  the middle of a step is a footgun.
- **Per-call-site React version bumps.** Use `subscribeAfterDispatch`.
- **Dual sources of truth for messages.** If you're on AI SDK, its
  `messages` is canonical. Delete your custom transcript store once
  you migrate.
- **`useChat` with a message shape that differs from your
  rendering.** Render from `UIMessage.parts[]` directly.

---

## 9. Minimal Recipe

For a new Manifesto runtime, the minimum to bolt on an agent:

1. **Decide the identity vs. state split.** MEL source → prompt.
   Everything mutable → tools.
2. **Write `inspectFocus` / `inspectSnapshot` / `inspectAvailability`.**
   These three cover 80% of the agent's questions.
3. **Wire `explainLegality` + `dispatch`.** Now it can answer why
   + do.
4. **Add `subscribeAfterDispatch` at the core** if you haven't
   already. Everything else depends on this for freshness.
5. **Auto-inject last-5 turns** at the prompt tail.
6. **Server proxy + rate limit.** Don't ship the AI key in the
   bundle.
7. **Pick a channel palette** so tool rows read as runtime ops.

That's the happy path. Everything else —
`inspectNeighbors` / `inspectLineage` / `inspectConversation` /
`seedMock` / mock-data generator / studio.mel memory — is
additive and compounds nicely on top.

---

## 10. Canonical Files in this Repo

For future reference when wiring a new runtime:

| Concern | File |
|---|---|
| Prompt builder | `apps/webapp/src/agent/session/agent-context.ts` |
| Inspect tools | `apps/webapp/src/agent/tools/inspect-*.ts` |
| Act tools | `apps/webapp/src/agent/tools/dispatch.ts`, `studio-dispatch.ts`, `seed-mock.ts` |
| Diagnose tool | `apps/webapp/src/agent/tools/legality.ts` |
| Tool adapter → AI SDK | `apps/webapp/src/agent/adapters/ai-sdk-tools.ts` |
| Server proxy handler | `apps/webapp/src/server/agent-chat-handler.ts` |
| Rate limit | `apps/webapp/src/server/rate-limit.ts` |
| Vercel serverless entry | `apps/webapp/api/agent/chat.ts` |
| Vite dev middleware | `apps/webapp/vite.config.ts` (agentChatDevPlugin) |
| AgentLens (UI) | `apps/webapp/src/agent/ui/AgentLens.tsx` |
| Markdown body | `apps/webapp/src/agent/ui/MarkdownBody.tsx` |
| studio.mel | `apps/webapp/src/domain/studio.mel` |
| Core notifier | `packages/studio-core/src/create-studio-core.ts` (`subscribeAfterDispatch`) |

Good substrates compound — Manifesto's determinism, legality, and
lineage did most of the work here. The agent layer on top is a
thin projection, not a re-implementation.
