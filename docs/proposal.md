# Studio Editor — Project Proposal

> **Status:** ✅ **Immutable — Phase 0 complete (2026-04-17)**
> **Date:** 2026-04-17
> **Scope:** New sub-project under `@manifesto-ai/*`
> **Related:** ADR-022 (SourceMapIndex), ADR-021 (AnnotationIndex), Compiler SPEC v1.1.0, `docs/phase-0-review.md`, `docs/phase-1-proposal.md`
> **Deciders:** 성우님
> **Author:** Claude (초안), 리뷰 요청 대상: GPT (교차 검증)
>
> **Immutability note:** this document is frozen as-of Phase 0 exit. Phase 1+ changes go into `phase-1-proposal.md` and subsequent phase docs. Amendments here require explicit re-ratification.

---

## 0. TL;DR

Studio Editor는 **MEL 도메인을 편집하고, 빌드하고, 실행하고, 관찰하는 작업대**이며, 궁극적으로는 **AI 에이전트가 스스로 자기 MEL을 편집하는 걸 인간이 감독하는 공간**을 목표로 한다.

Phase 0에서는 **두 개의 패키지만** 만든다. UI는 만들지 않는다.

- `@manifesto-ai/studio-core` — 위젯 독립적 편집 코어 (build pipeline, reconciler, runtime bridge, edit history)
- `@manifesto-ai/studio-adapter-headless` — 최소 어댑터 구현 (에이전트 입구이자 테스트 하네스)

이 두 패키지만으로 "source를 입력하고 → 빌드 → dispatch → snapshot 관찰 → 재편집 시 의미론적 재활용"의 전체 루프가 결정론적으로 작동해야 한다.

---

## 1. Context

### 1.1 왜 지금인가

Compiler SPEC v1.1.0이 `SourceMapIndex`를 포함하며 landed되었다. 이로써 에디터가 필요한 재료가 갖춰졌다:

- `DomainSchema` — 런타임 계약
- `SchemaGraph` — 선언 간 의존성 (feeds/mutates/unlocks)
- `AnnotationIndex` — 사용자 의도 힌트 (`@meta`)
- `SourceMapIndex` — 선언 ↔ 소스 위치 매핑 (declaration-level, total)

이 넷이 **`LocalTargetKey`라는 공통 키 공간**에서 만난다. 즉 어떤 선언에 대해 "위치 + 의미 + 의존성 + 사용자 힌트"를 한꺼번에 조회할 수 있는 인프라가 처음으로 갖춰졌다.

### 1.2 두 단계의 목표 사용자

| 단계 | 주 사용자 | 가치 제안 |
|------|----------|----------|
| 현재 (Phase 0~1) | Manifesto 개발자 (성우님 본인 포함) | 결정론적 편집-빌드-실행-관찰 루프 |
| 최종 (Phase 3) | AI 에이전트 + 인간 감독자 | 에이전트가 MEL을 자기 수정하고, 인간이 plan을 검토 |

**중요:** Phase 0의 모든 설계 결정은 **"Phase 3에서 에이전트가 자연스럽게 붙을 수 있는가"**를 제1 기준으로 한다. Phase 1의 쓸 만한 UI를 만들기 위해 Phase 3 경로를 오염시키는 선택은 거부한다.

### 1.3 기존 IDE와의 차별점

Studio Editor는 VS Code의 대체재가 아니다. 정확히는 **다른 축**의 도구이다:

| VS Code | Studio Editor |
|---------|--------------|
| 키스트로크 단위 피드백 | Save/Build 단위 피드백 |
| 텍스트 diff 중심 | 의미론적 구조 diff 중심 |
| 파일 시스템 중심 | 도메인 버전 중심 |
| 인간 편집자 우선 | 인간+에이전트 대칭 편집 |
| 런타임 분리 | 런타임 내장 (REPL) |

MEL LSP는 별도로 존재하며, 문법 검증/autocomplete/hover는 LSP가 담당한다. Studio Editor는 **LSP가 건드리지 않는 층**에서 작동한다.

---

## 2. Goals

### 2.1 Primary Goals (Phase 0 — MUST)

- **G1.** `.mel` 소스 문자열을 입력받아 `DomainModule`로 빌드하는 파이프라인 제공
- **G2.** 빌드된 도메인에 대해 runtime (snapshot, dispatch, trace) 관찰 및 조작 API 제공
- **G3.** 재빌드 시 **의미론적 구조의 재활용** — `LocalTargetKey` identity 기반 snapshot/trace preservation
- **G4.** 모든 편집을 `EditIntent`로 Lineage에 기록 (Phase 3 준비)
- **G5.** 위젯 독립적 어댑터 인터페이스 정의 및 Headless 구현

### 2.2 Secondary Goals (Phase 0 — SHOULD)

- **G6.** CLI 디버그 도구로 plan 출력 가능 (reconciliation의 "맛" 확인용, 진짜 UI 아님)
- **G7.** 결정론적 테스트 가능 — 동일 입력 시퀀스는 동일 state/plan/lineage를 생산

### 2.3 Explicit Non-Goals (Phase 0)

- 어떤 형태든 UI 위젯 (Monaco/CodeMirror 포함)
- React/Vue/Svelte 컴포넌트
- 멀티 파일 프로젝트 — 단일 `.mel` 소스로 한정 (ADR-022가 reserve)
- Sub-declaration 수준의 reconciliation (선언 내부의 body 수준)
- 자동 rename 감지 휴리스틱
- 에이전트 실제 연동 (인터페이스만 준비, 호출 경로 없음)
- Multi-version merge (한 번에 하나의 "current module")

**Non-goal의 역할:** 범위 폭증 방지. 누군가 "이것도 하자"고 제안할 때, 이 목록에 있으면 자동 거부. 목록에 없으면 논의.

---

## 3. Decision — Phase 0 Architecture

### 3.1 Package Layout

```
packages/
├── studio-core/              (@manifesto-ai/studio-core)
│   ├── src/
│   │   ├── build-pipeline.ts
│   │   ├── reconciler.ts
│   │   ├── runtime-bridge.ts
│   │   ├── edit-history.ts
│   │   ├── adapter-interface.ts
│   │   └── index.ts
│   └── package.json
│
└── studio-adapter-headless/  (@manifesto-ai/studio-adapter-headless)
    ├── src/
    │   ├── headless-adapter.ts
    │   └── index.ts
    └── package.json
```

**이외의 패키지는 Phase 0에서 생성하지 않는다.** 이 제약은 `pnpm workspaces` 설정 단계에서부터 강제한다.

### 3.2 Dependency Graph

```
studio-adapter-headless
        │
        ▼
    studio-core
        │
        ├─→ @manifesto-ai/compiler  (compileMelModule, SourceMapIndex 등)
        ├─→ @manifesto-ai/sdk       (createManifesto, dispatch, snapshot)
        └─→ @manifesto-ai/lineage   (EditIntent 기록)
```

`studio-core`는 `@manifesto-ai/governance`에 **의존하지 않는다.** Governance는 Phase 3의 "review gate" 활성화 시점에 추가한다.

### 3.3 Public Entry Points

`@manifesto-ai/studio-core`:

```typescript
export function createStudioCore(options?: StudioCoreOptions): StudioCore;

export type StudioCore = {
  // Adapter attachment
  readonly attach: (adapter: EditorAdapter) => Detach;

  // Explicit build trigger (see §5.1 for why explicit)
  readonly build: () => Promise<BuildResult>;

  // Runtime bridge
  readonly getSnapshot: () => Snapshot<unknown> | null;        // null before first successful build
  readonly createIntent: (action: string, ...args: unknown[]) => Intent;
  readonly dispatchAsync: (intent: Intent) => Promise<StudioDispatchResult>;
  readonly simulate: (intent: Intent) => StudioSimulateResult;
  readonly getTraceHistory: () => readonly TraceRecord[];

  // Reconciliation inspection
  readonly getLastReconciliationPlan: () => ReconciliationPlan | null;

  // Current module inspection
  readonly getModule: () => DomainModule | null;
  readonly getDiagnostics: () => readonly Marker[];

  // Week 2 (not yet exposed): subscribe, getCanonicalSnapshot
  // Week 3 (not yet exposed): getEditHistory (Lineage-backed EditIntentRecord[])
};
```

**Normative notes on §3.3 surface (locked in Week 1 scaffold):**

- Write verb matches SDK convention: `dispatchAsync` (not `dispatch`). Studio internally uses `dispatchAsyncWithReport` and returns a `StudioDispatchResult` — the SDK `DispatchReport` extended with `readonly traceIds: readonly TraceId[]` so agents receive full rejection/failure information (`beforeSnapshot`, `blockers`, `rejection.code`) without reconstruction.
- `createIntent(action, ...args)` is exposed because agents and headless tests need it to produce `Intent` values; returning to the runtime's `createIntent(MEL.actions[name], ...args)` internally.
- `simulate(intent)` keeps intent as the input unit (unlike SDK's `simulate(ref, ...args)`) and decorates the SDK `SimulateResult<T>` with `meta: { schemaHash }`.
- Diagnostics are surfaced as `Marker[]` (the adapter contract type), not raw compiler `Diagnostic`, so widget adapters render without format negotiation.
- `subscribe` and `getCanonicalSnapshot` are deliberately deferred to Week 2 — runtime swap re-connection for subscribe, and `$host`/`$mel`/`$system` handling for canonical are reconciliation work.

`@manifesto-ai/studio-adapter-headless`:

```typescript
export function createHeadlessAdapter(options?: HeadlessOptions): HeadlessAdapter;

export type HeadlessAdapter = EditorAdapter & {
  // Headless-only conveniences
  readonly getPendingSource: () => string;          // staged, not yet built
  readonly getMarkersEmitted: () => readonly Marker[];  // for test assertions
};
```

### 3.4 Core Types

```typescript
// Adapter minimal contract
export type EditorAdapter = {
  // Document
  getSource(): string;
  setSource(source: string): void;
  
  // Explicit build signal
  onBuildRequest(listener: () => void): Unsubscribe;
  requestBuild(): void;                 // adapter triggers; core listens
  
  // Diagnostics (result sink)
  setMarkers(markers: readonly Marker[]): void;
};

export type Marker = {
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly span: SourceSpan;            // from compiler's SourceMapIndex contract
  readonly code?: string;
};

// Reconciliation plan — the central data structure
export type ReconciliationPlan = {
  readonly prevSchemaHash: string | null;    // null on first build
  readonly nextSchemaHash: string;
  readonly identityMap: ReadonlyMap<LocalTargetKey, IdentityFate>;
  readonly snapshotPlan: SnapshotReconciliation;
  readonly traceTag: TraceTagging;
};

export type IdentityFate =
  | { kind: "preserved" }
  | { kind: "initialized"; reason: "new" | "type_changed" }
  | { kind: "discarded"; reason: "removed" | "type_incompatible" }
  | { kind: "renamed"; from: LocalTargetKey };       // explicit intent only

export type SnapshotReconciliation = {
  readonly preserved: readonly LocalTargetKey[];
  readonly initialized: readonly LocalTargetKey[];
  readonly discarded: readonly LocalTargetKey[];
  readonly warned: readonly TypeCompatWarning[];
};

export type TraceTagging = {
  readonly stillValid: readonly TraceId[];
  readonly obsolete: readonly TraceId[];
  readonly renamed: readonly TraceRename[];
};

// Edit intent — unit of history
export type EditIntent =
  | { kind: "rebuild"; source: string }
  | { kind: "rename_decl"; from: LocalTargetKey; to: string }
  // Future (Phase 3): structured intents for agents
  // | { kind: "add_action"; spec: ActionSpec }
  // | { kind: "change_guard"; target: LocalTargetKey; newExpr: Expr }
  ;

export type EditIntentRecord = {
  readonly id: string;
  readonly timestamp: number;
  readonly intent: EditIntent;
  readonly prevSchemaHash: string | null;
  readonly nextSchemaHash: string;
  readonly plan: ReconciliationPlan;
  readonly author: "human" | "agent";      // Phase 0는 "human"만
};
```

---

## 4. Normative Rules

### 4.1 Build Pipeline

| Rule ID | Level | Description |
|---------|-------|-------------|
| SE-BUILD-1 | MUST | Build는 명시적 trigger로만 실행된다 (`core.build()` 또는 `adapter.requestBuild()`) |
| SE-BUILD-2 | MUST | `adapter.setSource()`는 소스를 staging area에 넣을 뿐, build를 트리거하지 않는다 |
| SE-BUILD-3 | MUST | Build 실행은 `compileMelModule()` 호출 하나로 완결된다. 중간 상태 처리 없음 |
| SE-BUILD-4 | MUST | Build 실패 시 이전 module이 그대로 유지된다. Runtime은 이전 버전을 계속 사용 |
| SE-BUILD-5 | MUST | Build 성공 시 `ReconciliationPlan`이 생성되고 `EditIntentRecord`에 포함된다 |
| SE-BUILD-6 | MUST NOT | Build는 Host effect를 실행하지 않는다. 순수 compile + reconcile + runtime swap만 |

### 4.2 Reconciliation

| Rule ID | Level | Description |
|---------|-------|-------------|
| SE-RECON-1 | MUST | Identity는 `LocalTargetKey` 문자열 일치로만 판정한다 |
| SE-RECON-2 | MUST | 구조적 유사도 기반 rename 추정은 금지한다 |
| SE-RECON-3 | MUST | 명시적 `rename_decl` intent가 존재할 때만 identity를 이어갈 수 있다 |
| SE-RECON-4 | MUST | Type 변경 시: 동일 타입 → preserve, 호환 확장 → preserve+warn, 축소 → initialize+warn, 비호환 → discard |
| SE-RECON-5 | MUST | ReconciliationPlan은 apply 이전에 생성되며, plan 자체는 순수 계산 산출물이다 |
| SE-RECON-6 | MUST | Snapshot의 `$host`/`$mel`/`$system` namespace는 reconciliation 대상이 아니다 (항상 재초기화) |
| SE-RECON-7 | SHOULD | Schema hash가 동일하면 reconciliation을 skip하고 snapshot을 그대로 이어간다 (no-op optimization) |

**Rationale:** SE-RECON-2는 겉보기에 편리해 보이는 휴리스틱을 거부한다. 90%의 경우 맞더라도 10%의 오판은 **결정론을 깨뜨리는** 버그가 된다. 에이전트가 개입하는 Phase 3에서 이 결정론 파괴는 디버깅 불가능한 상태를 만든다. 명시적 intent만 받는다.

### 4.3 Edit History

| Rule ID | Level | Description |
|---------|-------|-------------|
| SE-HIST-1 | MUST | 모든 성공한 build는 `EditIntentRecord` 하나를 생성한다 |
| SE-HIST-2 | MUST | Edit history는 append-only이다. 과거 기록 수정 금지 |
| SE-HIST-3 | MUST | 각 record는 `ReconciliationPlan`을 포함한다 |
| SE-HIST-4 | MUST | `author` 필드는 "human" 또는 "agent"이다. Phase 0은 항상 "human" |
| SE-HIST-5 | SHOULD | Edit history는 Lineage store에 백업 가능한 형식이어야 한다 |

### 4.4 Adapter Contract

| Rule ID | Level | Description |
|---------|-------|-------------|
| SE-ADP-1 | MUST | Adapter는 source 문자열을 주고받는다. AST/parse tree를 주고받지 않는다 |
| SE-ADP-2 | MUST | Build trigger는 adapter 주도이며, core는 수동적이다 |
| SE-ADP-3 | MUST | Core는 adapter의 렌더링 구현에 의존하지 않는다 |
| SE-ADP-4 | MUST | `setMarkers()`는 diagnostics sink이며, adapter가 표시 방식을 결정한다 |
| SE-ADP-5 | MUST NOT | Adapter 인터페이스에 Monaco/CodeMirror 특유 타입을 넣지 않는다 |

**Rationale:** SE-ADP-5는 미래에 Monaco 어댑터를 만들 때조차 유지된다. Monaco의 `IModelContentChangedEvent` 같은 타입이 core 인터페이스에 새어나오면, CodeMirror 어댑터 작성자가 Monaco를 공부해야 한다. 각 어댑터가 자신의 위젯 API를 코어 계약으로 번역하는 책임을 진다.

### 4.5 Invariants

| Invariant | Meaning |
|-----------|---------|
| INV-SE-1 | Core는 어떤 위젯 라이브러리에도 의존하지 않는다 (`package.json` dependency 검사로 검증) |
| INV-SE-2 | 동일 source + 동일 prev module = 동일 next module + 동일 plan (결정론) |
| INV-SE-3 | Headless adapter로 작성한 테스트는 향후 Monaco/CodeMirror 어댑터에서도 유효하다 |
| INV-SE-4 | Edit history의 재생(replay)은 동일한 최종 module과 snapshot을 복원한다 |

INV-SE-4는 Lineage-as-identity 원칙의 Studio 버전이다. Memory-agent의 `rebuildIndex()`와 동형 관계.

---

## 5. 핵심 설계 판단 — Why

### 5.1 왜 Explicit Build Trigger인가

**대안:** `setSource()` 즉시 build (암묵적 trigger).

**판단 근거:**

1. **에이전트의 작업 단위와 일치한다.** 에이전트는 한 논리적 변경에 여러 source edit을 하고 싶어한다 (예: state 추가 + action 추가 + computed 추가가 한 refactor). 암묵적 trigger는 매 edit마다 reconcile이 터지므로 중간 상태 처리 비용이 생긴다.
2. **결정론의 경계가 명확해진다.** "언제 reconcile이 일어났는가"가 명시적 이벤트 이름으로 기록된다. 디버깅 시 타임라인이 깨끗.
3. **테스트가 단순해진다.** `setSource(...); setSource(...); build()` — 의도한 시점에만 side effect.

**비용:** Phase 1에 Monaco 어댑터를 만들 때 "자동 빌드" 옵션을 쓰고 싶어질 것. 이건 어댑터가 idle timer로 `requestBuild()`를 호출하면 해결됨 — core는 여전히 모름.

### 5.2 왜 Identity = `LocalTargetKey`인가

**대안:** AST node identity, 또는 body-hash 기반 identity.

**판단 근거:**

1. **이미 존재하는 키 공간이다.** Compiler, `AnnotationIndex`, `SourceMapIndex`, `SchemaGraph`가 이미 쓰는 공통 언어. 새 identity 체계를 발명하면 매핑 비용만 생김.
2. **사용자에게 보이는 단위이다.** 사용자가 "이 action이 살아있는가"라고 물을 때, 그들이 말하는 "이 action"은 `action:submit` 같은 이름으로 지목된다.
3. **Non-Turing-complete MEL의 혜택.** 선언 단위가 의미의 원자 단위라는 게 MEL의 설계 속성. 이걸 식별자로 쓰는 것은 언어 철학과 정합.

### 5.3 왜 Rename 휴리스틱을 거부하는가

위 §4.2 Rationale 참조. **결정론 > 편의**.

Phase 1에서 인간 사용자가 UI를 쓸 때, "이름 바꾸기" 버튼(F2 스타일)을 제공하여 `rename_decl` intent를 명시적으로 생성하게 한다. 사용자가 텍스트 편집으로 이름을 바꾸면 "삭제 + 추가"로 취급된다 — 의도적으로 불편하게 만들어서, 사용자가 올바른 경로(rename 버튼)를 쓰도록 유도.

### 5.4 왜 `DomainSchema` 대신 `DomainModule`을 핵심 자산으로 쓰는가

`DomainSchema`만 있으면 runtime은 돌지만, reconciliation에는 `SourceMapIndex`와 `AnnotationIndex`가 필요하다. Studio는 본질적으로 **도구(tooling) 계층**이므로 tooling sidecar를 포함한 `DomainModule`이 자연스러운 단위.

**SMAP-ARCH-8 준수:** 런타임에는 `module.schema`만 넘기고 sidecar는 studio-core가 소유한다.

---

## 6. Future Phases (Non-Binding Roadmap)

**이 섹션은 Phase 0의 결정이 아니다.** Phase 0가 끝날 때 별도 제안서로 각 phase가 승격된다.

### Phase 1 — Human UI (예정)

추가 패키지 후보:
- `@manifesto-ai/studio-adapter-monaco` — Monaco 어댑터
- `@manifesto-ai/studio-ui` — 기본 React 컴포넌트 (Snapshot Inspector, Trace Timeline, Dispatch Playground, Graph Pane)
- `@manifesto-ai/studio-app` — 실행 가능한 에디터 앱 예제

이 단계의 목표는 "**Phase 3 데모 녹화 가능**"이지, "주 개발 도구로 쓸 만한 수준"이 아니다. 범위 제한 필수.

Phase 1은 studio-core의 인터페이스를 **바꾸지 않는다.** 어댑터와 UI만 추가. 만약 core 변경이 필요하다면 그건 Phase 0에서 놓친 것 — 역으로 Phase 0 설계를 검증하는 장치.

### Phase 2 — Advanced Reconciliation (예정)

- SchemaGraph 변경 영향 분석 (어떤 선언 변경이 어떤 computed에 전파되는지)
- Type compatibility matrix 정교화
- 부분 HMR (computed-only 변경 시 snapshot 완전 보존 등)
- ADR-022c가 landed되면 sub-declaration reconciliation

### Phase 3 — Agent Workbench (최종 목표)

- `EditIntent`의 structured 확장 (`add_action`, `change_guard` 등)
- Agent adapter 추가 (headless의 확장)
- Review gate 활성화 (Governance 통합)
- Agent proposal preview — `simulate()`로 plan 결과를 실행 전에 표시
- 에이전트가 자기 MEL을 편집하는 것을 인간이 관찰하는 인터페이스

**Phase 3의 성공 기준:** 에이전트가 Phase 0에서 만든 studio-core를 **아무 수정 없이** 쓸 수 있어야 한다. 만약 수정이 필요하다면 Phase 0 설계가 잘못된 것.

---

## 7. Risks and Mitigations

### 7.1 Risk: Headless 설계가 미래 UI 요구를 놓칠 수 있음

**징후:** Phase 1에서 Monaco 어댑터를 만들 때 core API 변경이 계속 필요함.

**완화책:**
- Phase 0 마지막 주에 "Monaco 어댑터 *스케치*"를 30분짜리 paper exercise로 진행. 실제 구현 안 함, 인터페이스가 충분한지만 점검.
- 부족한 것이 발견되면 core에 추가, 아니면 그대로 freeze.

**수용한 위험:** 이 리스크를 완전히 제거하려면 Monaco 어댑터까지 Phase 0에 포함해야 함. 그러면 위젯 독립이 무너짐. 스케치 점검으로 감수.

### 7.2 Risk: Reconciliation의 edge case가 개발 지연을 유발

**징후:** "type 호환성 판정"이 생각보다 복잡해서 일정이 늘어남.

**완화책:**
- Phase 0의 type compatibility는 **극단적으로 보수적**으로 시작. 동일 타입이 아니면 전부 `discarded`. Warn 없음, 경고 없음, 그냥 버림.
- Phase 2에서 정교화. Phase 0에서 정교화하려는 욕구를 참기.

### 7.3 Risk: "아무도 Phase 0 자체는 안 쓴다"

**징후:** Phase 0 완성 후 6주가 지나도 Phase 1 착수가 안 되면, Phase 0는 dead code.

**완화책:**
- Phase 0 완료 시점에 **최소 CLI 도구** (`pnpm studio repl --file X.mel`)를 만든다. 텍스트 프롬프트에서 source 편집, build, dispatch, plan 출력. 이게 성우님 개인 REPL이 되어서, Phase 1 전까지 Coin Sapiens 개발에 실제로 쓰일 수 있게 함.
- 이 CLI는 *진짜 UI가 아니다* — Phase 0 non-goal을 우회하지 않는다. Headless adapter + stdin/stdout 래퍼일 뿐.

### 7.4 Risk: Edit History가 Lineage와 어떻게 관계 맺는지 불명확

**징후:** 각 EditIntent가 Lineage의 어느 entry에 저장되는지 애매.

**완화책:**
- Phase 0의 Edit History는 **in-memory array**로 시작. Lineage 통합은 Phase 0 주 3에서 검증.
- Lineage spec과 EditIntent 스키마가 호환되는지 별도 분석 필요 — **기술 조사 필요** (아래 §9 참조).

---

## 8. Success Criteria

Phase 0의 완료 판정은 다음 GO/NO-GO 체크리스트로 한다.

### Mandatory (전부 GO여야 Phase 1 진입)

- [ ] **SC-1.** `studio-core` + `studio-adapter-headless` 두 패키지가 `pnpm build` 성공
- [ ] **SC-2.** Headless 어댑터로 "source 설정 → 빌드 → dispatch → snapshot 확인"이 한 테스트 파일에서 통과
- [ ] **SC-3.** 재빌드 테스트: v1에서 state 초기값 변경 → v2에서 computed body만 수정 → snapshot 값 보존 확인
- [ ] **SC-4.** 재빌드 테스트: v1에서 action 존재 → v2에서 action 제거 → 관련 trace가 `obsolete` 태깅 확인
- [ ] **SC-5.** 결정론 테스트: 동일 EditIntent 시퀀스를 두 번 실행 → 동일 final snapshot + 동일 plan sequence
- [ ] **SC-6.** `package.json`에 어떤 위젯 라이브러리도 없음 (INV-SE-1)
- [ ] **SC-7.** CLI debug tool로 plan을 사람이 읽을 수 있는 형태로 출력 가능

### Optional (있으면 좋음)

- [ ] **SC-8.** CLI REPL이 실제 Coin Sapiens 도메인 하나에서 작동
- [ ] **SC-9.** Monaco 어댑터 paper sketch 완료 (§7.1)
- [ ] **SC-10.** GPT 교차 리뷰 완료

---

## 9. Open Questions (해결 후 착수)

Phase 0 착수 **전에** 답이 필요한 질문들:

| Q | 질문 | 판단 주체 |
|---|-----|----------|
| OQ-1 | Edit History를 Lineage에 저장하는가, 별도 저장소인가? Lineage spec과 EditIntent 스키마 호환성은? | 성우님 |
| OQ-2 | Type compatibility 규칙을 Phase 0에서 어디까지 구현? (제안: 동일 타입만 preserve, 나머지 discard) | 성우님 |
| OQ-3 | Phase 0 일정은 몇 주? (제안: 3주, §10 참조) | 성우님 |
| OQ-4 | 테스트 환경: Coin Sapiens 도메인을 쓸 것인가, 별도 toy 도메인을 쓸 것인가? | 성우님 |

---

## 10. Rollout (제안)

### Week 1 — 뼈대

- `studio-core` 패키지 scaffold + `studio-adapter-headless` scaffold
- `compileMelModule` 래핑, `createManifesto` 래핑
- Build pipeline (SE-BUILD-1 ~ SE-BUILD-6)
- Headless adapter 최소 구현 (SE-ADP-1 ~ SE-ADP-5)
- Test: "source 설정 → build → dispatch → snapshot" 한 사이클

### Week 2 — Reconciler

- `ReconciliationPlan` 타입 확정
- `LocalTargetKey` identity 기반 preserve/initialize/discard 분류
- Type compatibility 최소 구현 (Phase 0 수준)
- Snapshot reconciliation 적용
- Trace tagging (obsolete 여부만)
- Test: §8 SC-3, SC-4, SC-5

### Week 3 — Edit History + CLI

- `EditIntentRecord` 생성 및 저장
- Lineage 연동 (OQ-1 답 후)
- Replay: edit history로부터 최종 state 복원 (INV-SE-4)
- CLI debug tool (SC-7)
- Monaco 어댑터 paper sketch (§7.1)
- GO/NO-GO 판정 (§8)

---

## 11. Team / Guide Rail Notes

Studio Editor는 Manifesto 전체 생태계 중에서 **도구 계층**이다. 이 제안서의 구조적 선택들이 만드는 가이드 레일은 다음과 같다.

### 11.1 주니어 개발자를 위한 원칙

1. **"UI를 먼저 정하지 않는다."** Studio Editor는 Monaco를 안 쓴다 → CodeMirror도 안 쓴다 → 헤드리스부터 만든다. 이 순서가 설계 품질을 강제한다.
2. **"Identity는 발명하지 않고 채택한다."** `LocalTargetKey`가 이미 있으니 쓴다. "더 나은" identity 체계를 제안하기 전에 기존 것의 한계를 문서화해야 한다.
3. **"결정론을 지키는 비용이 편의성 비용보다 작다."** 자동 rename 감지 같은 휴리스틱은 "편리해 보이지만 결정론 깨뜨리는" 전형. 명시적 intent 경로가 느려 보여도 장기적으로 빠르다.

### 11.2 팀 전체의 문화적 자산

- **Phase 0 완료 시점에 에이전트 연동 준비가 완료된다.** 인간 UI가 없어도 에이전트는 Studio를 쓸 수 있다. 이게 Manifesto의 "Actor Symmetry" 원칙의 실제 구현.
- **ReconciliationPlan은 공유 데이터 구조가 된다.** UI도, 에이전트도, 테스트도, 로그도 모두 같은 plan을 읽는다. 관점별로 다른 표현이 아니라 하나의 진실.
- **테스트 가능성 = 에이전트 친화성.** Phase 0에서 headless로 테스트 가능한 것 = Phase 3에서 에이전트가 쓸 수 있는 것. 두 목표가 한 방향.

---

## 12. Amendment Procedure

Phase 0 진행 중 이 제안서의 normative rule을 바꾸려면:

1. 변경 이유를 issue에 작성 (가능하면 failing test case 포함)
2. 성우님 승인 후 이 파일에 수정, Changelog 추가
3. 이미 통과한 test가 깨지면 해당 test도 함께 수정 (rule 변경 근거)
4. 변경된 rule은 즉시 이후 작업에 적용, 과거 커밋 소급 재작성 금지

Phase 0 종료 후에는 이 제안서를 **immutable**로 간주한다. 이후 변경은 Phase 1 제안서 또는 별도 ADR로.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-17 | Initial draft |
| 2026-04-17 | §3.3 reflects actual SDK surface: `dispatch` → `dispatchAsync`; `createIntent(action, ...args)` added; `StudioDispatchResult` = `DispatchReport + traceIds`; `subscribe` / `getCanonicalSnapshot` / `getEditHistory` noted as later-phase. |

---

*End of Studio Editor Proposal*
