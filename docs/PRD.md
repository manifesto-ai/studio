# Manifesto Studio PRD v0.2

> **Status:** Draft
> **Date:** 2026-04-01
> **Product:** `@manifesto-ai/studio`
> **Repo Strategy:** 독립 monorepo
> **Related:** Core SPEC, Host SPEC, Lineage SPEC v2.0.0, Governance SPEC v2.0.0, MEL SPEC v0.7.0, ADR-014, ADR-015, ADR-016, ADR-017, ADR-CODEGEN-001

---

## 1. Executive Summary

Manifesto Studio는 Manifesto 도메인의 구조, blocker, 실행 경로를 **사람과 AI 모두가 이해할 수 있게 만드는 분석 제품**이다.

Studio는 새로운 runtime이 아니다. Studio는 `DomainSchema`, `Snapshot`, `TraceGraph`, lineage/governance export를 입력으로 받아서:

* 도메인의 semantic graph를 만들고
* 순환, dead action, missing producer, convergence risk를 찾고
* "왜 이 action이 지금 불가능한가"를 설명하고
* 인간에게는 Dashboard로, AI에게는 MCP와 CLI로 제공한다.

Studio의 position은 다음과 같다:

> Core는 의미를 계산하고, Host는 실행하고, Lineage는 연속성을, Governance는 정당성을 보존한다.
> **Studio는 그것을 이해 가능하게 만든다.**

---

## 2. Problem Statement

### 2.1 현재 실제 문제

Manifesto의 core substrate는 내구성 검증을 통과했다. 실제 실패는 주로 **도메인 설계 레벨**에서 발생한다.

대표 증상:

* 어떤 action이 영원히 열리지 않는다 — guard가 요구하는 state를 아무 곳에서도 생산하지 않는다
* computed/action dependency가 순환한다
* effect → patch → re-entry가 수렴하지 않는다
* lineage/governance semantics는 존재하지만 도메인 작성자는 그 구조를 보지 못한다
* AI agent는 raw MEL이나 DomainSchema만 보고 실제 reachable behavior를 안정적으로 추론하지 못한다

### 2.2 왜 기존 도구로는 부족한가

* **MEL/DomainSchema**: 읽을 수는 있지만 시스템 구조를 보여주지 않는다. 개별 선언은 이해할 수 있어도, 전체 action reachability graph는 보이지 않는다.
* **TraceGraph (Core SPEC §12)**: 풍부하지만 너무 저수준이다. 단일 computation의 why는 설명하지만, 도메인 전체의 structural fitness는 다루지 않는다.
* **SDK / ADR-017 Capability Decorator**: capability access DX를 개선하지만, **도메인 구조 자체의 분석**은 범위 밖이다.
* **Codegen (ADR-CODEGEN-001)**: type drift를 제거하지만, "이 타입이 runtime에서 실제로 도달 가능한가?"는 대답하지 못한다.
* **ADR/SPEC 문서**: architecture를 설명하지만, **특정 도메인이 왜 막혔는지**는 설명하지 않는다.

---

## 3. Product Thesis

Manifesto에는 "실행 레이어" 외에 **"이해 레이어"**가 필요하다.

Studio는 다음 질문에 답한다:

* 지금 이 action은 왜 불가능한가?
* 어떤 field가 읽히지만 아무도 생산하지 않는가?
* 어떤 dependency cycle이 있는가?
* 어떤 flow가 수렴하지 않을 위험이 있는가?
* lineage가 붙은 세계에서 현재 branch/head 상태는 무엇인가?
* governance가 붙은 세계에서 이 action이 direct execution이 아니라 proposal path인 이유는 무엇인가?

---

## 4. Product Goals

### 4.1 Primary Goals

1. 도메인의 숨겨진 구조를 시각화한다
2. blocker를 조기에 탐지한다
3. action unavailability의 이유를 설명한다
4. lineage / governance 구조를 읽을 수 있게 만든다
5. 인간용(Dashboard)과 AI용(MCP, CLI) surface가 같은 분석 엔진을 공유한다

### 4.2 Non-Goals

1. Studio는 새로운 runtime이 아니다 — Core/Host/Lineage/Governance를 대체하지 않는다
2. Studio는 v1에서 domain을 자동 수정하지 않는다
3. Studio는 policy decision을 대신하지 않는다
4. Studio는 일반 BI/analytics 제품이 아니다
5. Studio는 MEL compiler를 재구현하지 않는다

---

## 5. Product Principles

### P1. Read, Don't Rule

Studio는 읽고 설명한다. 실행 의미를 바꾸지 않는다. Core가 compute하는 것, Host가 execute하는 것에 Studio는 개입하지 않는다.

### P2. One Engine, Four Surfaces

분석 로직은 전부 `studio-core`에 있다. Dashboard, MCP, CLI는 같은 graph IR과 finding set을 서로 다른 인터페이스로 제공할 뿐이다.

### P3. DomainSchema First

Studio의 canonical static input은 **DomainSchema** (compiled IR)이다. MEL source 지원은 `mel → compiler → DomainSchema → studio-core` 파이프라인으로 제공한다. Studio가 MEL을 직접 파싱하는 일은 없다.

근거: codegen이 이미 DomainSchema를 canonical input으로 사용하고 있고 (ADR-CODEGEN-001 §2.3), Core SPEC의 모든 type 정보가 `DomainSchema.types`에 정규화되어 있다. MEL은 source language이고 DomainSchema는 compiled IR이다. Studio가 MEL을 직접 파싱하면 compiler와 파싱 로직이 중복되며, MEL 문법 변경 시 Studio도 깨진다.

### P4. Static First, Runtime Second

DomainSchema만으로 알 수 있는 것은 먼저 잡는다. Snapshot/Trace에 의존하는 분석은 그 위에 overlay한다.

### P5. Explainability over Detection

"문제가 있다"가 아니라 "왜, 어디서, 무엇이 부족한가"를 말해야 한다. 모든 finding은 원인 경로를 포함한다.

### P6. Human / AI Parity

Dashboard와 MCP/CLI는 같은 분석 결과를 다른 인터페이스로 제공한다. AI agent가 MCP로 받는 정보와 인간이 Dashboard에서 보는 정보 사이에 정보 비대칭이 없어야 한다.

---

## 6. Target Users

### 6.1 AI Agent (Primary)

Manifesto의 primary customer는 AI agent이다 (캐즘 분석 참조). Agent에게 Studio의 가치는:

* raw DomainSchema 대신 구조화된 도메인 설명을 받는 것
* action availability / blockers / cycles를 machine-readable format으로 받는 것
* "다음에 무엇을 해야 하는가"를 결정하기 위한 structural context를 얻는 것
* MCP tool call 한 번으로 blocker 원인을 파악하는 것

### 6.2 Domain Author

* 구조 시각화
* unreachable action 탐지
* guard blocker 설명
* missing producer 확인
* "이 도메인을 deploy하기 전에 structural issue가 있는가?"

### 6.3 Application Engineer

* runtime issue가 domain 문제인지 infrastructure 문제인지 분리
* lineage/governance가 현재 흐름에 어떤 영향을 주는지 확인
* 특정 intent path의 trace replay

---

## 7. Product Scope

### 7.1 `studio-core` — Analysis Engine

역할: Studio의 심장. 모든 분석 로직이 여기 있다.

* DomainSchema ingest → semantic graph IR 생성
* Static analysis (reachability, cycles, missing producers, guard satisfiability)
* Runtime overlay (Snapshot-based action availability, trace overlay)
* Lineage/governance structure analysis
* Explanation engine (finding + cause chain)

입력:

| Input | Source | Required? | Purpose |
|-------|--------|-----------|---------|
| `DomainSchema` | Compiler output | **Required** | Canonical static analysis source |
| `Snapshot` | Runtime / file | Optional | Runtime overlay, action availability explanation |
| `TraceGraph` | Core compute output (Core SPEC §12) | Optional | Execution path analysis, replay |
| Lineage export | Lineage query result | Optional | Branch/head/tip state |
| Governance export | Governance query result | Optional | Proposal lifecycle state |

출력:

* Graph IR (§9)
* Findings (`error`, `warn`, `info`) with cause chains
* Reachability reports
* Blocker explanation reports
* Runtime overlays

### 7.2 `studio-mcp` — AI Agent Interface

역할: AI agent가 Studio를 tool로 호출하는 MCP server.

MCP를 Phase 1에 포함하는 이유: Manifesto의 primary customer가 AI agent이기 때문이다. Agent에게 Studio의 가치를 전달하는 가장 직접적인 채널이 MCP이다. CLI는 사람 개발자를 위한 것이고, MCP는 agent를 위한 것이다. Agent를 primary customer로 보는 캐즘 분석에서 MCP가 Phase 2로 밀리면 첫 번째 고객에게 도달하는 시간이 늦어진다.

MCP Tool Surface (MVP):

| Tool | Parameters | Returns |
|------|------------|---------|
| `explain_action_blocker` | `action_id`, `snapshot?` | Blocker cause chain (guard conditions, missing producers, upstream dependencies) |
| `get_domain_graph` | `format?: "summary" \| "full"` | Domain structure graph (nodes, edges, condensed or full) |
| `find_issues` | `severity?: "error" \| "warn" \| "info"` | Static analysis findings with cause chains |
| `get_action_availability` | `snapshot` | All actions with availability status and blocker reasons |
| `trace_intent` | `trace_graph`, `intent_id?` | Execution path analysis for a specific intent |
| `get_lineage_state` | — | Branch/head/tip state, recent seal history |
| `get_governance_state` | — | Active proposals, pending approvals, governance path explanation |

MCP Resource Surface (MVP):

| Resource | Description |
|----------|-------------|
| `studio://domain/graph` | Current domain graph IR |
| `studio://domain/findings` | Current findings list |
| `studio://domain/schema` | DomainSchema summary (types, actions, computed, state) |

설계 제약:

* MCP server는 `studio-core`의 분석 결과만 relay한다. 자체 분석 로직을 갖지 않는다.
* Tool 응답은 structured JSON이다. 자연어 설명은 포함하되, machine-parseable structure가 primary이다.
* MCP server는 stateful할 수 있다 — DomainSchema를 load한 후 여러 tool call에 걸쳐 동일 분석 컨텍스트를 유지한다.

### 7.3 `studio-cli` — Developer Interface

역할: headless analysis, CI integration, human debugging.

핵심 명령:

```bash
# Static analysis
manifesto studio analyze schema.json
manifesto studio analyze --mel domain.mel  # mel → compile → analyze

# Action explanation
manifesto studio explain --action submit --snapshot snapshot.json

# Trace analysis
manifesto studio trace trace.json

# Graph export
manifesto studio graph schema.json --format json|dot|summary

# Findings
manifesto studio check schema.json --severity error,warn
```

출력 모드: `text` (human-readable), `json` (machine-readable, CI-friendly)

### 7.4 `studio-dashboard` — Visual Interface

역할: 도메인 그래프 렌더링, interactive exploration, lineage/governance browsing.

Primary Screens:

1. **Domain Graph View** — graph canvas, node/edge filter, highlighted execution path
2. **Blockers Panel** — ranked findings, 원인 설명, upstream missing producer chain
3. **Action Inspector** — availability status, guard breakdown, dependency chain
4. **Runtime Replay View** — intent timeline, compute/effect/patch progression
5. **Lineage/Governance View** — branch/head/tip browser, proposal list and state

Dashboard는 Phase 2이다. Phase 1에서 `studio-core`의 graph IR이 안정화된 후에 추가한다.

---

## 8. Architecture

### 8.1 Packages

```
@manifesto-ai/studio
  /packages
    /studio-core        ← Analysis engine (graph IR, findings, explanation)
    /studio-mcp         ← MCP server (AI agent interface)
    /studio-cli         ← CLI (human developer interface)
    /studio-dashboard   ← Web dashboard (Phase 2)
```

### 8.2 Data Flow

```
DomainSchema / Snapshot / TraceGraph / Lineage Export / Governance Export
                           ↓
                      studio-core
               ┌──────────┼──────────┐
               ↓           ↓          ↓
          studio-mcp   studio-cli   studio-dashboard
          (AI agent)   (human dev)  (visual, Phase 2)
```

### 8.3 Position in the Manifesto Ecosystem

Studio는 **외부 해석 계층**이다.

읽는 것:

* `DomainSchema` (Core SPEC §4) — canonical static input
* `Snapshot` (Core SPEC §13) — runtime state
* `TraceGraph` (Core SPEC §12) — computation trace
* Lineage query results (Lineage SPEC v2.0.0 — branch, head, tip, SealAttempt)
* Governance query results (Governance SPEC v2.0.0 — proposals, decisions, actors)

하지 않는 것:

* Core compute 호출 또는 교체
* Host effect execution
* Lineage seal / head advance
* Governance proposal judgment
* Snapshot mutation

### 8.4 Dependency Policy

Studio는 v1에서 Manifesto runtime 패키지의 private internals를 import하지 않는다. `DomainSchema`의 타입 정의는 `@manifesto-ai/core`를 **peerDependency**로 참조하여 가져온다 (ADR-CODEGEN-001 §2.6 동기화 전략과 동일한 패턴).

Studio가 읽는 모든 데이터는 public contract 또는 exportable artifact를 통해 전달된다.

---

## 9. Semantic Graph IR

`studio-core`의 내부 공통 IR이다. 모든 analysis와 explanation은 이 IR 위에서 동작한다.

### 9.1 Node Kinds

ADR-014에 의해 World는 Lineage(Continuity Engine)와 Governance(Legitimacy Engine)로 분리되었다. Studio IR은 이 분리를 반영한다.

| Node Kind | Source | Description |
|-----------|--------|-------------|
| `state` | DomainSchema.state | Domain state field |
| `computed` | DomainSchema.computed | Computed value (DAG node) |
| `action` | DomainSchema.actions | Intent-to-flow mapping |
| `guard` | ActionSpec.available | Action availability condition |
| `effect` | FlowSpec (kind: effect) | Requirement declaration |
| `patch-target` | FlowSpec (kind: patch) | State mutation target |
| `lineage-branch` | Lineage export | Branch in the lineage DAG |
| `lineage-head` | Lineage export | Current head world of a branch |
| `lineage-tip` | Lineage export | Current tip (head + failed) of a branch |
| `governance-proposal` | Governance export | Proposal in lifecycle |
| `governance-actor` | Governance export | Actor bound to authority |

### 9.2 Edge Kinds

| Edge Kind | From → To | Description |
|-----------|-----------|-------------|
| `reads` | computed/guard/effect → state/computed | 값을 읽는다 |
| `writes` | patch-target → state | 값을 쓴다 |
| `depends-on` | computed → computed | DAG 의존성 |
| `enables` | guard → action | guard 충족 시 action 활성화 |
| `blocks` | guard → action | guard 미충족 시 action 차단 |
| `produces` | action (via patch) → state | action이 state를 생산한다 |
| `seals-into` | action execution → lineage-head | 실행 결과가 lineage에 seal된다 |
| `proposes` | action → governance-proposal | governed world에서 action이 proposal을 생성한다 |
| `approves` | governance-actor → governance-proposal | actor가 proposal을 승인한다 |
| `branches-from` | lineage-branch → lineage-head | branch가 특정 head에서 분기했다 |

### 9.3 Finding Kinds

| Finding Kind | Severity | Source | Description |
|--------------|----------|--------|-------------|
| `unreachable-action` | error | Static | guard 조건이 구조적으로 충족 불가능한 action |
| `missing-producer` | error | Static | 읽히지만 어떤 action에서도 생산되지 않는 state field |
| `dead-state` | warn | Static | 어디서도 읽히지 않는 state field |
| `guard-blocker` | info | Runtime | 현재 snapshot에서 특정 guard가 미충족인 이유 |
| `cyclic-dependency` | error | Static | computed → computed 순환 |
| `non-converging-flow-risk` | warn | Static (heuristic) | patch가 자기 자신의 guard 조건을 재충족시킬 수 있는 구조 |
| `lineage-head-divergence-risk` | warn | Runtime | 여러 branch head가 동일 snapshot을 가리키는 경우 |
| `governance-bypass-risk` | info | Static | governed world에서 direct execution path가 type-level에서 차단되지 않는 구조 (v1 informational) |

#### `non-converging-flow-risk`에 대한 한계 명시

Flow는 non-Turing-complete이므로 개별 Flow의 종료는 보장된다 (Core SPEC FDR-006). 그러나 Host가 `compute()`를 반복 호출하는 패턴에서의 **수렴성**은 Host-level 관심사이며, static analysis만으로는 정확히 판별할 수 없다.

Studio가 할 수 있는 것은 다음 heuristic이다:
* "이 action의 patch가 자기 자신의 guard/available 조건에 영향을 주는 state를 변경하는가?"
* "effect fulfillment 후 re-entry 시 동일 action이 다시 available해지는 구조적 가능성이 있는가?"

이 heuristic은 false positive를 생산할 수 있다. Finding 출력 시 **static heuristic이며 runtime behavior에 따라 실제 문제가 아닐 수 있음**을 명시한다. 이를 명시하지 않으면 false positive 누적으로 finding 전체의 신뢰도가 훼손된다.

---

## 10. Functional Requirements

### 10.1 Static Analysis (DomainSchema only)

| ID | Requirement |
|----|-------------|
| SA-1 | state/computed/action dependency graph를 생성해야 한다 |
| SA-2 | 읽히지만 생산되지 않는 state field를 탐지해야 한다 (`missing-producer`) |
| SA-3 | 구조적으로 unreachable한 action을 탐지해야 한다 (`unreachable-action`) |
| SA-4 | computed → computed dependency cycle을 탐지해야 한다 (`cyclic-dependency`) |
| SA-5 | guard 조건이 리터럴 `false`로 평가되거나 충족 불가능한 action을 탐지해야 한다 |
| SA-6 | patch → guard self-feedback 구조를 heuristic으로 경고해야 한다 (`non-converging-flow-risk`, 한계 명시) |
| SA-7 | 어디서도 읽히지 않는 state field를 경고해야 한다 (`dead-state`) |
| SA-8 | MEL scope resolution order (SPEC §6.1)를 기반으로 name collision risk를 보고해야 한다 |

### 10.2 Runtime Analysis (DomainSchema + Snapshot)

| ID | Requirement |
|----|-------------|
| RA-1 | 특정 snapshot 기준으로 모든 action의 availability status를 계산해야 한다 |
| RA-2 | 특정 action이 unavailable한 이유를 guard 단위로 설명해야 한다 (`guard-blocker`) |
| RA-3 | guard가 요구하는 state의 현재 값과 필요한 값을 비교하여 보여줘야 한다 |

### 10.3 Trace Analysis (DomainSchema + TraceGraph)

| ID | Requirement |
|----|-------------|
| TA-1 | `TraceGraph` (Core SPEC §12)를 graph IR에 overlay해야 한다 |
| TA-2 | 선택된 intent의 실행 경로 (compute → patch → effect 순서)를 보여줘야 한다 |
| TA-3 | trace node 단위로 input/output을 표시해야 한다 |
| TA-4 | minimal replay-style stepping을 제공해야 한다 |

### 10.4 Lineage Analysis (Lineage Export)

| ID | Requirement |
|----|-------------|
| LA-1 | branch/head/tip 상태를 보여줘야 한다 (Lineage SPEC v2.0.0 §10) |
| LA-2 | SealAttempt 이력을 보여줘야 한다 (ADR-016 §2.4) |
| LA-3 | parentWorldId 기반 DAG 구조를 시각화해야 한다 (ADR-016 §2.1) |
| LA-4 | head vs tip 차이 (completed vs failed seal)를 설명해야 한다 |

### 10.5 Governance Analysis (Governance Export)

| ID | Requirement |
|----|-------------|
| GA-1 | active proposals와 their lifecycle stage를 보여줘야 한다 |
| GA-2 | "이 action이 direct execution이 아니라 proposal path인 이유"를 설명해야 한다 (ADR-017 DECO-3 참조) |
| GA-3 | actor/authority binding 구조를 보여줘야 한다 |
| GA-4 | single-writer gate 상태 (어떤 branch에서 execution-stage proposal이 진행 중인지)를 보여줘야 한다 |

---

## 11. Input Contract

### 11.1 Canonical Input: DomainSchema

`DomainSchema` (Core SPEC §4)가 Studio의 canonical static input이다.

Studio는 `DomainSchema`에서 다음을 읽는다:

* `types` (TypeSpec) — named type declarations
* `state` (StateSpec) — state structure
* `computed` (ComputedSpec) — computed DAG
* `actions` (ActionSpec) — intent-to-flow mappings, including `available` guards
* `hash` — schema integrity verification

### 11.2 MEL Convenience Path

MEL source를 직접 받는 경우, Studio는 `@manifesto-ai/compiler` (compiler)를 호출하여 `DomainSchema`로 변환한 후 분석한다. Studio 내부에 MEL parser를 두지 않는다.

```
user provides .mel file
  → studio-cli calls compileMelDomain()
    → DomainSchema
      → studio-core analyzes DomainSchema
```

### 11.3 Trace Format

Core SPEC §12의 `TraceGraph` / `TraceNode`를 그대로 사용한다. 별도 trace format을 정의하지 않는다.

Host-level telemetry (ADR-006 CHAN-1에서 분리된 process observation 이벤트)는 v1에서 scope 밖이다. Host telemetry format이 구체화되면 후속 version에서 추가한다.

### 11.4 Lineage / Governance Export Format

v1에서는 JSON export를 정의한다. 정확한 schema는 `studio-core` IR 설계 단계에서 확정하되, 최소 포함 항목은:

**Lineage export:**
* branches: `BranchId[]` with head, tip, epoch, headAdvancedAt
* recent worlds: `World[]` with worldId, parentWorldId, snapshotHash, terminalStatus
* recent seal attempts: `SealAttempt[]`

**Governance export:**
* proposals: `Proposal[]` with stage, branchId, actorRef, timestamps
* actors/authorities: binding structure
* gate status: per-branch single-writer gate occupancy

---

## 12. MCP Server Design

### 12.1 Why MCP is Phase 1

Manifesto의 primary customer가 AI agent라는 것이 MCP를 첫 번째 외부 surface로 올리는 이유다.

Agent가 Manifesto world를 운영할 때, "이 action이 왜 막혔지?"는 가장 빈번한 질문이다. 현재 이 질문에 답하려면 agent가 DomainSchema를 통째로 context에 넣고, guard 조건을 수동으로 역추적해야 한다. MCP tool 하나로 이 작업을 대체할 수 있다면, agent의 context window 효율성과 의사결정 속도가 극적으로 개선된다.

### 12.2 Tool Design Principles

* **Atomic answers**: 각 tool은 하나의 명확한 질문에 답한다. "도메인 전체 분석 결과를 줘"가 아니라 "이 action의 blocker를 설명해줘".
* **Structured first**: 응답은 JSON structure가 primary이다. 자연어 `explanation` 필드는 보조.
* **Lazy loading**: DomainSchema를 한 번 load하면 여러 tool call에 걸쳐 재사용한다.
* **Graceful degradation**: Snapshot이 없으면 static analysis만 반환한다. Lineage/governance export가 없으면 해당 finding을 생략한다.

### 12.3 Tool Definitions (MVP)

```typescript
// Tool 1: Action blocker explanation
{
  name: "explain_action_blocker",
  description: "Explains why a specific action is currently unavailable",
  inputSchema: {
    action_id: string,       // required
    snapshot?: Snapshot,      // optional — if absent, static-only analysis
  },
  returns: {
    action_id: string,
    status: "available" | "blocked" | "unreachable",
    static_issues: Finding[],       // structural problems
    runtime_blockers?: GuardBreakdown[],  // snapshot-based guard failures
    upstream_chain: string[],       // dependency path to root cause
    explanation: string,            // natural language summary
  }
}

// Tool 2: Domain structure graph
{
  name: "get_domain_graph",
  description: "Returns the domain's semantic structure graph",
  inputSchema: {
    format?: "summary" | "full",  // default: summary
  },
  returns: {
    nodes: GraphNode[],
    edges: GraphEdge[],
    stats: { actions: number, states: number, computed: number, cycles: number }
  }
}

// Tool 3: Static analysis findings
{
  name: "find_issues",
  description: "Runs static analysis and returns all findings",
  inputSchema: {
    severity?: ("error" | "warn" | "info")[],  // default: all
  },
  returns: {
    findings: Finding[],
    summary: { errors: number, warnings: number, info: number }
  }
}

// Tool 4: Action availability map
{
  name: "get_action_availability",
  description: "Returns availability status for all actions given a snapshot",
  inputSchema: {
    snapshot: Snapshot,  // required
  },
  returns: {
    actions: {
      [actionId: string]: {
        available: boolean,
        blockers?: GuardBreakdown[],
      }
    }
  }
}

// Tool 5: Trace analysis
{
  name: "analyze_trace",
  description: "Analyzes an execution trace for a specific intent",
  inputSchema: {
    trace_graph: TraceGraph,
  },
  returns: {
    intent: { type: string, input: unknown },
    execution_path: TraceStep[],
    patches_applied: PatchSummary[],
    effects_declared: EffectSummary[],
    terminated_by: string,
    duration: number,
  }
}

// Tool 6: Lineage state
{
  name: "get_lineage_state",
  description: "Returns current lineage branch/head/tip state",
  inputSchema: {},
  returns: {
    branches: BranchSummary[],
    active_branch: BranchId,
    recent_seals: SealAttemptSummary[],
    dag_depth: number,
  }
}

// Tool 7: Governance state
{
  name: "get_governance_state",
  description: "Returns current governance state — proposals, actors, gates",
  inputSchema: {},
  returns: {
    active_proposals: ProposalSummary[],
    gate_status: { [branchId: string]: "free" | "occupied" },
    actors: ActorSummary[],
    execution_path_explanation: string,
  }
}
```

### 12.4 MCP Server Lifecycle

1. **Init**: DomainSchema load → graph IR 생성 → static analysis 실행
2. **Ready**: tool call 수신 가능. Snapshot/Trace/Export는 tool call 시 전달받거나 이전에 load된 것 재사용.
3. **Update**: DomainSchema 변경 시 graph IR 재생성. Snapshot 변경 시 runtime overlay만 재계산.

---

## 13. CLI UX

### 13.1 Output Modes

* `--format text` — human-readable (default)
* `--format json` — machine-readable, CI-friendly

### 13.2 Example Output

```text
$ manifesto studio analyze schema.json

ERROR  unreachable-action: action.submit
  → guard requires state.userId (non-null)
  → state.userId has no producer in any action
  → suggestion: add a patch to state.userId in action.login

ERROR  cyclic-dependency: computed.ready ↔ computed.canSubmit
  → computed.ready reads computed.canSubmit
  → computed.canSubmit reads computed.ready

WARN   non-converging-flow-risk: action.retry (static heuristic)
  → action.retry patches state.attemptCount
  → state.attemptCount is read by guard of action.retry
  → NOTE: this is a structural heuristic; runtime behavior may differ

INFO   dead-state: state.legacyFlag
  → not read by any computed, guard, or action

Summary: 2 errors, 1 warning, 1 info
```

```text
$ manifesto studio explain --action submit --snapshot snapshot.json

action.submit is BLOCKED

Guard breakdown:
  ✗ state.userId != null          → current value: null
  ✓ computed.formValid == true    → current value: true
  ✓ state.agreed == true          → current value: true

Missing producer for state.userId:
  No action in this domain produces state.userId via patch.
  This is a structural issue, not a runtime issue.
```

### 13.3 CI Integration

```bash
# CI pipeline: fail on structural errors
manifesto studio check schema.json --severity error --format json
# Exit code 1 if errors found, 0 otherwise
```

---

## 14. Dashboard UX (Phase 2)

### 14.1 Visual Rules

| Color | Meaning |
|-------|---------|
| Red | blocked / broken / structural error |
| Yellow | risk / waiting / partial / heuristic warning |
| Green | reachable / satisfied / available |
| Dashed edge | static inference |
| Solid edge | runtime observed (trace overlay) |

### 14.2 Interaction Model

Dashboard는 `studio-core`에 분석을 요청하고 결과를 렌더링한다. Dashboard 자체에 분석 로직을 두지 않는다. "One engine, four surfaces" 원칙.

---

## 15. Integration Strategy

### 15.1 v1 Integration

v1은 file/API 기반으로 단순화한다. Studio가 Manifesto runtime에 embeded되지 않는다.

```
Developer writes .mel
  → Compiler produces DomainSchema.json
    → Studio analyzes DomainSchema.json
      → CLI outputs findings / MCP serves tools

Runtime produces Snapshot, TraceGraph
  → Exported as JSON files
    → Studio overlays runtime data on static graph
```

### 15.2 v2 Integration (Future)

SDK의 `withStudio()` capability decorator (ADR-017 패턴)로 runtime에서 직접 Studio analysis를 연결하는 것은 v2 이후 검토 대상이다. 이 결정은 v1의 `studio-core` IR이 안정화된 후에 한다. "separate by evidence, not by speculation."

---

## 16. Success Metrics

### 16.1 Product Metrics

| Metric | Target |
|--------|--------|
| Blocker 원인 파악 시간 | 50% 감소 (MCP tool call 1회 vs. manual DomainSchema 역추적) |
| 알려진 blocker class 탐지율 | 80% 이상 |
| MCP tool 응답이 agent workflow에서 별도 파서 없이 usable | Yes |
| CLI가 CI pipeline에서 zero-config으로 사용 가능 | Yes |

### 16.2 Adoption Metrics

| Metric | Target |
|--------|--------|
| Coin Sapiens domain end-to-end 분석 완료 | Phase 1 종료 전 |
| Agent debugging workflow 1개 이상 MCP로 이전 | Phase 1 종료 전 |
| Human debugging workflow 1개 이상 CLI로 이전 | Phase 1 종료 전 |
| 내부 3개 이상 domain에서 Studio 사용 | Phase 2 종료 전 |

---

## 17. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **IR explosion** | graph model이 너무 커지고 유지보수가 어려워짐 | Node/edge kind를 MVP에서 최소화. 확장은 evidence-driven |
| **Adapter drift** | runtime telemetry/export shape 변화와 Studio integration 어긋남 | Public contract + exportable artifact만 의존. Private internals import 금지 |
| **Overreach** | Studio가 runtime/auto-fix engine이 되려는 유혹 | "Read, don't rule" 원칙. PR review에서 mutation code 차단 |
| **False positive fatigue** | heuristic finding이 너무 많아 신뢰 상실 | Finding에 confidence level 표시. Heuristic은 반드시 한계 명시 |
| **MCP tool surface creep** | Tool이 너무 많아져 agent가 선택하기 어려움 | MVP 7개 tool 상한. 추가는 agent 사용 데이터 기반으로 |
| **Compiler coupling** | MEL convenience path가 compiler version에 강하게 의존 | DomainSchema가 canonical. MEL path는 편의 기능. Compiler는 peerDependency |

---

## 18. MVP Phasing

### Phase 1: `studio-core` + `studio-mcp` + `studio-cli`

**목표:** AI agent와 human developer 모두에게 즉시 가치를 전달한다.

**순서:**

1. `studio-core` — graph IR 설계 → static analysis → explanation engine
2. `studio-mcp` — core 위에 MCP tool surface 구현
3. `studio-cli` — core 위에 CLI command 구현

**Phase 1 완료 조건:**

* Coin Sapiens DomainSchema에 대해 full static analysis 통과
* `explain_action_blocker` MCP tool이 Coin Sapiens agent에서 사용 가능
* `manifesto studio check` CLI가 CI에서 실행 가능
* Runtime overlay (Snapshot 기반 action availability) 동작

### Phase 2: `studio-dashboard`

**전제 조건:**

* Phase 1에서 graph IR 안정화
* Blocker finding 신뢰도 확보 (false positive rate < 20%)
* Runtime overlay 안정

**목표:** graph IR을 시각적으로 탐색 가능하게 한다.

### Phase 3 (Future): Runtime Integration

**전제 조건:**

* Phase 2 완료
* ADR-017 capability decorator 패턴이 production에서 검증됨

**목표:** `withStudio()` capability decorator를 통한 runtime 내 실시간 분석 연결.

---

## 19. Resolved Questions (from PRD v0.1)

| Question (v0.1) | Resolution |
|-----------------|------------|
| MEL 직접 ingest vs DomainSchema canonical | **DomainSchema가 canonical.** MEL은 compiler를 거치는 convenience path. (§5 P3, §11) |
| Trace export format | **Core SPEC §12의 TraceGraph를 그대로 사용.** Host telemetry는 v1 scope 밖. (§11.3) |
| Lineage/governance view를 MVP에 포함할지 | **MCP/CLI에서는 Phase 1 포함.** Dashboard는 Phase 2. (§7, §18) |
| Studio Analysis JSON schema 초기 고정 여부 | **Phase 1에서 graph IR + finding schema를 확정한다.** MCP tool의 응답 schema가 이것이다. (§12.3) |
| MCP surface | **Phase 1에 포함. 4번째 surface로 정식 편입.** (§7.2, §12) |

---

## 20. Open Questions (Remaining)

| Question | Decision Point |
|----------|---------------|
| Lineage/governance export JSON schema를 Studio 쪽에서 정의할지, 각 패키지에서 export utility를 제공할지 | studio-core IR 설계 시 |
| MCP server의 DomainSchema load 방식 (file path vs. inline JSON vs. compile-on-demand) | studio-mcp 구현 시 |
| Dashboard의 graph rendering library 선택 (d3, cytoscape, react-flow 등) | Phase 2 시작 시 |
| `withStudio()` capability decorator의 구체적 API surface | Phase 3 검토 시 (evidence-driven) |

---

## 21. Summary

Manifesto Studio는 **독립 분석 제품**이다.

v1의 첫 목표는 "예쁜 시각화"가 아니다.
첫 목표는:

> **도메인 구조, blocker, lineage/governance 상태를 AI agent와 인간 모두가 읽을 수 있게 만드는 것**

이다.

Phase 1의 deliverable은 세 개다:
* `studio-core` — 분석 엔진
* `studio-mcp` — AI agent가 도메인을 이해하는 채널
* `studio-cli` — 인간 개발자가 도메인을 검증하는 도구

Dashboard는 Phase 2에서 온다. 그때까지 graph IR이 단단해져 있어야 한다.

---

*End of Manifesto Studio PRD v0.2*