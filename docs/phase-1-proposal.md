# Studio Editor — Phase 1 Proposal (Draft)

> **Status:** Draft (Phase 1 kickoff pending)
> **Date:** 2026-04-17
> **Related:** `proposal.md` (Phase 0 — immutable), `ROADMAP.md` (Phase 0 — complete), `docs/monaco-adapter-sketch.md`, `docs/phase-0-review.md`
> **Primary user:** Manifesto developer (성우님 본인 포함)
> **Design north star (unchanged from Phase 0 §1.2):** Phase 3 compatibility — agents must naturally hook into the Phase 1 surface

---

## 0. TL;DR

Phase 0 delivered a headless, deterministic edit–build–dispatch–snapshot loop with envelope-backed history. Phase 1 puts **three widgets on it** — a code editor, a domain-shape visualiser, and an interaction console — without breaking any of Phase 0's contracts.

Three new packages, no core rewrites:

- `@manifesto-ai/studio-adapter-monaco` — Monaco `EditorAdapter` implementation
- `@manifesto-ai/studio-react` — React component kit: editor panels + **D3-backed `SchemaGraph` view** + **interaction editor** (action form + dispatch + simulate preview) + history timeline
- `apps/webapp` — **the production app** (Vite + React) wiring all three surfaces. Deploys to **`studio.manifesto-ai.dev`**. Not published to npm; lives outside `packages/*` as a first-class application, not a demo.

**Why graph + interaction are primary, not optional:** proposal §1.3 frames Studio's identity as "semantic-structure diff-centric" and "runtime-embedded REPL". Shipping the first public cut without a visual `SchemaGraph` + an interaction editor would undercut both claims. Phase 0's `core.getModule().graph` + `getLastReconciliationPlan()` + `createIntent/dispatchAsync/simulate` surfaces already expose everything these views need — no core change, only rendering.

---

## 1. Context

### 1.1 Where Phase 0 landed

59 tests, 13 files green. Mandatory SC-1~SC-7 plus optional SC-8/SC-9/SC-10 all GO. The core API surface is:

```ts
createStudioCore(options?) → StudioCore {
  attach, build, getSnapshot, createIntent, dispatchAsync, simulate,
  getTraceHistory, getLastReconciliationPlan, getModule, getDiagnostics,
  getEditHistory
}
```

Plus reconciliation types, envelope types, store implementations (InMemory + SQLite), replay, and `formatPlan` pretty printer.

### 1.2 What Phase 1 adds

1. **A text widget (Monaco).** Wide adoption, mature LSP path, predictable adapter surface — see `monaco-adapter-sketch.md`.
2. **A graph widget (D3 `SchemaGraph` view).** Renders `state` / `computed` / `action` nodes + `feeds` / `mutates` / `unlocks` edges. Overlays the latest `ReconciliationPlan.identityMap` so preserved / initialized / discarded decls are visually distinguishable at rebuild time. This is the "semantic-structure diff" claim from proposal §1.3 made concrete.
3. **An interaction editor.** Read `schema.actions[name]` → generate a typed input form → `createIntent` + `simulate` (preview) / `dispatchAsync` (commit). Directly extends the CLI REPL's `:dispatch` into a widget. This is the "runtime-embedded REPL" claim made concrete.
4. **A rendering layer for the rest.** Diagnostics panel, plan panel, snapshot tree, history timeline — React components over the same Phase 0 surface.
5. **A production webapp.** `apps/webapp` (published as private `@manifesto-ai/studio-webapp`) — deployed to **`studio.manifesto-ai.dev`** as the official operating surface. Local dev via `pnpm --filter @manifesto-ai/studio-webapp dev` loads `todo.mel` / `battleship.mel` with all three widgets wired in. Not a throwaway demo — this is what external users and agents will touch first.

### 1.3 What Phase 1 explicitly does NOT add

Same non-goals apply (proposal §2.3):

- No LSP server (LSP is a separate vertical)
- No agent integration (Phase 3)
- No governance / review gates (Phase 3)
- No remote collaboration / multiplayer

And specifically for Phase 1:

- No Phase 2 reconciliation refinements (type-compat widening, rename heuristics)
- No incremental / per-keystroke compile (build-boundary diagnostics only)
- No VS Code extension (browser app first)

---

## 2. Goals

### 2.1 Primary (MUST — first public release gate)

- **P1-G1.** Monaco adapter that satisfies `EditorAdapter` contract with identical semantics to the headless adapter (INV-SE-3 holds in practice, not just on paper).
- **P1-G2.** Base React panels over Phase 0 outputs: source editor host, diagnostics panel, plan panel, snapshot tree, history timeline.
- **P1-G3.** **D3 `SchemaGraph` view** — reads `core.getModule().graph`, force-directed layout, node kind styling (state / computed / action), edge relation styling (feeds / mutates / unlocks). Overlays latest `getLastReconciliationPlan().identityMap` so preserved / initialized / discarded states are obvious after a rebuild. Click-through to source position via `SourceMapIndex`.
- **P1-G4.** **Interaction editor** — dynamic form generated from `schema.actions[name].input` / `inputType`; `Simulate` button runs `core.simulate(intent)` and shows would-be snapshot diff; `Dispatch` button runs `core.dispatchAsync(intent)` and updates the timeline. Inline display of `whyNot(intent)` blockers when action is unavailable.
- **P1-G5.** `apps/webapp` — production webapp (Vite) driving the full loop (edit → build → graph view update → simulate → dispatch → history) in a browser, deployable to **`studio.manifesto-ai.dev`**. `todo.mel` and `battleship.mel` ship as built-in examples.
- **P1-G6.** Published `@manifesto-ai/sdk` version that ships the `/provider` promotion of `createBaseRuntimeInstance`; remove `pnpm.overrides link:` (Phase 0 review §5(d)).

### 2.2 Secondary (SHOULD — slip only if schedule pressured)

- **P1-G7.** Plan diff view — two plan panels side by side, aligned by `LocalTargetKey`, with the graph highlighting the intersection.
- **P1-G8.** History replay-from-here — pick an envelope in the timeline, inspect the snapshot the replay up to that point would produce.
- **P1-G9.** Snapshot path pinning — click a path in the snapshot tree to watch its value across dispatches.
- **P1-G10.** Effect handler registration UI — register / swap `StudioCoreOptions.effects` handlers at runtime from the webapp (Phase 0's landed `effects` seam).

### 2.3 Tertiary (MAY, drop without regret)

- **P1-G11.** CodeMirror adapter (second widget validates `EditorAdapter` is truly widget-neutral).
- **P1-G12.** Remote SQLite export — one-click download of `.studio/edit-history.db`.

---

## 3. Architecture

### 3.1 Package layout (Phase 1)

```
packages/
├── studio-core/                     (unchanged from Phase 0; additive only)
├── studio-adapter-headless/         (unchanged; CLI + tests + fixtures remain)
├── studio-adapter-monaco/   [NEW]   @manifesto-ai/studio-adapter-monaco
│   └── src/monaco-adapter.ts        (~150 LoC per sketch)
└── studio-react/            [NEW]   @manifesto-ai/studio-react
    ├── src/StudioProvider.tsx
    ├── src/useStudio.ts             (hook over StudioCore)
    ├── src/SourceEditor.tsx         (Monaco-backed)
    ├── src/DiagnosticsPanel.tsx
    ├── src/PlanPanel.tsx            (wraps formatPlan + structured view)
    ├── src/SnapshotTree.tsx
    ├── src/HistoryTimeline.tsx
    ├── src/SchemaGraphView/       [D3, P1-G3]
    │   ├── SchemaGraphView.tsx      (React wrapper)
    │   ├── layout.ts                (d3-force simulation + cached positions)
    │   ├── render.ts                (svg: nodes, edges, labels, plan overlay)
    │   └── hit-testing.ts           (node click → source span via SourceMapIndex)
    ├── src/InteractionEditor/     [P1-G4]
    │   ├── InteractionEditor.tsx    (action picker + form + sim/dispatch buttons)
    │   ├── action-form.tsx          (FieldSpec/TypeDefinition → typed inputs)
    │   ├── simulate-preview.tsx     (snapshot diff after core.simulate)
    │   └── blocker-list.tsx         (whyNot display when action unavailable)
    └── src/index.ts

apps/                           [NEW top-level directory, added to pnpm-workspace.yaml]
└── webapp/                     [NEW]   @manifesto-ai/studio-webapp (private)
    ├── src/main.tsx                 (Vite entry)
    ├── src/App.tsx                  (layout glue: editor | graph | interaction)
    ├── src/routes/                  (landing, /editor, /examples/:fixture)
    ├── src/fixtures/                (todo.mel, battleship.mel bundled)
    ├── public/                      (favicons, og images for studio.manifesto-ai.dev)
    ├── index.html
    └── vite.config.ts
```

**Workspace layout change:** Phase 1 introduces an `apps/` directory alongside `packages/`. `pnpm-workspace.yaml` gains `"apps/*"`. Packages published to npm live under `packages/`; applications with their own deployment lifecycles live under `apps/`. The webapp is **private: true** — it is not a publishable library but a deployable site. Phase 0's "2 packages" constraint was scoped to Phase 0; Phase 1 ships 4 packages + 1 app.

### 3.2 Dependency graph

```
apps/webapp (production — studio.manifesto-ai.dev)
  ├─→ @manifesto-ai/studio-react
  │     ├─→ @manifesto-ai/studio-adapter-monaco
  │     │     └─→ @manifesto-ai/studio-core ─── sdk, compiler, (lineage)
  │     └─→ react · d3-force · d3-selection · d3-shape   (declared in studio-react)
  └─→ react · vite   (declared in apps/webapp)

@manifesto-ai/studio-adapter-headless (Phase 0 artifact; CLI + tests)
  └─→ @manifesto-ai/studio-core
```

studio-core remains the single source of truth. Every new package depends **downstream** of studio-core. INV-SE-1 is now scoped explicitly to `studio-core` (see `scripts/check-no-widget-deps.mjs`'s `STUDIO_CORE_PACKAGES` allowlist); adapter / React / D3 packages are expected to bring their widget of choice.

### 3.3 Public entry points

**`@manifesto-ai/studio-adapter-monaco`:**

```ts
export function createMonacoAdapter(options: {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  readonly markerOwner?: string;            // default: "studio-core"
}): EditorAdapter;
```

No new methods on `EditorAdapter`. Shape proven by `monaco-adapter-sketch.md` §2.

**`@manifesto-ai/studio-react`:**

```tsx
<StudioProvider core={core} adapter={adapter}>
  <SourceEditor />
  <DiagnosticsPanel />
  <PlanPanel />
  <SnapshotTree />
  <HistoryTimeline />
  <SchemaGraphView onNodeClick={(key) => editor.revealPosition(...)} />
  <InteractionEditor />
</StudioProvider>
```

Hook access:
```ts
const {
  module, snapshot, plan, history, diagnostics,
  build, simulate, dispatch, createIntent, setSource,
} = useStudio();
```

D3 is loaded as a sibling primitive — `studio-react` imports `d3-force` / `d3-selection` / `d3-shape` directly; no wrapper library. This keeps D3 usage explicit and tree-shakable.

**Core API status:** `StudioCoreOptions.effects?` landed in Phase 0 pre-flight. **No further core API additions required for Phase 1 primary goals.** All three widgets compose over read-only reads + the existing write verbs (`build` / `dispatchAsync` / `simulate`).

---

## 4. Normative rules (additions)

Existing SE-BUILD / SE-RECON / SE-HIST / SE-ADP rules carry over unchanged. Phase 1 adds a rendering-layer ruleset.

| Rule ID | Level | Description |
|---------|-------|-------------|
| SE-UI-1 | MUST | React components are pure view over `StudioCore` reads + one `useStudio()` hook. No side effects in render. |
| SE-UI-2 | MUST | `SourceEditor` does not auto-build. A `:build` command (CTRL-S or a Build button) calls `core.build()`. |
| SE-UI-3 | MUST | Diagnostics are re-rendered only on `build()` boundary (mirrors headless `setMarkers`). |
| SE-UI-4 | MUST | Snapshot subscription uses `core.getSnapshot()` polling or an SDK-provided subscribe; it does NOT reach into runtime internals. |
| SE-UI-5 | SHOULD | Components accept a fallback renderer / loading state so `apps/webapp` remains usable while core is still on the first build. |
| SE-UI-6 | MUST NOT | React components import from `@manifesto-ai/sdk` directly. Everything goes through `StudioCore`. |

`SE-UI-6` enforces INV-SE-1 at the React layer — widgets cannot bypass the core surface.

---

## 5. What Phase 0 missed (and Phase 1 picks up)

From `docs/phase-0-review.md` §5:

| Finding | Phase 1 action | Status |
|---------|----------------|--------|
| (a) SC-4 e2e requires effect handlers | `createStudioCore({ effects })` option | ✅ landed (P1-W1.1) |
| (b) SDK seam over-exposed | Narrowed to `/provider`; `createBaseRuntimeInstance` promoted upstream by GPT | ✅ landed (Studio-side) |
| (d) `link:` dev-only override | Remove once updated sdk publishes | pending upstream publish |
| (f) Store `list()` ordering divergence | Pinned to `(timestamp ASC, id ASC)`; tiebreaker test added | ✅ landed (P1-W1.2) |
| SC-4 layer (2) — host trace emission | Upstream host `TraceGraph` push; no Studio change needed | pending upstream (`host.ts:301`) |
| (c) Runtime double-activation | Opt-in optimisation; not blocking | deferred |
| (h) Shallow JSON signature | Phase 2, not Phase 1 | deferred |
| (i,j) Envelope chain + ms precision | Phase 1 Monaco concurrent editors may hit (j); add `buildSeq` tiebreaker if needed | deferred |

**Core API change list (complete):** `effects?` on `StudioCoreOptions`. That's it. Phase 0's conservative design paid off — the UI fits onto the existing surface.

---

## 6. Schedule (proposed — not locked)

| Week | Scope |
|------|-------|
| W1 | studio-adapter-monaco skeleton + smoke tests (headless parity suite rerun against Monaco) · studio-react `StudioProvider` + `useStudio` hook · `apps/webapp` Vite scaffolding + workspace wiring |
| W2 | `SourceEditor` + `DiagnosticsPanel` + `PlanPanel` + `SnapshotTree` + `HistoryTimeline` (base panels over Phase 0 surface) |
| W3 | **`SchemaGraphView` (D3)** — force layout, node/edge styling, plan overlay, click-to-source · `apps/webapp` 3-pane layout (editor / graph / interaction) |
| W4 | **`InteractionEditor`** — action form from `FieldSpec`/`TypeDefinition`, simulate preview, dispatch, blocker list · polish · `battleship.mel` in browser |
| W5 (buffer) | Deploy pipeline for `studio.manifesto-ai.dev` (Vercel / Cloudflare Pages / self-host — P1-OQ-7) · SDK publish + `pnpm.overrides` removal · plan diff · CodeMirror sketch or second adapter · Phase 2 proposal draft |

4-week core + 1-week buffer mirrors Phase 0's schedule contract.

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Monaco bundle size overwhelms `apps/webapp` | Use `monaco-editor/esm` + Vite code-splitting; route-level chunk for the editor surface |
| React state bridging drifts from core truth | `useStudio()` is the single subscription surface; no internal mirrors |
| INV-SE-3 turns out false in practice (Monaco breaks a headless assumption) | W1 reruns the full headless test suite against a Monaco adapter fixture; failures block W2 |
| D3 force-layout thrashes on every build (expensive for large domains) | Cache `(schemaHash → positions)`; only re-simulate for new / moved nodes. battleship is the stress target (~60 nodes). |
| Action input forms over-generalise and grow unmaintainable | Form generator covers the `FieldSpec` kinds actually present in `temp/*.mel`; unsupported kinds fall back to a raw-JSON textarea with JSON-parse validation |
| Effect handler registration leaks into the UI contract | Effects are opt-in via `createStudioCore({ effects })`; React never touches them |
| sdk version skew (Phase 0 linked, Phase 1 published) | SDK publish + link removal moved to W5; the webapp uses workspace link throughout W1–W4. Production deploy requires the published sdk version. |
| Public domain means public surface | `studio.manifesto-ai.dev` is a real URL users will land on; add a "Phase 1 — early access" banner and link to proposal docs until the polished release |

---

## 8. Success Criteria (Phase 1 — first public release = P1-SC-1..7)

- [ ] **P1-SC-1** — `pnpm -w build` succeeds for 4 packages + 1 app (studio-core, studio-adapter-headless, studio-adapter-monaco, studio-react, apps/webapp)
- [ ] **P1-SC-2** — `studio-adapter-monaco` passes the full headless test suite (`smoke`, `sc3`, `sc5`, etc.) with the Monaco adapter swapped in
- [ ] **P1-SC-3** — `pnpm --filter @manifesto-ai/studio-webapp dev` opens a browser that loads `todo.mel`, edits source in Monaco, builds, dispatches `addTodo`, and renders the updated snapshot
- [ ] **P1-SC-4** — **`SchemaGraphView`** renders `todo.mel` nodes + edges; after rebuild with a computed-body change, preserved / initialized / discarded overlay is visible on the graph
- [ ] **P1-SC-5** — **`InteractionEditor`** lists `schema.actions`, generates a form for `addTodo(title: string)`, preview via `simulate` shows the would-be snapshot, dispatch commits the change
- [ ] **P1-SC-6** — `apps/webapp` is usable against `battleship.mel` in browser (SC-8 parity, including graph with ~60 nodes)
- [ ] **P1-SC-7** — Blocker UX: attempting to dispatch an action whose `available when` is false shows the blocker list from `core.whyNot(intent)` (e.g. `battleship`'s `shoot` while phase !== "playing")
- [ ] **P1-SC-8** — `apps/webapp` deployable build (`pnpm --filter @manifesto-ai/studio-webapp build`) produces a static bundle suitable for `studio.manifesto-ai.dev`

Optional: P1-SC-9 (plan diff), P1-SC-10 (replay-from-here timeline), P1-SC-11 (CodeMirror sketch), P1-SC-12 (live deploy on studio.manifesto-ai.dev), P1-SC-13 (GPT review).

---

## 9. Open questions

| Q | Question | Owner |
|---|----------|-------|
| P1-OQ-1 | React state library? (prefer built-in hooks + Context; Zustand iff perf demands) | 성우님 |
| P1-OQ-2 | Monaco theme — match Studio's identity or default VS dark? | 성우님 |
| P1-OQ-3 | Demo app — Vite or Next.js? (Vite simpler; Next only if SSR lands in Phase 2) | 성우님 |
| P1-OQ-4 | `SchemaGraphView` layout — d3-force, ELK (hierarchical), or Dagre (layered DAG)? Force is the default here but battleship's dense edge set may call for a layered layout. W3 spike to decide. | Phase 1 W3 |
| P1-OQ-5 | Envelope subscription — does StudioCore expose `onEnvelopeAppended` for timeline auto-refresh, or does the React layer poll `getEditHistory()`? | Phase 1 W2 |
| P1-OQ-6 | `InteractionEditor` unsupported `FieldSpec` kinds — fall back to raw JSON textarea or refuse? | Phase 1 W4 |
| P1-OQ-7 | `studio.manifesto-ai.dev` deploy target — Vercel, Cloudflare Pages, or self-host? Static SPA build for all three; pick based on analytics/edge-fn needs | 성우님 · Phase 1 W5 |
| P1-OQ-8 | Fixtures in production build — ship `todo.mel` / `battleship.mel` as bundled examples, allow user-uploaded files, or both? | 성우님 · Phase 1 W2 |

---

## 10. Phase 2 preview (informational)

Phase 2 is the "semantic refinement" phase — not yet proposed, but the anticipated shape:

- Type compatibility widening (SE-RECON-4 full implementation)
- `TypeCompatWarning` population
- Sub-declaration reconciliation (body-level reuse)
- Structured agent EditIntent kinds (`add_action`, `change_guard`)
- Rename wiring end-to-end (`rename_decl` intent emission + replay support)

Phase 3 remains the agent phase per proposal §1.2.

---

## 11. Decision record for Phase 1 kickoff

- [ ] Review this proposal with 성우님 (target: same-day kickoff approval)
- [ ] External review (GPT or peer) once draft stabilises
- [ ] Freeze P1-G1..G5 (mandatory scope) before W1 merge
- [ ] File pre-flight items from §5 into tracker

---

*End of Phase 1 proposal draft.*
