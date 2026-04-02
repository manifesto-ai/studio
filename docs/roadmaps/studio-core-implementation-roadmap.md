# `@manifesto-ai/studio-core` Implementation Roadmap

**Status:** In Progress (MVP Implemented, Hardening Complete, Advanced Inputs/Policy Complete)
**Source Spec:** `docs/specs/studio-core-spec.md`
**Target Package:** `packages/studio-core`
**Goal:** turn the current placeholder package into a spec-compliant read-only analysis engine for Manifesto domains

---

## Implementation Principles

- [x] Keep the package read-only: no runtime mutation APIs, no MEL parsing, no renderer-specific logic.
- [x] Preserve the module dependency DAG: `contracts -> ingest -> graph -> analysis -> explanation -> projection -> session`.
- [x] Make `DomainSchema` the canonical base input and treat all other artifacts as overlays.
- [x] Route all Core oracle calls through `session/` only.
- [x] Keep all outputs JSON-serializable and surface-neutral.
- [x] Enforce ontology protection so projections do not imply hidden execution semantics.

---

## Phase 0. Package Skeleton And Guardrails

- [x] Replace the current single-file placeholder export with the spec-aligned source tree under `src/`.
- [x] Create module directories:
  - [x] `contracts/`
  - [x] `ingest/`
  - [x] `graph/`
  - [x] `analysis/static/`
  - [x] `analysis/runtime/`
  - [x] `analysis/trace/`
  - [x] `analysis/lineage/`
  - [x] `analysis/governance/`
  - [x] `explanation/`
  - [x] `projection/`
  - [x] `projection/experimental/`
  - [x] `session/`
- [x] Add barrel exports from `src/index.ts` for public contracts and session entrypoints only.
- [x] Add boundary checks so lower layers cannot import higher layers.
- [x] Add a small fixture set for schema-only, schema+snapshot, schema+trace, schema+lineage, schema+governance scenarios.
- [x] Define versioning and compatibility policy for future surface packages.

**Exit criteria**

- [x] The file structure matches the recommended layout in spec §13.
- [x] Public exports expose contracts and session API without leaking internal module implementations.

---

## Phase 1. Contracts First

- [x] Implement `contracts/inputs.ts`
  - [x] `AnalysisBundle`
  - [x] `LineageExport`
  - [x] `GovernanceExport`
  - [x] overlay-related helper types
- [x] Implement `contracts/graph-ir.ts`
  - [x] static, lineage, governance node kinds
  - [x] static, lineage, governance edge kinds
  - [x] `FactProvenance`
  - [x] `OverlayFact`
  - [x] `GraphNode`
  - [x] `GraphEdge`
  - [x] `OverlayVersionMap`
  - [x] `SemanticGraphIR`
- [x] Implement `contracts/findings.ts`
  - [x] `FindingSeverity`
  - [x] `FindingConfidence`
  - [x] `GraphRef`
  - [x] `EvidenceRef`
  - [x] `Finding`
- [x] Implement `contracts/explanations.ts`
  - [x] `CauseNode`
  - [x] `CauseChain`
  - [x] explanation output contracts
- [x] Implement `contracts/projections.ts`
  - [x] domain graph projection
  - [x] findings report projection
  - [x] action blocker and availability projections
  - [x] snapshot, trace, lineage, governance projections
- [x] Implement `contracts/session.ts`
  - [x] `OverlayKind`
  - [x] `FindingsFilter`
  - [x] `StudioSession`
- [x] Implement `contracts/versioning.ts`
- [x] Encode stable finding kinds from Appendix B as contract constants or registries.

**Exit criteria**

- [x] All cross-module communication is typed only through `contracts/`.
- [x] Finding kinds, severities, confidences, and evidence structures are fixed and reusable across surfaces.

---

## Phase 2. Ingest Layer

- [x] Implement `normalize-analysis-bundle.ts`
  - [x] enforce required `schema`
  - [x] preserve optional overlays without fabricating empty state
  - [x] return structured "not provided" markers for absent overlay-dependent paths
- [x] Implement `schema-ingest.ts`
  - [x] normalize incoming `DomainSchema`
  - [x] compute or accept stable schema hash for graph/version tracking
- [x] Implement `snapshot-ingest.ts`
  - [x] normalize snapshot overlay inputs
  - [x] preserve immutability expectations
- [x] Implement `trace-ingest.ts`
  - [x] normalize trace overlay inputs
  - [x] validate required trace identity/version fields if available
- [x] Implement `lineage-ingest.ts`
  - [x] adapt lineage query results to `LineageExport`
  - [x] mark adaptation boundary as studio-owned, not lineage-authoritative
- [x] Implement `governance-ingest.ts`
  - [x] adapt governance query results to `GovernanceExport`
  - [x] preserve proposal, binding, gate shapes from the spec
- [x] Add ingest-layer validation errors that are explicit and non-mutating.

**Exit criteria**

- [x] `AnalysisBundle` is the canonical ingress object.
- [x] Optional overlays degrade gracefully instead of failing the entire session.

---

## Phase 3. Graph IR Foundation

- [x] Implement `graph/static-graph-builder.ts`
  - [x] derive graph from `DomainSchema` alone
  - [x] emit only `provenance: 'static'` nodes and edges
  - [x] generate stable node IDs using the spec namespace convention
  - [x] emit static node kinds: `state`, `computed`, `action`, `guard`, `effect`, `patch-target`
  - [x] emit static edge kinds: `reads`, `writes`, `depends-on`, `enables`, `blocks`, `produces`
- [x] Implement `graph/graph-merge.ts`
  - [x] deterministic merge behavior
  - [x] no static node removal on overlay application
  - [x] overlay version updates
- [x] Implement `graph/runtime-overlay-builder.ts`
  - [x] enrich existing static nodes with `OverlayFact`
  - [x] do not create runtime-only nodes
  - [x] attach oracle-derived availability and guard evaluation facts
- [x] Implement `graph/trace-overlay-builder.ts`
  - [x] enrich static nodes with trace-derived facts only
- [x] Implement `graph/lineage-overlay-builder.ts`
  - [x] add `lineage-branch`, `lineage-head`, `lineage-tip`, `lineage-world`
  - [x] add `seals-into`, `branches-from`, `parent-of`
- [x] Implement `graph/governance-overlay-builder.ts`
  - [x] add `governance-proposal`, `governance-actor`, `governance-gate`
  - [x] add `proposes`, `approves`, `gates`
- [x] Add provenance assertions so every added fact, node, and edge carries the correct source marker.

**Exit criteria**

- [x] Static graphs are valid with no overlays attached.
- [x] Re-applying the same inputs yields byte-for-byte equivalent graph content or equivalent deterministic ordering.

---

## Phase 4. Static Analysis MVP

- [x] Implement `analysis/static/reachability-analyzer.ts`
  - [x] emit `unreachable-action`
- [x] Implement `analysis/static/missing-producer-analyzer.ts`
  - [x] emit `missing-producer`
- [x] Implement `analysis/static/dead-state-analyzer.ts`
  - [x] emit `dead-state`
- [x] Implement `analysis/static/computed-cycle-analyzer.ts`
  - [x] emit `cyclic-dependency`
- [x] Implement `analysis/static/guard-satisfiability-analyzer.ts`
  - [x] emit `guard-unsatisfiable`
  - [x] mark results as `heuristic` where required
- [x] Implement `analysis/static/convergence-risk-analyzer.ts`
  - [x] emit `convergence-risk`
  - [x] mark as `heuristic`
- [x] Implement `analysis/static/name-collision-analyzer.ts`
  - [x] emit `name-collision`
- [x] Build a static analysis runner that aggregates findings consistently.
- [x] Ensure every finding has evidence linked to graph nodes.

**Exit criteria**

- [x] Static-only sessions can produce a findings report with stable kinds, severity, confidence, and evidence.
- [x] Heuristic analyzers never emit `confidence: 'exact'`.

---

## Phase 5. Runtime Overlay And Analysis

- [x] Define the session-side Core oracle adapter for:
  - [x] `isActionAvailable()`
  - [x] `getAvailableActions()`
  - [x] `explain()`
- [x] Ensure graph and analysis layers never call Core APIs directly.
- [x] Implement runtime overlay enrichment from oracle results and snapshot data.
- [x] Implement `analysis/runtime/action-availability-analyzer.ts`
  - [x] emit `action-blocked`
- [x] Implement `analysis/runtime/guard-breakdown-analyzer.ts`
  - [x] emit `guard-partial-block`
  - [x] preserve per-subexpression breakdown
- [x] Implement `analysis/runtime/snapshot-diff-analyzer.ts`
  - [x] emit `snapshot-drift`
- [x] Decide and document how unavailable runtime analysis is represented when no snapshot is attached.
- [x] Add tests for graceful degradation when snapshot is absent.

**Exit criteria**

- [x] Runtime findings are produced from overlay facts, not from direct Core coupling inside analyzers.
- [x] `action-blocked` explanations can distinguish static blockers from runtime blockers.

---

## Phase 6. Trace Analysis

- [x] Implement trace overlay enrichment against the static graph.
- [x] Implement `analysis/trace/execution-path-analyzer.ts`
  - [x] emit `unused-branch` where applicable
- [x] Implement `analysis/trace/patch-summary-analyzer.ts`
  - [x] emit `redundant-patch`
- [x] Implement `analysis/trace/effect-summary-analyzer.ts`
  - [x] emit `effect-without-patch`
- [x] Decide how trace steps map back to graph node references for evidence.
- [x] Return explicit "trace not provided" behavior when trace overlay is absent.

**Exit criteria**

- [x] Trace replay and trace findings are unavailable without a trace overlay and never synthesized.
- [x] Trace findings remain linked to graph evidence or trace-derived evidence refs.

---

## Phase 7. Lineage And Governance Overlays

### 7A. Lineage

- [x] Implement lineage ingest adaptation to `LineageExport`.
- [x] Implement lineage overlay graph nodes and edges.
- [x] Implement `analysis/lineage/branch-state-analyzer.ts`
  - [x] emit `branch-stale`
- [x] Implement `analysis/lineage/dag-state-analyzer.ts`
  - [x] emit `orphan-branch` if applicable
- [x] Implement `analysis/lineage/seal-attempt-analyzer.ts`
  - [x] emit `seal-reuse-detected`
- [x] Define stale thresholds and configurability at the session layer or analysis config layer.

### 7B. Governance

- [x] Implement governance ingest adaptation to `GovernanceExport`.
- [x] Implement governance overlay graph nodes and edges.
- [x] Implement `analysis/governance/proposal-state-analyzer.ts`
  - [x] emit `proposal-stale`
- [x] Implement `analysis/governance/gate-state-analyzer.ts`
  - [x] emit `gate-locked`
- [x] Implement `analysis/governance/governed-path-analyzer.ts`
  - [x] emit `actor-unbound` or other governed-path diagnostics as the model settles
- [x] Decide where policy thresholds and stale limits live without leaking governance internals.

**Exit criteria**

- [x] Missing lineage or governance input returns structured absence, not fabricated empty state.
- [x] Overlay nodes and findings clearly preserve lineage vs governance provenance.

---

## Phase 8. Explanation Layer

- [x] Implement `explanation/cause-chain-builder.ts`
  - [x] build ordered paths from observation to root cause
  - [x] preserve provenance at every step
- [x] Implement `explanation/finding-explainer.ts`
  - [x] convert generic findings into explanation payloads
- [x] Implement `explanation/action-blocker-explainer.ts`
  - [x] include action identifier
  - [x] include availability status
  - [x] include blocker breakdown
  - [x] include upstream cause path
  - [x] include natural-language summary
- [x] Implement `explanation/lineage-explainer.ts`
- [x] Implement `explanation/governance-explainer.ts`
- [x] Enforce explanation input constraints so public explainers accept only graph + findings + query params.
- [x] Add tests ensuring explainers do not read raw `DomainSchema`, `Snapshot`, `TraceGraph`, `LineageExport`, or `GovernanceExport`.

**Exit criteria**

- [x] Explanation modules organize existing evidence only.
- [x] Cause chains are traceable to graph nodes and analyzer findings.

---

## Phase 9. Projection Layer

- [x] Implement `projection/domain-graph-projection.ts`
- [x] Implement `projection/findings-report-projection.ts`
- [x] Implement `projection/action-availability-projection.ts`
- [x] Implement `projection/snapshot-inspector-projection.ts`
- [x] Implement `projection/trace-replay-projection.ts`
- [x] Implement `projection/lineage-state-projection.ts`
- [x] Implement `projection/governance-state-projection.ts`
- [x] Ensure every projection is JSON-serializable.
- [x] Ensure no projection includes renderer-specific layout data.
- [x] Ensure no projection naming implies hidden imperative runtime behavior.

**Exit criteria**

- [x] MCP, CLI, and Dashboard can consume the same projection contracts unchanged.
- [x] All stable projections are renderer-agnostic and evidence-preserving.

---

## Phase 10. Session API And Cache Invalidation

- [x] Implement `session/caches.ts`
  - [x] static graph cache
  - [x] static findings cache
  - [x] overlay-specific cache partitions
- [x] Implement `session/create-studio-session.ts`
- [x] Implement `session/studio-session-impl.ts`
  - [x] `attachSnapshot`
  - [x] `attachTrace`
  - [x] `attachLineage`
  - [x] `attachGovernance`
  - [x] `detachOverlay`
  - [x] `getGraph`
  - [x] `getFindings`
  - [x] `explainActionBlocker`
  - [x] `getActionAvailability`
  - [x] `analyzeTrace`
  - [x] `getLineageState`
  - [x] `getGovernanceState`
  - [x] `inspectSnapshot`
  - [x] `dispose`
- [x] Encode the invalidation matrix from spec §10.4 as tests, not just comments.
- [x] Ensure static analysis survives attach/detach cycles unchanged.
- [x] Ensure `dispose()` releases cached graph and analysis state.

**Exit criteria**

- [x] All external consumers can use `studio-core` exclusively through the session API.
- [x] Overlay attach/detach invalidation behavior is deterministic and covered by tests.

---

## Phase 11. Compliance, QA, And Release Readiness

- [x] Add contract serialization tests for findings, explanations, and projections.
- [x] Add deterministic graph build tests for identical inputs.
- [x] Add dependency-boundary tests for the module DAG.
- [x] Add graceful-degradation tests for each missing optional overlay.
- [x] Add compliance review checklist covering:
  - [x] no MEL parsing
  - [x] no mutation APIs
  - [x] no private runtime package dependencies
  - [x] no renderer-specific projection data
  - [x] ontology protection
- [x] Add fixture-driven golden tests for:
  - [x] static findings report
  - [x] action blocker explanation
  - [x] trace replay projection
  - [x] lineage state projection
  - [x] governance state projection
- [x] Document known heuristics and false-positive boundaries for `convergence-risk` and `guard-unsatisfiable`.
- [x] Prepare package README/API docs around `createStudioSession()` and projection contracts.

**Exit criteria**

- [x] The package satisfies the compliance requirements in spec §12.
- [x] Public documentation is sufficient for MCP, CLI, and Dashboard implementers.

---

## Phase 12. Experimental Backlog

- [ ] Keep experimental projections out of the MVP critical path:
  - [ ] `transition-storyboard-projection`
  - [ ] `region-graph-projection`
  - [ ] `why-projection`
- [ ] Define promotion criteria checks aligned with spec §11.2.
- [ ] Require at least two surfaces to consume any experimental projection before stabilizing it.

---

## Suggested Delivery Order

- [x] Milestone A: skeleton, contracts, ingest, static graph
- [x] Milestone B: static analyzers + findings report projection
- [x] Milestone C: runtime overlay + action availability + blocker explanation
- [x] Milestone D: trace support + trace replay projection
- [x] Milestone E: lineage/governance support + state projections
- [x] Milestone F: session invalidation hardening + compliance test pass
- [ ] Milestone G: experimental projections, only after stable MVP ships

---

## Definition Of Done

- [x] `createStudioSession(bundle)` is the single supported entrypoint for consumers.
- [x] Static-only analysis works with `schema` alone.
- [x] Snapshot, trace, lineage, and governance overlays can be attached and detached independently.
- [x] Findings, explanations, and projections are stable, typed, and JSON-serializable.
- [x] The package remains read-only and does not imply runtime semantics that do not exist.
- [x] Stable MVP modules are complete before any experimental projection ships.
