# SagaLens MEL Author Architecture (Proposal)

> **Status**: Proposal — not yet implemented.
> **Date**: 2026-04-25
> **Supersedes**: deleted `packages/studio-mel-author-agent/` (workspace-as-live-editor)
> **Builds on**: `SagaLens` (durable, interruption-resilient agent turn)

이 문서는 Studio의 MEL Author 기능을 **작은 모델로도 작동하는 올바른 추상화** 위에 다시 세우기 위한 아키텍처 제안입니다. 구현 전 합의용 문서이며, 결정되지 않은 항목은 `Open decisions` 섹션에 모아 둡니다.

---

## 0. TL;DR

- **현재 상태**: Author는 `createProposal({proposedSource: <전체 MEL>})`로 LLM에 5KB+ 통째 출력을 강요. 작은 모델 신뢰성 0, 큰 모델도 큰 schema에선 깨짐.
- **근본 원인**: 잘못된 추상화. UI agent가 작은 모델로 잘 동작하는 이유는 **매 발화 = 작은 dispatch 한 개**이기 때문. Source authoring은 그게 안 돼 있었음.
- **새 모델**: 사용자 MEL은 commit 전엔 한 글자도 안 건드림. 대신 Studio 안에서 **Workspace**를 띄우고, LLM이 **op 한 조각씩 dispatch**, compiler가 **typed AST primitive**로 적용 + 검증, 누적된 결과는 **commit 시점에만** 사용자 MEL editor로 흘려보냄.
- **경계**: Compiler는 결정론적 도구 (parse/render/applyOp/index)만. Author layer (Studio)가 의도 해석 / op 시퀀싱 / 재시도 / lineage / session / LLM string⇄AST lowering을 담당.

---

## 1. Why — 현재 접근이 깨지는 이유

### 1.1 증상

- 작은 모델 (gemma4:e4b 등)이 `createProposal` tool을 부르는 시점에 5KB+ MEL prose를 emit 못 함
- 큰 모델로 가도 schema 규모가 커지면 비례해서 무너짐 (20K 라인 schema 요청에 GPT-5도 흔들림)
- SagaLens 위에서 layer가 자꾸 쌓임 (forced toolChoice, zero-tool streak detection, hard cap, ramble demote, race condition fix...) — 모두 **하나의 근본 증상의 다른 얼굴**

### 1.2 진단

UI agent가 작은 모델로 잘 동작하는 이유는:

```
한 발화 = Manifesto runtime에 dispatch 한 번
- 출력 길이가 짧음 (수십 글자)
- 컴파일러가 자동 검증 (legality gate)
- 누적은 lineage가 자동
- 실패는 격리됨
- 재개 가능
```

Author도 같은 모양이어야 함. 그런데 우리는 source authoring을 **wholesale dump**로 만듦 — abstraction leak.

### 1.3 비-해결책

다음은 모두 증상 완화일 뿐 근본 해결이 아님:

- 더 큰 모델 사용 (선형으로 한계가 위로 밀릴 뿐)
- 프롬프트 강화 (작은 모델은 긴 프롬프트 못 따라감)
- 강화된 toolChoice / 강제 forcing (Ollama 등 일부 provider 미준수)
- Reader/Writer/Repair/Orchestrator 등 다단 의식 (이전 시도, 결과는 추가 layer일 뿐 핵심 미해결)

---

## 2. Principle — Author / Compiler 경계

```
Author Layer (Studio + LLM)
  - 사용자 의도 해석
  - 편집 전략 / op sequence 결정
  - retry / repair / lineage / session 관리
  - LLM string ↔ AST lowering
  - workspace 누적 / fork / commit

Compiler Layer (@manifesto-ai/compiler)
  - parse / validate / lower / inspect / render
  - typed AST를 medium으로
  - 단일 op 결정론적 적용
  - source map / annotation / graph sidecar
  - DeclarationIndex / ReferenceIndex
  - safe-refactor primitive (prepareRename / prepareRemove)
  - sequence 관리는 안 함
```

### 2.1 핵심 규칙

> **Compiler는 structured/typed AST를 medium으로 둔다. string ↔ AST lowering은 Studio가 한다.**

LLM 친화성 같은 product 관심사가 compiler 시그니처를 오염시키지 않게:

- LLM이 string을 emit → Studio가 `parseMel*` 함수로 AST 변환 → compiler op은 typed AST를 받음
- compiler는 입력이 LLM에서 왔는지 알 필요도 신경쓸 필요도 없음

### 2.2 Compiler MUST NOT

- 사용자의 요청을 해석하지 않는다
- op sequence를 계획하지 않는다
- retry loop를 돌리지 않는다
- session state를 저장하지 않는다
- lineage / commit / proposal을 관리하지 않는다
- runtime snapshot을 mutate하지 않는다
- LLM planner / decomposer를 포함하지 않는다
- "이 기능을 추가해야 한다"는 product 판단을 하지 않는다

---

## 3. Compiler surface (요청)

### 3.1 String ⇄ AST 경계

```ts
parseMelActionBody(snippet: string, ctx: ParseCtx): { ast?: ActionBodyAST; diagnostics: Diagnostic[] };
parseMelComputedExpr(expr: string, ctx: ParseCtx): { ast?: ExprNode; diagnostics: Diagnostic[] };
parseMelTypeExpr(expr: string): { ast?: TypeExpr; diagnostics: Diagnostic[] };
parseMelStateField(field: string, ctx: ParseCtx): { ast?: StateFieldAST; diagnostics: Diagnostic[] };

type ParseCtx = { module: DomainModule };
```

`ctx.module`로 base를 받아 in-context analyze. Studio가 LLM string을 받으면 이걸로 lowering.

### 3.2 Typed Op union

```ts
type MelEditOp =
  | { kind: "addType"; name: string; expr: TypeExpr }
  | { kind: "addStateField"; name: string; type: TypeExpr; defaultValue: JsonLiteral }
  | { kind: "addComputed"; name: string; expr: ExprNode; deps?: string[] }
  | { kind: "addAction"; name: string; params: Param[]; body: ActionBodyAST }
  | { kind: "addAvailable"; action: string; expr: ExprNode }
  | { kind: "addDispatchable"; action: string; expr: ExprNode }
  | { kind: "replaceActionBody"; target: `action:${string}`; body: ActionBodyAST }
  | { kind: "replaceComputedExpr"; target: `computed:${string}`; expr: ExprNode }
  | { kind: "replaceAvailable"; target: `action:${string}`; expr: ExprNode | null }
  | { kind: "replaceDispatchable"; target: `action:${string}`; expr: ExprNode | null }
  | { kind: "replaceStateDefault"; target: `state_field:${string}`; value: JsonLiteral }
  | { kind: "replaceTypeField"; target: `type_field:${string}.${string}`; field: TypeField }
  | { kind: "removeDeclaration"; target: LocalTargetKey }
  | { kind: "renameDeclaration"; target: LocalTargetKey; newName: string };
```

### 3.3 통합 primitive

```ts
applyMelEditOp(
  source: string,
  op: MelEditOp,
  ctx?: { baseModule?: DomainModule },
): MelEditResult;

type MelEditResult = {
  newSource: string;
  diagnostics: Diagnostic[];
  module?: DomainModule;            // 컴파일 성공 시
  changedTargets: LocalTargetKey[];
  edits: MelTextEdit[];              // 세분 텍스트 변경 (Monaco/LSP)
  schemaDiff?: SchemaDiff;
};

type MelTextEdit = { range: SourceSpan; replacement: string };

type SchemaDiff = {
  addedTargets: LocalTargetKey[];
  removedTargets: LocalTargetKey[];
  modifiedTargets: Array<{ target: LocalTargetKey; before: unknown; after: unknown }>;
};
```

§5 (텍스트 edit) / §6 (additive) / §7 (replacement) / §9 (snippet compile) 모두 이 모양의 specialization으로 통합됨.

### 3.4 Index API

```ts
extractDeclarationIndex(source: string): DeclarationIndex;
extractReferenceIndex(source: string): ReferenceIndex;
```

`DeclarationIndex`: SourceMapIndex + module.schema 통합 projection (domain/types/stateFields/computeds/actions, 각각 target/span/관련 metadata).

`ReferenceIndex`: source-level reference graph (reads / writes / unlocks / dispatchabilityReads). SchemaGraph가 닿지 못하는 부분을 메움.

### 3.5 Safe refactor primitive

```ts
prepareRename(source: string, target: LocalTargetKey): RenamePlan;
applyRenamePlan(source: string, plan: RenamePlan, newName: string): MelEditResult;

prepareRemove(source: string, target: LocalTargetKey): RemovePlan;
applyRemovePlan(source: string, plan: RemovePlan): MelEditResult;

type RenamePlan = {
  target: LocalTargetKey;
  currentName: string;
  references: Array<{
    kind: "read" | "write" | "typeRef" | "annotationTarget";
    span: SourceSpan;
    confidence: "exact" | "ambiguous";
  }>;
  blockers: Diagnostic[];
};

type RemovePlan = {
  target: LocalTargetKey;
  dependents: LocalTargetKey[];
  blockers: Diagnostic[];
  safeToRemove: boolean;
};
```

규칙:
- exact reference만 자동 edit
- ambiguous는 blocker로 반환, author가 override 결정
- `safeToRemove: false`면 author가 cascade 결정 후 의식적으로 적용

### 3.6 우선순위

```
1. parseMelActionBody / parseMelComputedExpr / parseMelTypeExpr / parseMelStateField
2. MelEditOp + applyMelEditOp + SchemaDiff
3. addAction / addStateField / replaceActionBody / replaceComputedExpr op 종류
4. DeclarationIndex (derive로 시작 가능, 정식화는 나중)
5. ReferenceIndex
6. prepareRemove → prepareRename
7. body-level SourceMap 확장
```

후순위 / 제외:
- `formatMel` (전체 소스 pretty-print) — round-trip 안정성은 필요하지만 별도 API로 뺄 만큼 자주 안 쓰임
- structured `quickFixes` — diagnostic + span에서 author가 휴리스틱 도출 가능
- `addMeta` (annotation op) — 사용처 좁음
- `tokenize` public 노출 — 내부 유지

---

## 4. Studio architecture

### 4.1 Workspace — 누적기

```ts
type Workspace = {
  baseSource: string;                    // saga 시작 시 사용자 MEL 스냅샷
  stack: AppliedOp[];                    // 적용된 op 시퀀스
  currentSource: string;                 // derived: base + stack 적용 결과
  currentModule: DomainModule | null;    // derived: currentSource 컴파일 산출
  status: "clean" | "broken";            // currentModule 존재 여부
  lastDiagnostics: Diagnostic[];
};

type AppliedOp = {
  id: string;
  op: MelEditOp;
  appliedAt: number;
  resultStatus: "ok" | "broken";
  diagnosticsAtApply: Diagnostic[];
};

// API
createWorkspace({ baseSource }): Workspace
ws.apply(op): { ok: boolean; diagnostics: Diagnostic[]; schemaDiff?: SchemaDiff }
ws.popLast(): { ok: boolean }
ws.peekStack(): AppliedOp[]
ws.snapshot(): WorkspaceProjection                       // LLM-facing 요약
ws.canCommit(): boolean                                   // status === "clean"
ws.toFinalDraft({ title, rationale }): MelAuthorFinalDraft
```

### 4.2 Workspace 핵심 약속

> **Workspace는 broken 상태를 허용한다. 오직 commit만 clean을 요구한다.**

- 도중에 컴파일이 깨져도 OK — agent가 진단을 보고 다음 op으로 고치거나 `popLast`로 되돌림
- 사용자 MEL editor는 **commit 전엔 단 한 글자도 변경되지 않음**
- 이것이 "agent가 마음껏 깨지면서 작업할 수 있는 안전한 scratch space" 보장

### 4.3 Tool catalog (LLM-facing)

**편집 (op dispatch) — string args, Studio가 parseMel*로 lowering:**

| Tool | Args |
|---|---|
| `addType` | `{ name, expr: string }` |
| `addStateField` | `{ name, type: string, defaultValue }` |
| `addComputed` | `{ name, expr: string }` |
| `addAction` | `{ name, params: string[], body: string }` |
| `addActionAvailable` | `{ action, expr: string }` |
| `addActionDispatchable` | `{ action, expr: string }` |
| `replaceActionBody` | `{ target, body: string }` |
| `replaceComputedExpr` | `{ target, expr: string }` |
| `replaceStateDefault` | `{ target, value }` |
| `removeDeclaration` | `{ target }` |
| `renameDeclaration` | `{ target, newName }` (RenamePlan 포함 결과 반환) |

**워크스페이스 제어:**

| Tool | 역할 |
|---|---|
| `popLastOp` | 마지막 op 취소 |
| `inspectWorkspace` | 현재 stack / status / diagnostics / currentSource 요약 |
| `branchWorkspace` | 분기 (Phase 2) |
| `resetToCheckpoint` | 분기 복귀 (Phase 2) |

**기존 read tools 유지 — 단 base는 workspace.currentSource:**

`inspectSourceOutline`, `readDeclaration`, `findInSource`, `inspectFocus`, `inspectSnapshot`, `inspectAvailability` 등.

**종결:**

| Tool | 역할 |
|---|---|
| `commitWorkspace({title, rationale})` | `canCommit()` 시만 성공. ProposalPreview로 흐름 → 사용자 Accept |
| `answerAndTurnEnd({answer})` | 편집 없는 Q&A 종결 (현재 saga와 동일) |

### 4.4 Saga lifecycle

```
[user prompt]
  ↓
beginAgentSaga(id, prompt)
  ↓
createWorkspace({ baseSource: 사용자 MEL })       ← saga state로 보관
  ↓
Saga 루프 (sendAutomaticallyWhen: status === "running")
  per invocation:
    LLM dispatches 0~N 개 op tool calls
      → Studio가 parseMel* → applyMelEditOp → ws.apply
      → diagnostics를 tool result로 LLM에 반환
    LLM은 inspectWorkspace, popLastOp, readDeclaration 등 자유 사용
  ↓
agent calls commitWorkspace({ title, rationale })
  ↓
ws.canCommit() check
  ↓ ok
ws.toFinalDraft() → MelAuthorFinalDraft
  ↓
verifyMelProposal (기존 verifier 재사용)
  ↓
setProposal → ProposalPreview UI
  ↓
사용자 Accept → adapter.setSource(finalSource) + adapter.requestBuild
  ↓
concludeAgentSaga (saga end)
```

### 4.5 Failure / recovery 시나리오

**(a) op 적용은 됐지만 workspace broken**
- `ws.status = "broken"`, diagnostics surface
- agent가 진단 보고 다음 op으로 고치거나 `popLast`
- `commit` 막힘 (`canCommit() === false`)

**(b) op이 syntactically 잘못 (parse 실패)**
- `ws.apply`가 `{ok: false}` 반환, stack에 안 들어감
- diagnostics agent에 전달
- agent가 args 수정해서 다시 호출

**(c) 의미적으로 잘못 (예: 없는 type 참조)**
- (a)와 같은 경로 — apply는 됐고 broken 상태

세 경우 모두 **workspace 안에서** 처리. 사용자 MEL은 영향 없음.

### 4.6 Saga state (durable)

기존 `agentSaga*` MEL state에 추가:

```mel
state {
  ...
  agentSagaWorkspaceId: string | null = null   // workspace store lookup key
}
```

Workspace 본체 (큰 source/stack)는 IndexedDB / 메모리 store에. MEL에는 ID만 보관해서 새로고침 시 복원.

### 4.7 UI 변화

- **Workspace panel** (신규): 누적된 op 리스트 + 진단 + currentSource 미리보기
- **ProposalPreview** (기존, 그대로): commit 후 표시
- **Saga 상태 표시**: 진행 중에도 "지금까지 적용된 op N개, broken/clean" 가시화

---

## 5. Phasing

### MVP (Phase 1)

**Compiler:**
- `parseMelActionBody` / `parseMelComputedExpr` / `parseMelTypeExpr`
- `MelEditOp` (6 kind) + `applyMelEditOp` + `SchemaDiff`
- 6 op: `addAction`, `addStateField`, `addComputed`, `replaceActionBody`, `replaceComputedExpr`, `removeDeclaration`

**Studio:**
- In-memory `Workspace`, linear stack (분기 없음)
- 6 op tool wrapper + `popLastOp` / `inspectWorkspace` / `commitWorkspace`
- DeclarationIndex는 `SourceMapIndex + module.schema`에서 derive
- ReferenceIndex 없음 (rename은 이 단계에서 안 함)
- SagaLens 위에 통합

### Phase 2

**Compiler:**
- 정식 `DeclarationIndex` / `ReferenceIndex`
- `prepareRename` / `applyRenamePlan`
- `prepareRemove` / `applyRemovePlan`
- `addAvailable` / `addDispatchable` / `addType` / `replaceAvailable` / `replaceDispatchable` / `replaceStateDefault` / `replaceTypeField`

**Studio:**
- Branching workspace (fork / checkpoint)
- IndexedDB persistence (saga 새로고침 후 resume)
- `renameDeclaration` tool
- Workspace를 Manifesto domain으로 lift 검토

### Phase 3

- Multi-saga 비교 (alternative drafts)
- Schema diff 시각화
- LLM-as-planner: 복잡한 요청 → op sequence 미리 plan → 단계별 실행
- body-level SourceMap (diagnostic span 정밀화)

### Out of scope (영구)

- `formatMel` (전체 소스 pretty-print API)
- structured `quickFixes`
- `addMeta` (annotation op)
- `tokenize` public 노출
- Compiler 안에 LLM/planner

---

## 6. Open decisions

1. **Workspace를 Manifesto domain으로 lift할지** — MVP는 plain JS, Phase 2 승격 추천. lineage / fork / replay가 공짜로 옴.
2. **Q&A vs 편집 분기** — 시스템 프롬프트가 라우팅: 편집이면 op tools, 단순 질문이면 `answerAndTurnEnd`.
3. **commit 후 자동 적용 여부** — No, 사용자 Accept 필수 유지 (현재처럼 ProposalPreview).
4. **op tool 묶음 (개별 11개) vs 통합 `applyOp` 하나** — 개별 11개 추천. description이 명확해서 모델이 적절한 걸 고르기 쉬움.
5. **AST 노드 export 정책** — `ActionBodyAST`, `ExprNode`, `TypeExpr`, `Param`, `TypeField` 등이 public type으로 안정적 노출되어야 함. 현재 renderer/index에 일부 export됨. 정식 surface 정리 필요.
6. **rename/remove cascade 처리** — `prepareRemove(target).dependents`가 비었을 때만 자동 적용? 아니면 author override 가능? 입장: blocker 반환만, override는 author 책임.
7. **fragment ordering 자동 정렬** — addType → addField → addComputed 순처럼 의존 순으로 자동? 입장: **author 책임**. compiler는 단일 op만 관리.
8. **AST round-trip 보장 수준** — `parse → render → parse`가 semantic 동일성? structural 동일성? 어디까지 약속?
9. **Workspace store 위치** — IndexedDB? Manifesto adapter store? 새 store?
10. **여러 saga / 여러 workspace 동시성** — 한 번에 하나만 허용? 사용자가 두 saga를 병렬로?

---

## 7. Migration path

- 기존 `createProposal` tool은 Phase 1 MVP 동안 fallback으로 유지 (간단한 작은 변경 케이스용)
- 새 op tools는 `SagaLens`에 우선 추가, `AgentLens`는 그대로
- 충분히 검증되면 `createProposal` deprecate
- `ProposalPreview` / `proposal-buffer` / `verifyMelProposal`는 commit 단의 어댑터로 재사용

---

## 8. Glossary

| 용어 | 정의 |
|---|---|
| **Op** | 단일 결정론적 MEL edit operation (typed AST 기반) |
| **MelEditOp** | 11종의 op union (compiler가 정의) |
| **Workspace** | 누적된 op stack + base source 보유, broken 상태 허용 |
| **Fragment** | rendered MEL text fragment (compiler renderer 출력) |
| **Saga** | durable agent turn, status가 MEL state에 영속 |
| **Author layer** | Studio + LLM. 의도 / sequence / lineage / session 관리 |
| **Compiler layer** | `@manifesto-ai/compiler`. typed AST primitive 제공 |
| **Commit** | workspace의 누적 결과를 사용자 MEL에 반영하는 단일 시점 |
| **DeclarationIndex** | SourceMapIndex + module.schema 통합 projection |
| **ReferenceIndex** | source-level reference graph |

---

## 9. Reference

- 현재 SagaLens: `apps/webapp/src/agent/ui/SagaLens.tsx`
- saga state MEL: `apps/webapp/src/domain/studio.mel` (`agentSaga*`)
- 기존 verifier: `apps/webapp/src/agent/session/proposal-verifier.ts`
- 기존 ProposalPreview: `apps/webapp/src/agent/ui/ProposalPreview.tsx`
- Compiler PatchOp 토대: `@manifesto-ai/compiler/dist/renderer/patch-op.d.ts`
- Compiler PatchFragment / renderAsDomain: `@manifesto-ai/compiler/dist/renderer/fragment.d.ts`
- 폐기된 이전 시도: 삭제된 `packages/studio-mel-author-agent/` (workspace-as-live-editor — 적층 모델 아님)
