# `@manifesto-ai/studio-core` Specification v0.2.0 (Draft)

**Status:** Draft
**Package:** `@manifesto-ai/studio-core`
**Scope:** Analysis engine for Manifesto domains
**Audience:** Studio maintainers, MCP/CLI/Dashboard implementers
**Related:** Studio PRD v0.2, Core SPEC v4.0.0, Lineage SPEC v3.0.0, Governance SPEC v3.0.0, MEL/Compiler pipeline, ADR-014 (Split World Protocol), ADR-016 (Merkle Tree Lineage), ADR-017 (Capability Decorator Pattern)
**Non-Authority:** This specification does not change Core/Host/Lineage/Governance runtime semantics. Studio reads and explains only.

---

## Revision History

| Version | Date | Change |
|---------|------|--------|
| v0.1.0 | 2026-04-01 | Initial draft. Module families, dependency DAG, finding model, compliance rules. |
| v0.2.0 | 2026-04-02 | Core API oracle boundary (§3.3). Graph IR type definitions (§6). LineageExport/GovernanceExport shapes (§4.3). Static graph purified to DomainSchema-only nodes (§6.3). Session attach/detach lifecycle (§10.2). Explanation signature constraint (§8.3). Ontology protection promoted to compliance (§12). |

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Normative Language](#2-normative-language)
3. [Package Position](#3-package-position)
4. [Canonical Inputs](#4-canonical-inputs)
5. [Internal Architecture](#5-internal-architecture)
6. [Graph IR](#6-graph-ir)
7. [Findings Model](#7-findings-model)
8. [Explanation Model](#8-explanation-model)
9. [Projection Model](#9-projection-model)
10. [Session Lifecycle](#10-session-lifecycle)
11. [Experimental Projections](#11-experimental-projections)
12. [Compliance Requirements](#12-compliance-requirements)
13. [Recommended File Structure](#13-recommended-file-structure)
14. [Appendix A — PRD Requirement Mapping](#appendix-a--prd-requirement-mapping)
15. [Appendix B — Stable Finding Kind Registry](#appendix-b--stable-finding-kind-registry)

---

## 1. Purpose

`studio-core` is the canonical analysis engine for Manifesto Studio.

It receives Manifesto public artifacts and produces:

- semantic graph IR
- structured findings with severity and confidence
- cause-chain explanations
- surface-neutral projections for human and AI consumers

`studio-core` is **not** a runtime, **not** a renderer, and **not** a mutation engine. It exists to make Manifesto domains understandable. This preserves the product thesis and the principle **"Read, Don't Rule"** from Studio PRD v0.2.

### 1.1 Primary Goals

`studio-core` MUST enable:

1. Static structural analysis of a Manifesto domain from `DomainSchema` alone.
2. Runtime overlay analysis using `Snapshot`.
3. Execution-path interpretation using `TraceGraph`.
4. Lineage/governance state reading when those exports exist.
5. Consistent outputs for MCP, CLI, and Dashboard surfaces from one shared engine.

### 1.2 Non-Goals

`studio-core` MUST NOT:

- execute effects
- mutate `Snapshot`, `DomainSchema`, lineage state, or governance state
- advance lineage state or decide governance policy
- parse MEL directly
- contain renderer-specific graph layout logic
- auto-fix or auto-patch domain definitions

---

## 2. Normative Language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are interpreted as described in RFC 2119.

---

## 3. Package Position

Manifesto's runtime packages preserve distinct semantics:

- **Core** computes meaning
- **Host** executes effects
- **Lineage** preserves continuity
- **Governance** preserves legitimacy

`studio-core` sits outside those layers and reads their public artifacts. It is an **interpretation layer**, not an execution layer.

### 3.1 Read-Only Boundary

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-CORE-1 | MUST | `studio-core` MUST treat `DomainSchema` as the canonical static input. |
| STUDIO-CORE-2 | MUST | All other inputs (`Snapshot`, `TraceGraph`, lineage export, governance export) MUST be treated as overlays on top of the canonical static input. |
| STUDIO-CORE-3 | MUST NOT | `studio-core` MUST NOT depend on Manifesto runtime package private internals (internal module paths, unexported types, implementation details). |
| STUDIO-CORE-4 | MUST | `studio-core` MUST consume only public contracts or explicit export artifacts from Manifesto packages. |

### 3.2 Mutation Prohibition

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-CORE-5 | MUST NOT | `studio-core` MUST NOT call `core.compute()`, `core.apply()`, `core.applySystemDelta()`, `host.processIntent()`, or any lineage/governance mutation API. |
| STUDIO-CORE-6 | MUST NOT | `studio-core` MUST NOT modify any artifact it receives as input. All inputs are treated as immutable. |

### 3.3 Core Oracle Boundary

`studio-core` needs runtime evaluation results (action availability, guard evaluation, value explanation) without duplicating Core's expression evaluator. Core's **public query API** serves as an oracle for this purpose.

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-CORE-7 | MAY | `studio-core` MAY invoke Core public **query** API: `isActionAvailable()`, `getAvailableActions()`, `explain()`. |
| STUDIO-CORE-8 | MUST | Core oracle calls MUST occur only within the `session/` layer. The `graph/` and `analysis/` modules MUST NOT call Core API directly. |
| STUDIO-CORE-9 | MUST | Oracle results MUST enter the analysis pipeline through graph IR enrichment or session-provided context objects, not through direct Core API coupling in analyzers. |

**Rationale.** This pattern preserves the purity of graph/analysis layers (they see only IR) while avoiding expression evaluator duplication. If Core changes its evaluation semantics, studio-core inherits the change through oracle calls rather than maintaining a parallel evaluator.

The oracle pattern works as follows:

```
session layer
  ├─ calls core.isActionAvailable(schema, snapshot, actionName)
  ├─ calls core.explain(schema, snapshot, path)
  └─ injects results into graph IR as runtime-overlay facts
        ↓
  graph/ layer sees enriched IR with availability facts
        ↓
  analysis/ layer consumes IR, emits findings
```

---

## 4. Canonical Inputs

### 4.1 Analysis Bundle

The canonical ingress object is `AnalysisBundle`.

```ts
type AnalysisBundle = {
  schema: DomainSchema
  snapshot?: Snapshot
  trace?: TraceGraph
  lineage?: LineageExport
  governance?: GovernanceExport
}
```

### 4.2 Input Roles

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-INPUT-1 | MUST | `AnalysisBundle.schema` MUST be present for every `studio-core` session. |
| STUDIO-INPUT-2 | MUST | If `snapshot` is absent, runtime availability analysis MUST be unavailable rather than guessed. |
| STUDIO-INPUT-3 | MUST | If `trace` is absent, trace-specific projections MUST be unavailable rather than synthesized. |
| STUDIO-INPUT-4 | MUST | If lineage/governance exports are absent, related analyzers MUST return a structured "not provided" result rather than fabricated empty state. |
| STUDIO-INPUT-5 | MUST | Absence of optional inputs MUST degrade gracefully, not fail analysis wholesale. |

This follows PRD v0.2's `DomainSchema First` and `Static First, Runtime Second` principles.

### 4.3 Export Artifact Types

Lineage and Governance packages do not currently define read-only export artifacts for external consumers. `studio-core` is the first external consumer and defines the following **studio-owned** export shapes. These are adaptation targets — studio-core's ingest layer is responsible for populating them from whatever query API the protocol packages provide.

When Lineage and Governance packages introduce official export contracts, studio-core SHOULD migrate to those contracts and deprecate studio-owned definitions.

#### 4.3.1 LineageExport

```ts
type LineageExport = {
  /** All branches known to this lineage instance */
  branches: BranchSummary[]

  /** The currently active branch ID */
  activeBranchId: string

  /** DAG of worlds, keyed by WorldId */
  worlds: Map<string, WorldSummary>

  /** Seal attempts, keyed by WorldId */
  attempts: Map<string, SealAttemptSummary[]>
}

type BranchSummary = {
  id: string
  headWorldId: string | null
  tipWorldId: string | null
  epoch: number
  headAdvancedAt: number | null
}

type WorldSummary = {
  worldId: string
  parentWorldId: string | null
  schemaHash: string
  snapshotHash: string
  terminalStatus: 'completed' | 'failed'
  createdAt: number
}

type SealAttemptSummary = {
  worldId: string
  branchId: string
  reused: boolean
  createdAt: number
}
```

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-EXPORT-1 | MUST | `LineageExport` types are studio-core owned. They are NOT authoritative Lineage SPEC types. |
| STUDIO-EXPORT-2 | MUST | The ingest layer MUST adapt Lineage query results into `LineageExport` shape. |
| STUDIO-EXPORT-3 | SHOULD | When `@manifesto-ai/lineage` introduces an official export contract, studio-core SHOULD migrate to it. |

#### 4.3.2 GovernanceExport

```ts
type GovernanceExport = {
  /** Known proposals, keyed by proposalId */
  proposals: Map<string, ProposalSummary>

  /** Actor-authority bindings */
  bindings: ActorBindingSummary[]

  /** Gate state per branch */
  gates: Map<string, GateStateSummary>
}

type ProposalSummary = {
  id: string
  branchId: string
  stage: 'ingress' | 'execution' | 'terminal'
  outcome?: 'approved' | 'rejected' | 'abandoned'
  actorId: string
  createdAt: number
  terminalizedAt?: number
}

type ActorBindingSummary = {
  actorId: string
  authorityId: string
  permissions: string[]
}

type GateStateSummary = {
  branchId: string
  locked: boolean
  currentProposalId?: string
  epoch: number
}
```

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-EXPORT-4 | MUST | `GovernanceExport` types are studio-core owned. They are NOT authoritative Governance SPEC types. |
| STUDIO-EXPORT-5 | MUST | The ingest layer MUST adapt Governance query results into `GovernanceExport` shape. |
| STUDIO-EXPORT-6 | SHOULD | When `@manifesto-ai/governance` introduces an official export contract, studio-core SHOULD migrate to it. |

### 4.4 MEL Support

MEL source is a convenience path only.

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-INPUT-6 | MUST NOT | `studio-core` MUST NOT parse MEL directly. |
| STUDIO-INPUT-7 | MUST | Any MEL convenience workflow MUST pass through compiler output and enter `studio-core` as `DomainSchema`. |

This preserves compiler authority and avoids parser duplication.

---

## 5. Internal Architecture

`studio-core` MUST separate responsibilities into the following module families:

```
contracts → ingest → graph → analysis → explanation → projection → session
```

### 5.1 Dependency DAG

The permitted dependency direction is strictly layered. Lower layers MUST NOT import from higher layers.

```
contracts          (imported by all)
  ↑
ingest             (reads contracts)
  ↑
graph              (reads contracts, ingest output)
  ↑
analysis           (reads contracts, graph output)
  ↑
explanation        (reads contracts, graph output, analysis output)
  ↑
projection         (reads contracts, explanation output, analysis output, graph output)
  ↑
session            (reads all, orchestrates lifecycle)
```

### 5.2 Forbidden Dependencies

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-ARCH-1 | MUST NOT | `analysis/` MUST NOT import from `projection/`. |
| STUDIO-ARCH-2 | MUST NOT | `graph/` MUST NOT import from `analysis/`. |
| STUDIO-ARCH-3 | MUST NOT | `projection/` MUST NOT import renderer-specific packages. |
| STUDIO-ARCH-4 | MUST NOT | `ingest/` MUST NOT emit findings. |
| STUDIO-ARCH-5 | MUST NOT | `explanation/` MUST NOT introduce new analysis facts not present in graph or analyzer output. (See §8.3 for enforcement mechanism.) |
| STUDIO-ARCH-6 | MUST NOT | `graph/`, `analysis/`, `explanation/`, `projection/` MUST NOT call Core, Lineage, or Governance APIs directly. Only `session/` and `ingest/` may do so. |

### 5.3 Contracts Module

`contracts/` defines the shared language of `studio-core`.

It MUST contain at minimum:

- `inputs.ts` — `AnalysisBundle`, `LineageExport`, `GovernanceExport`, and overlay types
- `graph-ir.ts` — `SemanticGraphIR`, `GraphNode`, `GraphEdge`, node/edge kind enums
- `findings.ts` — `Finding`, `FindingSeverity`, `FindingKind`, `EvidenceRef`
- `explanations.ts` — `CauseChain`, `CauseNode`, `Explanation`
- `projections.ts` — All projection output types
- `session.ts` — `StudioSession` interface
- `versioning.ts` — Version compatibility types

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-CONTRACT-1 | MUST | All cross-module communication inside `studio-core` MUST flow through `contracts/` types. |
| STUDIO-CONTRACT-2 | MUST | Surface packages (`studio-mcp`, `studio-cli`, `studio-dashboard`) MUST consume `studio-core` through session and projection contracts, not internal module types. |

---

## 6. Graph IR

The semantic graph IR is the structural backbone of `studio-core`. All analyzers, explainers, and projections operate on this shared representation.

### 6.1 Core Types

```ts
// ── Node Kinds ──────────────────────────────────────────────

type StaticNodeKind =
  | 'state'
  | 'computed'
  | 'action'
  | 'guard'
  | 'effect'
  | 'patch-target'

type LineageNodeKind =
  | 'lineage-branch'
  | 'lineage-head'
  | 'lineage-tip'
  | 'lineage-world'

type GovernanceNodeKind =
  | 'governance-proposal'
  | 'governance-actor'
  | 'governance-gate'

type GraphNodeKind = StaticNodeKind | LineageNodeKind | GovernanceNodeKind

// ── Edge Kinds ──────────────────────────────────────────────

type StaticEdgeKind =
  | 'reads'
  | 'writes'
  | 'depends-on'
  | 'enables'
  | 'blocks'
  | 'produces'

type LineageEdgeKind =
  | 'seals-into'
  | 'branches-from'
  | 'parent-of'

type GovernanceEdgeKind =
  | 'proposes'
  | 'approves'
  | 'gates'

type GraphEdgeKind = StaticEdgeKind | LineageEdgeKind | GovernanceEdgeKind

// ── Provenance ──────────────────────────────────────────────

type FactProvenance =
  | 'static'       // derived from DomainSchema
  | 'runtime'      // derived from Snapshot (via oracle or ingest)
  | 'trace'        // derived from TraceGraph
  | 'lineage'      // derived from LineageExport
  | 'governance'   // derived from GovernanceExport

// ── Graph Structures ────────────────────────────────────────

type GraphNode = {
  /** Stable node identifier, unique within a graph */
  id: string

  /** Semantic kind of this node */
  kind: GraphNodeKind

  /**
   * Path in the source artifact that produced this node.
   * For static nodes: DomainSchema path (e.g., "actions.submit", "state.userId")
   * For overlay nodes: export-relative path (e.g., "branches.main", "proposals.p1")
   */
  sourcePath: string

  /** Provenance of this node */
  provenance: FactProvenance

  /** Kind-specific structured metadata */
  metadata: Record<string, unknown>

  /**
   * Overlay facts attached to this node by overlay builders.
   * Static nodes MAY accumulate overlay facts from runtime/trace/lineage.
   * Overlay nodes are created with their provenance set at construction.
   */
  overlayFacts: OverlayFact[]
}

type OverlayFact = {
  key: string
  value: unknown
  provenance: FactProvenance
  /** Timestamp or version of the source artifact */
  observedAt?: number
}

type GraphEdge = {
  /** Source node ID */
  source: string

  /** Target node ID */
  target: string

  /** Semantic kind of this edge */
  kind: GraphEdgeKind

  /** Provenance of this edge */
  provenance: FactProvenance

  /** Optional structured metadata */
  metadata?: Record<string, unknown>
}

type OverlayVersionMap = {
  schemaHash: string
  snapshotVersion?: number
  traceBaseVersion?: number
  lineageEpoch?: number
  governanceEpoch?: number
}

type SemanticGraphIR = {
  /** All nodes, keyed by node ID */
  nodes: Map<string, GraphNode>

  /** All edges */
  edges: GraphEdge[]

  /** Schema hash that produced the static base */
  schemaHash: string

  /** Versions of overlays applied to this graph */
  overlayVersions: OverlayVersionMap
}
```

### 6.2 Graph Node ID Convention

Node IDs SHOULD follow a namespaced convention for stable cross-reference:

| Node Kind | ID Pattern | Example |
|-----------|------------|---------|
| `state` | `state:{fieldPath}` | `state:userId` |
| `computed` | `computed:{fieldPath}` | `computed:activeCount` |
| `action` | `action:{actionName}` | `action:submit` |
| `guard` | `guard:{actionName}` | `guard:submit` |
| `effect` | `effect:{actionName}:{index}` | `effect:submit:0` |
| `patch-target` | `patch:{actionName}:{path}` | `patch:submit:userId` |
| `lineage-branch` | `lineage:branch:{branchId}` | `lineage:branch:main` |
| `lineage-world` | `lineage:world:{worldId}` | `lineage:world:abc123` |
| `governance-proposal` | `gov:proposal:{proposalId}` | `gov:proposal:p1` |
| `governance-actor` | `gov:actor:{actorId}` | `gov:actor:alice` |

### 6.3 Static Graph

`static-graph-builder` consumes `DomainSchema` and produces the base graph.

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-GRAPH-1 | MUST | The static graph MUST be derivable from `DomainSchema` alone. |
| STUDIO-GRAPH-2 | MUST | The static graph MUST contain only nodes with `provenance: 'static'`. |
| STUDIO-GRAPH-3 | MUST NOT | The static graph MUST NOT contain lineage or governance node kinds. Those are overlay-only. |
| STUDIO-GRAPH-4 | MUST | The static graph MUST remain valid even when no overlay is present. |

**Static node kinds:** `state`, `computed`, `action`, `guard`, `effect`, `patch-target`.

**Static edge kinds:** `reads`, `writes`, `depends-on`, `enables`, `blocks`, `produces`.

### 6.4 Overlay Builders

Overlay builders enrich the static graph using optional artifacts. Each overlay builder receives the current `SemanticGraphIR` and its corresponding export, and returns an enriched `SemanticGraphIR`.

| Builder | Input Artifact | Adds Node Kinds | Adds Edge Kinds |
|---------|---------------|-----------------|-----------------|
| `runtime-overlay-builder` | `Snapshot` | (none — enriches existing static nodes) | (none — attaches overlay facts) |
| `trace-overlay-builder` | `TraceGraph` | (none — enriches existing static nodes) | (none — attaches overlay facts) |
| `lineage-overlay-builder` | `LineageExport` | `lineage-branch`, `lineage-head`, `lineage-tip`, `lineage-world` | `seals-into`, `branches-from`, `parent-of` |
| `governance-overlay-builder` | `GovernanceExport` | `governance-proposal`, `governance-actor`, `governance-gate` | `proposes`, `approves`, `gates` |

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-GRAPH-5 | MUST | Overlays MUST enrich the graph rather than replace or remove static nodes or edges. |
| STUDIO-GRAPH-6 | MUST | Every node and edge added or enriched by an overlay MUST carry the appropriate `provenance` value. |
| STUDIO-GRAPH-7 | MUST | Graph merging MUST be deterministic for identical inputs. |
| STUDIO-GRAPH-8 | MUST | `runtime-overlay-builder` MUST inject Core oracle results (action availability, guard evaluation) as `OverlayFact` entries on the corresponding static nodes, not as new nodes. |

---

## 7. Findings Model

### 7.1 Finding Type

```ts
type FindingSeverity = 'error' | 'warn' | 'info'

type FindingConfidence = 'exact' | 'heuristic'

type GraphRef = {
  nodeId: string
  path?: string
}

type EvidenceRef = {
  /** What this evidence points to in the graph */
  ref: GraphRef
  /** Human-readable role of this evidence in the finding */
  role: string
}

type Finding = {
  /** Unique ID for this finding instance */
  id: string

  /** Stable kind identifier from the Finding Kind Registry (Appendix B) */
  kind: string

  /** Severity classification */
  severity: FindingSeverity

  /** Confidence level. MUST be 'heuristic' for non-deterministic analysis. */
  confidence: FindingConfidence

  /** Primary subject of this finding */
  subject: GraphRef

  /** Short machine-readable summary */
  message: string

  /** Evidence trail linking this finding to graph nodes */
  evidence: EvidenceRef[]

  /** Optional pre-computed cause chain */
  causeChain?: CauseChain
}
```

### 7.2 Finding Rules

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-FINDING-1 | MUST | Finding `kind` values MUST be stable identifiers from Appendix B, not UI labels. |
| STUDIO-FINDING-2 | MUST | Findings MUST be JSON-serializable. |
| STUDIO-FINDING-3 | MUST | Findings MUST be consumable equally by MCP, CLI, and Dashboard surfaces. |
| STUDIO-FINDING-4 | MUST | Heuristic findings MUST set `confidence: 'heuristic'`. This is particularly important for `convergence-risk`, which PRD v0.2 explicitly treats as heuristic and potentially false-positive. |
| STUDIO-FINDING-5 | MUST | Every finding MUST reference at least one `evidence` entry linking it to the graph. |

---

## 8. Explanation Model

`explanation/` transforms findings and graph facts into structured cause chains. It does not discover new facts — it organizes existing evidence from the graph and analysis layers.

### 8.1 Cause Chain Type

```ts
type CauseNode = {
  /** Graph node this cause step refers to */
  ref: GraphRef

  /** What happened or what is observed at this point */
  fact: string

  /** Provenance of the underlying fact */
  provenance: FactProvenance

  /** Whether this node is the root cause */
  isRoot: boolean
}

type CauseChain = {
  /** The starting observation (e.g., "action.submit is blocked") */
  observation: CauseNode

  /** Ordered path from observation to root cause */
  path: CauseNode[]

  /** The root cause node (last element of path, duplicated for convenience) */
  root: CauseNode

  /** Natural-language summary suitable for MCP/CLI output */
  summary: string
}
```

**Example cause chain:**

```
observation: action.submit is blocked
  → guard requires state.userId != null          [static]
  → current snapshot has userId = null            [runtime]
  → static graph shows no producer for userId     [static]
  → root cause: missing producer for state.userId [static]
```

### 8.2 Explanation Modules

| Module | Purpose | Primary Consumer |
|--------|---------|-----------------|
| `cause-chain-builder` | Generic cause chain construction from graph traversal + findings | All explainers |
| `finding-explainer` | Converts any finding into a structured explanation | `findings-report-projection` |
| `action-blocker-explainer` | Specialized: "why is this action blocked?" | MCP `explain_action_blocker`, CLI `explain --action` |
| `lineage-explainer` | Specialized: lineage state narration | `lineage-state-projection` |
| `governance-explainer` | Specialized: governance state narration | `governance-state-projection` |

### 8.3 Explanation Input Constraint

To enforce STUDIO-ARCH-5 (explanation must not introduce new analysis facts), explanation module function signatures are constrained.

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-EXPLAIN-1 | MUST | Explanation module public functions MUST accept only `(graph: SemanticGraphIR, findings: Finding[], ...queryParams)` as inputs. They MUST NOT accept raw artifacts (`DomainSchema`, `Snapshot`, `TraceGraph`, `LineageExport`, `GovernanceExport`) directly. |
| STUDIO-EXPLAIN-2 | MUST | Every explanation MUST be traceable back to graph nodes or analyzer findings. |
| STUDIO-EXPLAIN-3 | MUST | Explanations MUST preserve the distinction between structural causes (`provenance: 'static'`) and runtime causes (`provenance: 'runtime'`). |
| STUDIO-EXPLAIN-4 | MUST | `action-blocker-explainer` output MUST include: action identifier, current availability status, blocker breakdown, upstream cause path, and natural-language summary. |

**Rationale for STUDIO-EXPLAIN-1.** If explanation functions could receive raw `DomainSchema` or `Snapshot`, nothing prevents them from performing ad-hoc analysis that bypasses the graph/analysis layers. By constraining the input signature at the type level, the "explanation is organization, not discovery" principle becomes structurally enforced rather than convention-dependent.

---

## 9. Projection Model

`projection/` converts internal analysis and explanation outputs into surface-neutral view models. These are portable data structures for MCP, CLI, and Dashboard — not UI widgets.

### 9.1 Projection Modules

| Module | Description |
|--------|-------------|
| `domain-graph-projection` | Graph structure for visualization surfaces |
| `findings-report-projection` | Aggregated findings with severity breakdown |
| `action-availability-projection` | Per-action availability with blocker detail |
| `snapshot-inspector-projection` | Current snapshot state with semantic annotations |
| `trace-replay-projection` | Execution path with step-by-step annotation |
| `lineage-state-projection` | Branch/DAG/head state for lineage visualization |
| `governance-state-projection` | Proposal/gate/actor state for governance visualization |

### 9.2 Example Projection Type

```ts
type ActionAvailabilityProjection = {
  actionId: string
  available: boolean
  guard?: {
    expression: string       // human-readable guard expression summary
    evaluation?: boolean     // runtime evaluation result, if snapshot present
  }
  blockers?: GuardBreakdownEntry[]
  explanation?: CauseChain
}

type GuardBreakdownEntry = {
  subExpression: string
  evaluated: boolean
  ref: GraphRef
}
```

### 9.3 Projection Rules

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-PROJ-1 | MUST | Projection outputs MUST be renderer-agnostic. |
| STUDIO-PROJ-2 | MUST | Projection outputs MUST preserve enough structure for both human-readable and machine-readable surfaces. |
| STUDIO-PROJ-3 | MUST NOT | Projection outputs MUST NOT encode layout engine details (coordinates, pixel sizes, CSS classes). |
| STUDIO-PROJ-4 | MUST | Projection outputs MUST be JSON-serializable. |
| STUDIO-PROJ-5 | MUST NOT | Projections MUST NOT imply execution semantics that do not exist in Core/Host. See §12 STUDIO-COMP-9. |

---

## 10. Session Lifecycle

### 10.1 Session Purpose

A session is the orchestration boundary for `studio-core`. All external consumers interact with `studio-core` exclusively through a session. The session owns the analysis lifecycle: ingest, graph construction, overlay management, cache invalidation, and projection dispatch.

### 10.2 Session API

```ts
type OverlayKind = 'snapshot' | 'trace' | 'lineage' | 'governance'

type StudioSession = {
  // ── Schema (immutable after creation) ─────────────────────

  /** The DomainSchema this session was created with */
  readonly schema: DomainSchema

  // ── Overlay Management ────────────────────────────────────

  /**
   * Attach or replace a snapshot overlay.
   * Invalidates runtime analysis, runtime overlay facts, and dependent projections.
   */
  attachSnapshot(snapshot: Snapshot): void

  /**
   * Attach or replace a trace overlay.
   * Invalidates trace analysis and dependent projections.
   */
  attachTrace(trace: TraceGraph): void

  /**
   * Attach or replace a lineage export overlay.
   * Invalidates lineage analysis, lineage overlay nodes/edges, and dependent projections.
   */
  attachLineage(lineage: LineageExport): void

  /**
   * Attach or replace a governance export overlay.
   * Invalidates governance analysis, governance overlay nodes/edges, and dependent projections.
   */
  attachGovernance(governance: GovernanceExport): void

  /**
   * Remove an overlay.
   * Invalidates all analysis and projections that depend on the removed overlay kind.
   */
  detachOverlay(kind: OverlayKind): void

  // ── Queries ───────────────────────────────────────────────

  /** Get the semantic graph (static, or static+overlays) */
  getGraph(format?: 'summary' | 'full'): DomainGraphProjection

  /** Get findings, optionally filtered */
  getFindings(filter?: FindingsFilter): FindingsReportProjection

  /** Explain why a specific action is blocked */
  explainActionBlocker(actionId: string): ActionBlockerProjection

  /** Get availability status for all actions */
  getActionAvailability(): ActionAvailabilityProjection[]

  /** Analyze a trace (requires trace overlay) */
  analyzeTrace(): TraceReplayProjection

  /** Get lineage state (requires lineage overlay) */
  getLineageState(): LineageStateProjection

  /** Get governance state (requires governance overlay) */
  getGovernanceState(): GovernanceStateProjection

  /** Inspect current snapshot state (requires snapshot overlay) */
  inspectSnapshot(): SnapshotInspectorProjection

  // ── Lifecycle ─────────────────────────────────────────────

  /** Release all cached analysis results and graph data */
  dispose(): void
}

type FindingsFilter = {
  severity?: FindingSeverity[]
  kinds?: string[]
  /** Filter to findings whose subject matches these node IDs */
  subjects?: string[]
  /** Include only findings with specific provenance */
  provenance?: FactProvenance[]
}
```

### 10.3 Session Creation

```ts
/**
 * Create a studio session from an analysis bundle.
 * schema is required. All other bundle fields are optional initial overlays.
 */
function createStudioSession(bundle: AnalysisBundle): StudioSession
```

The creation flow:

1. Validate and ingest `schema` (required)
2. Build static graph
3. Run static analysis, cache results
4. If optional overlays are present in the bundle, attach them (triggering overlay build + analysis)

### 10.4 Cache Invalidation Policy

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-SESSION-1 | MUST | All external consumers MUST interact with `studio-core` through a session-level API. |
| STUDIO-SESSION-2 | MUST | A session MUST cache static analysis results. Static graph and static findings MUST NOT be recomputed unless `dispose()` is called and a new session is created. |
| STUDIO-SESSION-3 | MUST | When an overlay is attached or detached, ALL analysis and projections that depend on that overlay kind MUST be invalidated. |
| STUDIO-SESSION-4 | MUST | Static analysis results MUST survive overlay attach/detach cycles unchanged. |
| STUDIO-SESSION-5 | MAY | Sessions MAY be stateful across multiple surface calls, especially for MCP workflows. This follows the PRD's MCP lifecycle design. |

**Invalidation matrix:**

| Event | Static Graph | Static Analysis | Runtime Overlay | Runtime Analysis | Trace Analysis | Lineage Overlay | Lineage Analysis | Governance Overlay | Governance Analysis |
|-------|-------------|----------------|----------------|-----------------|---------------|----------------|-----------------|-------------------|-------------------|
| `attachSnapshot` | preserved | preserved | **invalidated** | **invalidated** | preserved | preserved | preserved | preserved | preserved |
| `attachTrace` | preserved | preserved | preserved | preserved | **invalidated** | preserved | preserved | preserved | preserved |
| `attachLineage` | preserved | preserved | preserved | preserved | preserved | **invalidated** | **invalidated** | preserved | preserved |
| `attachGovernance` | preserved | preserved | preserved | preserved | preserved | preserved | preserved | **invalidated** | **invalidated** |
| `detachOverlay('snapshot')` | preserved | preserved | **removed** | **removed** | preserved | preserved | preserved | preserved | preserved |
| `detachOverlay('trace')` | preserved | preserved | preserved | preserved | **removed** | preserved | preserved | preserved | preserved |
| `detachOverlay('lineage')` | preserved | preserved | preserved | preserved | preserved | **removed** | **removed** | preserved | preserved |
| `detachOverlay('governance')` | preserved | preserved | preserved | preserved | preserved | preserved | preserved | **removed** | **removed** |

---

## 11. Experimental Projections

The following projection families are valuable but SHOULD begin as experimental:

| Module | Description |
|--------|-------------|
| `transition-storyboard-projection` | Step-like transition storytelling for pedagogical visualization |
| `region-graph-projection` | XState-like semantic region grouping for complex domains |
| `why-projection` | Targeted "why" answers for arbitrary domain questions |

### 11.1 Experimental Rules

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-EXP-1 | MUST | Experimental projections MUST remain isolated from the stable MVP finding engine contract until stabilized. |
| STUDIO-EXP-2 | MUST | Experimental projections MUST depend on stable graph, analysis, and explanation outputs rather than redefining those layers. |
| STUDIO-EXP-3 | MUST | Experimental projections MUST be named as projections or episodes, not as runtime machine states or imperative engine steps. (See §12 STUDIO-COMP-9 for the general ontology protection rule.) |

### 11.2 Graduation Criteria

An experimental projection MAY be promoted to stable when:

1. Its contract type has been stable for at least two minor version cycles.
2. At least two surfaces (e.g., MCP + Dashboard) consume it without modification.
3. It does not require changes to the graph IR, analysis, or explanation layers.
4. It has been reviewed for ontology compliance (STUDIO-COMP-9).

---

## 12. Compliance Requirements

A `studio-core` implementation is compliant only if **all** of the following are true:

| Rule ID | Level | Description |
|---------|-------|-------------|
| STUDIO-COMP-1 | MUST | It accepts `DomainSchema` as the canonical static input. |
| STUDIO-COMP-2 | MUST NOT | It does not parse MEL directly. |
| STUDIO-COMP-3 | MUST | It separates graph construction, analysis, explanation, and projection into distinct module families with the dependency DAG defined in §5. |
| STUDIO-COMP-4 | MUST | It emits structured findings with severity and confidence. |
| STUDIO-COMP-5 | MUST | It emits cause-chain-capable explanations traceable to graph evidence. |
| STUDIO-COMP-6 | MUST | It provides surface-neutral, renderer-agnostic projections. |
| STUDIO-COMP-7 | MUST NOT | It does not mutate runtime, lineage, or governance state. |
| STUDIO-COMP-8 | MUST | It degrades gracefully when overlay artifacts are absent. |
| STUDIO-COMP-9 | MUST NOT | It MUST NOT imply, through naming, structure, or documentation, the existence of execution semantics not present in Core/Host. Snapshot is the single source of truth. TraceGraph is the official execution explanation substrate. Studio MAY visualize transitions pedagogically but MUST NOT suggest a hidden imperative step runtime. |

**Rationale for STUDIO-COMP-9.** This rule exists because studio-core's projections will be consumed by AI agents and human developers who may form mental models of Manifesto's execution semantics from Studio output. If a projection implies state-machine-like imperative steps, consumers may incorrectly believe Manifesto has a hidden step runtime, contradicting Core's declarative compute model (FDR-003: No Pause/Resume, FDR-006: Flow is Not Turing-Complete).

---

## 13. Recommended File Structure

```
packages/studio-core/
  src/
    contracts/
      inputs.ts            — AnalysisBundle, LineageExport, GovernanceExport
      graph-ir.ts          — SemanticGraphIR, GraphNode, GraphEdge, kinds, provenance
      findings.ts          — Finding, FindingSeverity, FindingConfidence, EvidenceRef
      explanations.ts      — CauseChain, CauseNode, Explanation
      projections.ts       — All projection output types
      session.ts           — StudioSession interface, FindingsFilter
      versioning.ts        — Version compatibility types

    ingest/
      normalize-analysis-bundle.ts
      schema-ingest.ts
      snapshot-ingest.ts
      trace-ingest.ts
      lineage-ingest.ts    — adapts LineageStore queries → LineageExport
      governance-ingest.ts — adapts GovernanceStore queries → GovernanceExport

    graph/
      static-graph-builder.ts
      runtime-overlay-builder.ts
      trace-overlay-builder.ts
      lineage-overlay-builder.ts
      governance-overlay-builder.ts
      graph-merge.ts

    analysis/
      static/
        reachability-analyzer.ts
        missing-producer-analyzer.ts
        dead-state-analyzer.ts
        computed-cycle-analyzer.ts
        guard-satisfiability-analyzer.ts
        convergence-risk-analyzer.ts
        name-collision-analyzer.ts
      runtime/
        action-availability-analyzer.ts
        guard-breakdown-analyzer.ts
        snapshot-diff-analyzer.ts
      trace/
        execution-path-analyzer.ts
        patch-summary-analyzer.ts
        effect-summary-analyzer.ts
      lineage/
        branch-state-analyzer.ts
        dag-state-analyzer.ts
        seal-attempt-analyzer.ts
      governance/
        proposal-state-analyzer.ts
        gate-state-analyzer.ts
        governed-path-analyzer.ts

    explanation/
      cause-chain-builder.ts
      finding-explainer.ts
      action-blocker-explainer.ts
      lineage-explainer.ts
      governance-explainer.ts

    projection/
      domain-graph-projection.ts
      findings-report-projection.ts
      action-availability-projection.ts
      snapshot-inspector-projection.ts
      trace-replay-projection.ts
      lineage-state-projection.ts
      governance-state-projection.ts
      experimental/
        transition-storyboard-projection.ts
        region-graph-projection.ts
        why-projection.ts

    session/
      create-studio-session.ts
      studio-session-impl.ts
      caches.ts

    index.ts
```

---

## Appendix A — PRD Requirement Mapping

| PRD Requirement | Module | Analyzer / Projection |
|-----------------|--------|-----------------------|
| SA-REACH (reachability) | `analysis/static/` | `reachability-analyzer` |
| SA-PRODUCER (missing producer) | `analysis/static/` | `missing-producer-analyzer` |
| SA-DEAD (dead state) | `analysis/static/` | `dead-state-analyzer` |
| SA-CYCLE (computed cycle) | `analysis/static/` | `computed-cycle-analyzer` |
| SA-GUARD (guard satisfiability) | `analysis/static/` | `guard-satisfiability-analyzer` |
| SA-CONVERGE (convergence risk) | `analysis/static/` | `convergence-risk-analyzer` |
| SA-COLLISION (name collision) | `analysis/static/` | `name-collision-analyzer` |
| RA-AVAIL (action availability) | `analysis/runtime/` | `action-availability-analyzer` |
| RA-GUARD (guard breakdown) | `analysis/runtime/` | `guard-breakdown-analyzer` |
| RA-DIFF (snapshot diff) | `analysis/runtime/` | `snapshot-diff-analyzer` |
| TA-PATH (execution path) | `analysis/trace/` | `execution-path-analyzer` |
| TA-PATCH (patch summary) | `analysis/trace/` | `patch-summary-analyzer` |
| TA-EFFECT (effect summary) | `analysis/trace/` | `effect-summary-analyzer` |
| LA-BRANCH (branch state) | `analysis/lineage/` | `branch-state-analyzer` |
| LA-DAG (DAG state) | `analysis/lineage/` | `dag-state-analyzer` |
| LA-SEAL (seal attempts) | `analysis/lineage/` | `seal-attempt-analyzer` |
| GA-PROPOSAL (proposal state) | `analysis/governance/` | `proposal-state-analyzer` |
| GA-GATE (gate state) | `analysis/governance/` | `gate-state-analyzer` |
| GA-PATH (governed path) | `analysis/governance/` | `governed-path-analyzer` |
| P5 (Explainability over Detection) | `explanation/` | `cause-chain-builder`, `action-blocker-explainer` |

---

## Appendix B — Stable Finding Kind Registry

Finding `kind` values are stable identifiers used across all surfaces. New kinds MUST be registered here before use.

### B.1 Static Findings

| Kind | Severity | Confidence | Description |
|------|----------|------------|-------------|
| `unreachable-action` | error | exact | Action can never be dispatched given current schema structure |
| `missing-producer` | error | exact | State field has no action that writes to it |
| `dead-state` | warn | exact | State field exists but is never read by computed or guard |
| `cyclic-dependency` | error | exact | Computed dependency graph contains a cycle |
| `guard-unsatisfiable` | error | heuristic | Guard expression can never evaluate to true (static estimate) |
| `convergence-risk` | warn | heuristic | Flow may not converge to a terminal state (heuristic, may false-positive) |
| `name-collision` | error | exact | Two schema elements share an ambiguous name |

### B.2 Runtime Findings

| Kind | Severity | Confidence | Description |
|------|----------|------------|-------------|
| `action-blocked` | info | exact | Action is currently unavailable due to guard evaluation |
| `guard-partial-block` | info | exact | Guard has multiple sub-expressions; some pass, some fail |
| `snapshot-drift` | warn | exact | Snapshot data does not match schema field expectations |

### B.3 Trace Findings

| Kind | Severity | Confidence | Description |
|------|----------|------------|-------------|
| `unused-branch` | info | exact | Conditional branch in flow was never taken in this trace |
| `effect-without-patch` | warn | exact | Effect executed but produced no patches |
| `redundant-patch` | info | exact | Patch sets a value identical to the current state |

### B.4 Lineage Findings

| Kind | Severity | Confidence | Description |
|------|----------|------------|-------------|
| `branch-stale` | warn | exact | Branch has not advanced head for a configurable threshold |
| `seal-reuse-detected` | info | exact | World was reused across branches (idempotent seal) |
| `orphan-branch` | warn | exact | Branch exists but is not reachable from active branch |

### B.5 Governance Findings

| Kind | Severity | Confidence | Description |
|------|----------|------------|-------------|
| `proposal-stale` | warn | exact | Proposal has been in ingress stage beyond threshold |
| `gate-locked` | info | exact | Branch gate is locked by an in-progress proposal |
| `actor-unbound` | warn | exact | Actor has no authority binding |

---

*End of `@manifesto-ai/studio-core` Specification v0.2.0 (Draft)*