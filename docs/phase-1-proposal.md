# Studio Editor — Phase 1 Proposal (Draft)

> **Status:** Draft (Phase 1 kickoff pending)
> **Date:** 2026-04-17
> **Related:** `proposal.md` (Phase 0 — immutable), `ROADMAP.md` (Phase 0 — complete), `docs/monaco-adapter-sketch.md`, `docs/phase-0-review.md`
> **Primary user:** Manifesto developer (성우님 본인 포함)
> **Design north star (unchanged from Phase 0 §1.2):** Phase 3 compatibility — agents must naturally hook into the Phase 1 surface

---

## 0. TL;DR

Phase 0 delivered a headless, deterministic edit–build–dispatch–snapshot loop with envelope-backed history. Phase 1 puts a **widget on it** without breaking any of Phase 0's contracts.

Three new packages, no core rewrites:

- `@manifesto-ai/studio-adapter-monaco` — Monaco `EditorAdapter` implementation
- `@manifesto-ai/studio-react` — React components wrapping `StudioCore` + adapter
- `@manifesto-ai/studio-demo` — runnable app (Vite + React) using all of the above

Plus a small set of **additive** core seams identified by Phase 0 review (§5 below).

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

1. **A widget.** Monaco is the pragmatic choice (wide adoption, mature LSP path, predictable adapter surface — see `monaco-adapter-sketch.md`).
2. **A rendering layer.** React components that visualise what headless already produces: diagnostics, plan, snapshot, history.
3. **An app shell.** One command (`pnpm --filter studio-demo dev`) opens a browser with the editor and can drive a real MEL domain. This is the artifact 성우님 actually *uses* after Phase 0.

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

### 2.1 Primary (MUST — gates Phase 2 entry)

- **P1-G1.** Monaco adapter that satisfies `EditorAdapter` contract with identical semantics to the headless adapter (INV-SE-3 holds in practice, not just on paper).
- **P1-G2.** React component kit rendering the Phase 0 outputs: source editor, diagnostics panel, plan panel, snapshot tree, edit-history timeline.
- **P1-G3.** Runnable demo app (Vite) loading a `.mel` file and driving the full loop in a browser.
- ~~**P1-G4.** Effect injection seam: `createStudioCore({ effects })` — **landed as pre-flight, see P1-W1.1**.~~
- **P1-G5.** Published `@manifesto-ai/sdk` version that ships the `/provider` promotion of `createBaseRuntimeInstance`; remove `pnpm.overrides link:` (Phase 0 review §5(d)).

### 2.2 Secondary (SHOULD)

- **P1-G6.** Plan diff view — two plan panels side by side, aligned by `LocalTargetKey`.
- **P1-G7.** History timeline with replay-from-here action.
- **P1-G8.** Snapshot path pinning — click a path in the snapshot tree to watch its value across dispatches.

### 2.3 Tertiary (MAY, drop if schedule slips)

- **P1-G9.** CodeMirror adapter (second widget validates `EditorAdapter` is truly widget-neutral).
- **P1-G10.** Remote SQLite export — one-click download of `.studio/edit-history.db`.

---

## 3. Architecture

### 3.1 Package layout (Phase 1)

```
packages/
├── studio-core/                     (unchanged from Phase 0; additive only)
├── studio-adapter-headless/         (unchanged; CLI + tests + fixtures remain)
├── studio-adapter-monaco/   [NEW]   (@manifesto-ai/studio-adapter-monaco)
│   └── src/monaco-adapter.ts        (~150 LoC per sketch)
├── studio-react/            [NEW]   (@manifesto-ai/studio-react)
│   ├── src/StudioProvider.tsx
│   ├── src/useStudio.ts             (hook over StudioCore)
│   ├── src/SourceEditor.tsx         (Monaco-backed)
│   ├── src/DiagnosticsPanel.tsx
│   ├── src/PlanPanel.tsx            (wraps formatPlan + structured view)
│   ├── src/SnapshotTree.tsx
│   ├── src/HistoryTimeline.tsx
│   └── src/index.ts
└── studio-demo/             [NEW]   (not published; app-only)
    ├── src/main.tsx                 (Vite entry)
    ├── src/App.tsx                  (layout glue)
    ├── index.html
    └── vite.config.ts
```

**Phase 0's 2-package constraint is relaxed to 5 packages**, but only because Phase 1 *is* the UI phase. The non-goal "2 packages only" was Phase 0-local (see proposal §3.1).

### 3.2 Dependency graph

```
studio-demo (app)
  ├─→ studio-react
  │     └─→ studio-adapter-monaco
  │           └─→ studio-core ─── sdk, compiler, (lineage)
  └─→ react / vite (app-only)

studio-adapter-headless (Phase 0 artifact, still green, used by core tests + CLI)
  └─→ studio-core
```

studio-core remains the single source of truth. Every new package depends **downstream** of studio-core. INV-SE-1 extends: `studio-core` imports nothing widget-specific; widget libraries only enter via `studio-adapter-monaco` and `studio-react`.

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
</StudioProvider>
```

Hook access: `const { state, snapshot, plan, history, dispatch, build, setSource } = useStudio();`

**Additive core seams (Phase 1):**

```ts
// existing
createStudioCore(options?: StudioCoreOptions)

// new optional fields on StudioCoreOptions
{
  effects?: Record<string, EffectHandler>  // P1-G4; defaults to {} as before
}
```

That is the **only** Phase 1 core API change. Every other capability is read-only composition over Phase 0 surface.

---

## 4. Normative rules (additions)

Existing SE-BUILD / SE-RECON / SE-HIST / SE-ADP rules carry over unchanged. Phase 1 adds a rendering-layer ruleset.

| Rule ID | Level | Description |
|---------|-------|-------------|
| SE-UI-1 | MUST | React components are pure view over `StudioCore` reads + one `useStudio()` hook. No side effects in render. |
| SE-UI-2 | MUST | `SourceEditor` does not auto-build. A `:build` command (CTRL-S or a Build button) calls `core.build()`. |
| SE-UI-3 | MUST | Diagnostics are re-rendered only on `build()` boundary (mirrors headless `setMarkers`). |
| SE-UI-4 | MUST | Snapshot subscription uses `core.getSnapshot()` polling or an SDK-provided subscribe; it does NOT reach into runtime internals. |
| SE-UI-5 | SHOULD | Components accept a fallback renderer / loading state so the demo remains usable while core is still on the first build. |
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
| W1 | SDK publish + override removal (P1-G5) · studio-adapter-monaco skeleton + smoke tests (headless parity suite rerun against Monaco) |
| W2 | studio-react SourceEditor + DiagnosticsPanel + PlanPanel · effects option |
| W3 | SnapshotTree + HistoryTimeline · studio-demo scaffolding · basic layout |
| W4 | Plan diff (P1-G6) · history replay-from-here (P1-G7) · polish |
| W5 (buffer) | CodeMirror sketch or second adapter · review + Phase 2 proposal draft |

4-week core + 1-week buffer mirrors Phase 0's schedule contract.

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Monaco bundle size overwhelms `studio-demo` | Use `monaco-editor/esm` + Vite code-splitting; keep demo small |
| React state bridging drifts from core truth | `useStudio()` is the single subscription surface; no internal mirrors |
| INV-SE-3 turns out false in practice (Monaco breaks a headless assumption) | W1 reruns the full headless test suite against a Monaco adapter fixture; failures block W2 |
| Effect handler registration leaks into the UI contract | Effects are opt-in via `createStudioCore({ effects })`; React never touches them |
| sdk version skew (Phase 0 linked, Phase 1 published) | P1-G5 is a **prerequisite**, not a parallel track |

---

## 8. Success Criteria (Phase 1 — mandatory = P1-SC-1..5)

- [ ] **P1-SC-1** — `pnpm -w build` succeeds for 5 packages (core + headless + monaco + react + demo)
- [ ] **P1-SC-2** — `studio-adapter-monaco` passes the full headless test suite (`smoke`, `sc3`, `sc5`, etc.) with the Monaco adapter swapped in
- [ ] **P1-SC-3** — `pnpm --filter studio-demo dev` opens a browser that loads `todo.mel`, builds, dispatches `addTodo`, and renders the updated snapshot
- [ ] **P1-SC-4** — `createStudioCore({ effects })` end-to-end: an action with an `effect` produces a trace record, and reshaping that action triggers `plan.traceTag.obsolete`
- [ ] **P1-SC-5** — Demo app is usable against `battleship.mel` (SC-8 parity in browser)

Optional: P1-SC-6 (plan diff), P1-SC-7 (CodeMirror sketch), P1-SC-8 (GPT review).

---

## 9. Open questions

| Q | Question | Owner |
|---|----------|-------|
| P1-OQ-1 | React state library? (prefer built-in hooks + Context; Zustand iff perf demands) | 성우님 |
| P1-OQ-2 | Monaco theme — match Studio's identity or default VS dark? | 성우님 |
| P1-OQ-3 | Demo app — Vite or Next.js? (Vite simpler; Next only if SSR lands in Phase 2) | 성우님 |
| P1-OQ-4 | Envelope subscription — does StudioCore expose `onEnvelopeAppended` for timeline auto-refresh, or does the React layer poll `getEditHistory()`? | Phase 1 W2 |

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
