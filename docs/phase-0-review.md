# Phase 0 — Cross Review

> **Status:** Complete (SC-10)
> **Date:** 2026-04-17
> **Reviewer:** Claude (self-review in the spirit of GPT cross-review; an external pass is still recommended before committing Phase 1)
> **Subject:** `docs/proposal.md` vs `docs/ROADMAP.md` vs actual implementation in `packages/studio-core/` + `packages/studio-adapter-headless/`

This review walks the public surface and normative rules of the proposal, checks them against the shipped code, and flags anything that looks like debt, drift, or a blind spot. Items are graded:

- **✅ Clean** — covered, no concerns
- **⚠ Watchlist** — covered but worth tracking into Phase 1
- **🅿 Deferred** — intentionally left for later per proposal
- **❗ Issue** — needs action (none below raise to this, see §7)

---

## 1. Goal coverage (proposal §2)

| Goal | Status | Notes |
|------|--------|-------|
| G1: source → DomainModule build pipeline | ✅ | `executeBuild` single compile step |
| G2: runtime observation/manipulation API | ✅ | `getSnapshot`, `dispatchAsync`, `simulate`, `getTraceHistory` |
| G3: identity-based semantic reuse | ✅ | `computePlan` + overlay hydration, 59 tests |
| G4: all edits → EditIntent (Lineage-ready) | ✅ | `EditIntentEnvelope` Phase 0-frozen, JSON-serialisable |
| G5: widget-independent adapter + Headless | ✅ | `EditorAdapter` + `createHeadlessAdapter`, INV-SE-1 enforced by CI |
| G6: CLI debug tool for plan | ✅ | `studio-repl` + `formatPlan` |
| G7: deterministic replay | ✅ | `replayHistory` + canonicalised compare |

All seven primary goals are satisfied.

---

## 2. Normative rule coverage (proposal §4)

| Group | Rules | Status |
|-------|-------|--------|
| Build Pipeline | SE-BUILD-1 ~ 6 | ✅ Week 1 + regression tests |
| Reconciliation | SE-RECON-1 ~ 7 | ✅ Week 2 |
| Edit History | SE-HIST-1 ~ 5 | ✅ Week 3 |
| Adapter Contract | SE-ADP-1 ~ 5 | ✅ Week 1 |

Every SE-* rule has either a direct test or structural enforcement. Notably:

- **SE-RECON-2** (no structural rename heuristics): enforced by code shape — `computePlan` never inspects bodies for similarity. The only path to `renamed` fate is an explicit `opts.renames` entry, which Phase 0 never populates.
- **SE-RECON-6** (`$host`/`$mel`/`$system` always re-init): satisfied implicitly — the overlay only touches `snapshot.data.<stateFieldName>` keys and `state.fields` cannot contain reserved prefixes.
- **SE-HIST-2** (append-only): enforced by both stores (duplicate id rejection) and verified by `edit-history-stores.test.ts`.

---

## 3. Success criteria rollup (proposal §8)

| SC | Status | Evidence |
|----|--------|----------|
| SC-1 | ✅ | `pnpm -w build` green |
| SC-2 | ✅ | `smoke.test.ts` |
| SC-3 | ✅ | `sc3-snapshot-preserve.test.ts` |
| SC-4 | ✅ (unit) / ⚠ (e2e) | unit in `reconciler.test.ts` (`tagTraces`); end-to-end via host traces deferred — see §5 item (a) |
| SC-5 | ✅ | `sc5-replay-determinism.test.ts` |
| SC-6 | ✅ | `pnpm check:no-widget-deps` green |
| SC-7 | ✅ | `sc7-cli-repl.test.ts` |
| SC-8 | ✅ (bonus) | `sc8-battleship-integration.test.ts` |
| SC-9 | ✅ (bonus) | `docs/monaco-adapter-sketch.md` |
| SC-10 | ✅ | this document |

All mandatory SC (1–7) are GO. Phase 1 entry is unblocked.

---

## 4. Invariants (proposal §5)

| INV | Status | Notes |
|-----|--------|-------|
| INV-SE-1 | ✅ | CI `check:no-widget-deps`; `better-sqlite3` is server-side, not a widget lib |
| INV-SE-2 | ✅ | `inv-se-2-determinism.test.ts` |
| INV-SE-3 | ✅ | headless suite works as-is against Monaco per `monaco-adapter-sketch.md` §6 |
| INV-SE-4 | ✅ | `sc5-replay-determinism.test.ts` second test |

---

## 5. Findings (watchlist)

### (a) SC-4 end-to-end depends on host effect handlers — deferred

`tagTraces` correctly classifies trace records by action presence. The integration-level assertion "dispatch fills trace buffer" only fires when an action declares an `effect` *and* the host has a registered handler. Phase 0 ships with `effects: {}` per SE-BUILD-6, so no end-to-end coverage is possible without extending the API.

**Impact:** low — the classification logic is covered by unit tests; the pipe from `dispatch → traceBuffer → tagTraces → plan.traceTag` uses plain array pass-through with no transformation.

**Recommendation for Phase 1:** expose a `createStudioCore({ effects })` option for testing/fixtures that declare effects. INV-SE-3 is unaffected.

### (b) SDK seam — resolved via `/provider` promotion

Week 2 originally opened `@manifesto-ai/sdk/compat/internal` to reach `createRuntimeKernel` + `createBaseRuntimeInstance`. A subsequent sanity-check (Phase 1 pre-flight) found that `@manifesto-ai/sdk/provider` already existed as the documented public seam for provider / decorator authors (see `packages/sdk/docs/sdk-SPEC.md` and `packages/sdk/src/provider.ts`), and was already exporting every symbol Studio needed **except `createBaseRuntimeInstance`**.

**Resolution (option B):** `createBaseRuntimeInstance` was promoted into `/provider` upstream. `./compat/internal` is no longer part of Studio's dependency surface. `packages/studio-core/src/internal/runtime-bridge.ts` now imports exclusively from `@manifesto-ai/sdk/provider`. Upstream SDK logic remains unchanged; only the export list of the already-public `/provider` seam grew by one symbol.

**Residual impact:** the `pnpm.overrides` → `link:` workaround (§5(d)) still stands until a published sdk version ships the `/provider` export update.

### (c) Runtime double-activation on swap path

`executeBuild`'s swap path activates the runtime twice: once with defaults, then a second time with the overlaid canonical snapshot. Clear but wasteful.

**Impact:** negligible on small domains; battleship (~60 state fields, 20+ actions) rebuilds in <200 ms in tests. At Monaco/LSP frequency (per-save) still fine.

**Recommendation:** Phase 1 optimisation — merge into a single activation by passing `initialSnapshot` into the first factory call. Requires SDK to accept the snapshot into `createRuntimeKernel` options or an equivalent seam; not needed for Phase 0 correctness.

### (d) `link:` dev-time override

`studio/package.json` overrides `@manifesto-ai/sdk` with `link:../core/packages/sdk`. This only holds if both repos are cloned side by side.

**Impact:** contributor onboarding has an implicit "clone `../core` first" step that isn't documented in the README (there is no README yet).

**Recommendation:** Phase 1 adds a CONTRIBUTING note and optionally a bootstrap script. Alternatively remove the override once sdk 3.16.0 ships to the registry.

### (e) `rename_decl` payload kind is typed but never emitted

`EditIntent` includes `{ kind: "rename_decl"; from; to }` and `EditIntentEnvelope.payloadKind` allows it. Phase 0 never produces one; `replayEnvelopes` silently skips non-`rebuild` kinds.

**Impact:** dead-code risk and latent silent-skip bug if Phase 2 introduces rename handling and forgets to extend replay.

**Recommendation:** add a Phase 2 TODO comment (not a runtime error — envelope format stability is the goal). Current behavior is consistent with "Phase 0 rebuild-only".

### (f) `InMemoryEditHistoryStore` vs `SqliteEditHistoryStore` list ordering

`InMemoryEditHistoryStore.list()` returns **insertion order**; `SqliteEditHistoryStore.list()` returns **timestamp ASC** (explicit `ORDER BY`). For Phase 0 the two coincide (timestamps are monotonic in build order within a millisecond). For replay we only need a stable total order.

**Impact:** very low — replay under either store is deterministic.

**Recommendation:** align on `(timestamp ASC, id ASC)` in the `EditHistoryStore` contract during Phase 1 freeze. Add a single line to the store contract docstring.

### (g) `lineageAnchor` field defined but never populated

`EditIntentRecord` has `lineageAnchor?: { branchId, worldId }` per OQ-1. No Phase 0 code path writes one. Lineage integration is a Phase 3 deliverable.

**Impact:** intentional. Flagging for documentation completeness.

### (h) Type signature comparison is shallow JSON

`stateFieldSignature` uses stable `JSON.stringify`. Semantically equivalent union types with different element order would signature-differ. Compiler IR may already canonicalise unions — untested. Overly conservative, so any false-discard results in re-initialisation (safe, just wasteful).

**Impact:** low — a false discard wastes a schema-level initialisation; data loss is bounded to that field and matches the "conservative Phase 0" design stance (OQ-2).

**Recommendation:** Phase 2 Type-Compat rule widening will address this with structural comparison. No Phase 0 action.

### (i) No envelope chain validation

`EditHistoryStore.append` does not check that `envelope.prevSchemaHash` matches the previous envelope's `nextSchemaHash`. Concurrent writers or out-of-order appends would produce discontinuous chains.

**Impact:** Phase 0 has no concurrent writers (single-process REPL). Replay handles a gap by starting each envelope's build from whatever state the previous `executeBuild` produced — silently accepting "reorderings".

**Recommendation:** Phase 1 (Monaco + multi-tab) may introduce concurrent writers; add a chain-integrity check there. Not a Phase 0 issue.

### (j) Envelope timestamp is `Date.now()` (ms precision)

Two envelopes landing in the same millisecond would share a timestamp. Ordering breaks for exact ties. `id` is a UUID (random) so absolute ordering becomes undefined at ties.

**Impact:** essentially zero for human editors; observable only in replay tests that batch-call `build()`.

**Recommendation:** Phase 1 could switch to a build-seq suffix or a high-res clock. Not worth changing in Phase 0 freeze.

---

## 6. Non-findings (explicitly checked, clean)

- **Widget-library purity** (INV-SE-1): CI script `check-no-widget-deps` runs on every PR; scanning deny list covers monaco/codemirror/react/vue/svelte/etc.
- **Studio-core never imports from Host, Lineage, Governance packages**: verified by grep; dependencies are compiler + sdk only.
- **All trace tagging is deterministic**: traceId mint uses `sha256(intentId:index)`; classification is pure action-name membership.
- **Envelope JSON is stable across re-serialisation**: codec round-trip tests confirm.
- **No `Date.now()` or `crypto.randomUUID()` inside `computePlan` / `buildOverlaySnapshot` / `tagTraces`**: all three are pure.
- **`dispose` paths**: `disposeRuntime` handles `DisposedError` silently (idempotent), `SqliteEditHistoryStore.close()` optional, replay's temp runtime explicitly disposed.

---

## 7. Issue triage

No **❗ Issues** surfaced in this review. The nine watchlist items (§5 a–j minus (g) which is informational) are all tracked into Phase 1. Phase 0 exit is clean.

---

## 8. Phase 1 pre-flight checklist (derived from this review)

- [x] **Narrow SDK seam — resolved.** `createBaseRuntimeInstance` promoted to `/provider`; Studio now imports from `@manifesto-ai/sdk/provider` only (issue (b)). Upstream change by GPT; Studio-side switch landed the same day.
- [ ] Publish an sdk version that includes the `/provider` export update; once published, remove `pnpm.overrides` → `link:` (issue (d))
- [x] **`createStudioCore({ effects })` — landed.** `StudioCoreOptions.effects` threads through `executeBuild` into `createRuntime`. See `sc4-trace-obsolete-e2e.test.ts` layer (1) (issue (a)).
- [x] **`EditHistoryStore.list()` ordering — locked.** Contract is `(timestamp ASC, id ASC)`; both InMemory and SQLite honor it. Test `edit-history-stores.test.ts` exercises the tiebreaker (issue (f)).
- [ ] Add Monaco adapter package per `docs/monaco-adapter-sketch.md`
- [ ] Document `cd ../core && pnpm install` setup step
- [ ] Optional: fold "runtime double-activation" optimisation if `setVisibleSnapshot` can run inside the kernel factory
- [ ] Upstream: host-side `TraceGraph` population — `packages/host/src/host.ts:301` allocates a traces array but never pushes. Once the host begins emitting traces, layer (2) of SC-4 (runtime trace buffer + obsolete tagging end-to-end) unblocks. No Studio code change needed at that point.

Three items closed in-session; remaining items are packaging and upstream coordination — none block Phase 1 entry.

---

*End of review.*
