# Monaco Adapter — Paper Sketch

> **Status:** Paper sketch (Phase 0 Week 4, 30-minute timebox)
> **Date:** 2026-04-17
> **Purpose:** Pressure-test the `EditorAdapter` contract against a real widget adapter without writing one. Confirm **INV-SE-3** (Headless tests remain valid on Monaco) and surface any missing seams before Phase 1 picks this up.

## 1. Target surface

Monaco's editor exposes:

- `editor.getValue(): string` / `editor.setValue(source)` — full source buffer (string)
- `editor.onDidChangeModelContent(cb)` — fires on every keystroke
- `editor.deltaDecorations(old, new)` — adds inline decorations (error squiggles, etc.)
- `editor.getPosition()`, `monaco.Range` — text positions for decorations
- `monaco.editor.setModelMarkers(model, owner, markers)` — the canonical path for diagnostics

## 2. Mapping EditorAdapter → Monaco

| `EditorAdapter` method | Monaco equivalent | Notes |
|---|---|---|
| `getSource(): string` | `editor.getValue()` | Pure read; trivial. |
| `setSource(src)` | `editor.setValue(src)` | Used by `:reload` in CLI and potential programmatic flows. Monaco fires `onDidChangeModelContent` — adapter must guard to avoid feedback loops (see §4). |
| `setMarkers(markers)` | `monaco.editor.setModelMarkers(model, "studio-core", toMonacoMarker(marker))` | Marker → Monaco marker mapping is mechanical; only `severity` + `message` + `range` (derived from `SourceSpan`). |
| `onBuildRequest(cb): Unsubscribe` | Keybinding or button handler that calls `cb()` | SE-BUILD-1: explicit trigger only. Good fit — `onDidChangeModelContent` must NOT trigger build. |

`Marker.span: SourceSpan` → Monaco `IRange` needs `startLineNumber`, `startColumn`, `endLineNumber`, `endColumn`. Compiler's `SourceMapIndex` provides line/column; the adapter just translates 0-based to 1-based (Monaco is 1-based on both).

## 3. What already works (no core change needed)

- **Staging area semantics (SE-BUILD-2).** Monaco edits live only in its model; `getSource()` pulls on demand at build time. No change-event subscription inside core required.
- **Explicit build trigger (SE-BUILD-1).** CTRL-S or a toolbar button calls `adapter.requestBuild()` → core's `onBuildRequest` callback → `core.build()`. No timer / no auto-build, consistent with headless.
- **Diagnostic sink (SE-ADP-4).** Monaco accepts Studio's `Marker[]` directly through the mapping above.
- **Widget independence (INV-SE-1).** Core never imports Monaco; adapter is a peer package under `packages/studio-adapter-monaco/` in Phase 1.
- **Edit history + replay.** Monaco's buffer is always the live source; replay is a pure read-over-history operation that does not touch the widget (per Week 3). Replay can fill Monaco by calling `setValue(replayed.module?.schema... )` — though Phase 1 more likely renders replay in a side panel, not the editor.

## 4. Loop-avoidance (the one non-trivial detail)

Problem: if `setSource()` programmatically sets Monaco's value, `onDidChangeModelContent` would fire and the adapter would observe a "change" it caused. Headless does not have this because its `setSource` is direct.

Mitigation (no core change):

```ts
let suppress = 0;
function setSource(src: string) {
  suppress++;
  editor.setValue(src);
  suppress--;
}
editor.onDidChangeModelContent(() => {
  if (suppress > 0) return;
  // adapter-local change handling, if any
});
```

This lives entirely inside the Monaco adapter. Core's contract is unaffected.

## 5. What Phase 1 will want to add (not changes — *extensions*)

- **Live markers updated per-keystroke for a subset of compiler errors.** Phase 0's `setMarkers` fires at build boundary only. Phase 1 may want an LSP/incremental path. This is additive: `EditorAdapter` stays the same; a separate "diagnostic stream" API can be layered in.
- **Source-position hover for `LocalTargetKey`.** The reconciliation plan shows `state_field:todos` — Phase 1 may want to click through to the declaration. Compiler's `SourceMapIndex` is ready; this is adapter-side wiring, not core.
- **Reconciliation decoration.** Gutter icons showing "this line was preserved vs. this line was discarded" across a rebuild. Reuses `ReconciliationPlan.snapshotPlan` + `SourceMapIndex`. Again: reads existing core output.

None of the above require breaking changes to `EditorAdapter` or the core API surface.

## 6. INV-SE-3 verification (thought experiment)

Headless tests exercise:

- `attach(adapter)` / `detach` — trivially satisfied by Monaco adapter.
- `build()` → `BuildResult` — unchanged, adapter-independent.
- `dispatchAsync` / `getSnapshot` / `simulate` — runtime surface, adapter-independent.
- `setMarkers` — renders via `setModelMarkers` instead of in-memory buffer; test assertions that checked "n markers fired" port 1:1.
- `onBuildRequest` — wired to Monaco keybinding or button; headless fires synchronously via `requestBuild()`, Monaco fires via user input or a test's `adapter.requestBuild()` call.

**Conclusion:** the existing headless test fixtures (`smoke`, `trivial-plan`, `build-rules`, `sc3`, `sc5`, etc.) translate to Monaco with zero adapter-facing assertion changes. Anything Monaco-specific (keybinding, decoration rendering) is a new test file, not a rewrite. **INV-SE-3 holds.**

## 7. Gap list (none blocking Phase 0 freeze)

| Gap | Severity | Phase 1 action |
|-----|----------|----------------|
| No helper for 0-based ↔ 1-based span conversion | cosmetic | add `toMonacoRange(span)` in adapter package |
| `Marker.code` optional — Monaco's `IMarkerData.code` is richer (URI + value) | cosmetic | adapter can widen locally |
| No public observable for "plan applied" event | wanted | `core.on("plan-applied", cb)` is a candidate Phase 1 addition (opt-in); does not affect Phase 0 contracts |

## 8. Verdict

**Freeze `EditorAdapter` as-is for Phase 0 exit.** No changes required in studio-core to accept a Monaco adapter in Phase 1. Phase 1's first task is a straight port with ~150 lines of adapter glue plus a pair of new tests that exercise `setModelMarkers` round-tripping.
