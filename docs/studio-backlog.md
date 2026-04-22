# Studio Backlog

> **Status:** 📝 **Active — follow-up backlog (2026-04-18)**
> **Date:** 2026-04-18
> **Ref:** [phase-1-roadmap.md](./phase-1-roadmap.md), [phase-1-proposal.md](./phase-1-proposal.md)
> **Scope:** Interaction debugging, runtime inspection, graph literacy follow-up

이 문서는 Phase 1 구현 이후 남은 Studio 후속 과제를 정리한 백로그이다. 이미 landing된 그래프 포커스/라우팅 작업은 제외하고, 실제 디버깅 경험과 학습성 관점에서 남은 과제를 분류한다.

---

## 0. 최근 반영됨 (백로그 제외)

- `Graph Focus v2` — 2-hop DOI focus, graph/code selection 동격화, blast radius, smart camera
- `Orthogonal Routing v1` — force layout 위 Manhattan path 도입
- 목적: 이미 끝난 그래프 가독성 작업을 백로그와 섞지 않음

---

## 1. 수용 가능한 것 (다음 사이클)

### 1.1 Simulate preview가 computed / indexed path를 잘못 보여주는 버그 수정

- 증상: `computed.activeCount` 같은 항목이 `undefined -> undefined`로 보이거나 `data.todos[0]` 경로가 풀리지 않음
- 판단: 런타임 또는 plan 문제가 아니라 preview UI 버그
- 범위:
  - `snapshot.data`와 `snapshot.computed`를 함께 조회
  - bracket/index path 해석 (`foo[0].bar`)
  - computed / array-path 회귀 테스트 추가

### 1.2 Interact 입력값 및 결과 유지

- 증상: 탭 전환과 재실행 사이에서 작업 컨텍스트가 쉽게 끊김
- 판단: 반복 실험 루프를 느리게 만드는 UX 문제
- 범위:
  - 탭 전환 시 action 선택 / form payload 유지
  - 같은 schema/action이면 마지막 simulate/dispatch 결과 유지
  - schema incompatibility나 명시적 reset일 때만 초기화

### 1.3 Graph / Legend 의미 강화

- 문제: edge와 node 의미는 존재하지만 현재 legend만으로는 "의사결정 그래프"라는 mental model이 충분히 전달되지 않음
- 범위:
  - node kind / edge relation 툴팁 보강
  - `feeds / mutates / unlocks`의 읽기/쓰기/가용성 의미를 UI 텍스트로 노출
  - focus card / legend / empty state 문구를 통일

---

## 2. 나중에 할만한 것 (모델 확장 후)

### 2.1 Dispatch timeline / replay lane 추가

- 목표: action, payload, changed paths, snapshot diff를 시간축으로 재생
- 선행조건: `studio-core`가 dispatch event stream을 react layer로 노출해야 함

### 2.2 Snapshot / Plan / History cross-link

- 목표: 상태 경로 하나를 잡고 시간축/plan으로 점프
- 선행조건: path index + selection state + dispatch events

### 2.3 Diff / patch 설명 강화

- 목표: "무엇이 바뀌었나"를 넘어서 "왜 바뀌었나 / 어떤 guard가 열렸나"까지 설명
- 선행조건: admission / availability / dispatch explanation seam 정리

### 2.4 Rebuild vs Dispatch lane 분리

- 목표: schema rebuild와 runtime dispatch를 다른 사건으로 보여줌
- 선행조건: dispatch event lane 도입
- 주의: 현재 History는 혼합 스트림이 아니라 rebuild-only이다. 문제는 혼합이 아니라 dispatch 부재다.

---

## 3. 지금 형태로는 받지 않을 것 (seam 재정의 필요)

### 3.1 Plan 뷰에 runtime action patch 요약을 직접 넣기

- 이유: 현재 `Plan`은 build-time reconciliation surface이지 runtime action semantics surface가 아님
- 대안: 별도 `Action Impact` 또는 `Dispatch Replay` panel로 분리

### 3.2 "History가 rebuild와 dispatch를 이미 섞고 있다"는 진단

- 이유: 현재 구현은 dispatch를 거의 보여주지 않음. 섞인 것이 아니라 빠져 있음
- 대안: 문제 정의를 `dispatch lane 부재`로 고쳐 `2.1` / `2.4`로 추적

---

## 4. 우선순위 제안

1. Simulate preview computed/path 버그
2. Interact 입력/결과 유지
3. Graph / Legend 의미 강화
4. Dispatch event model 설계

---

## 5. Phase 2 (Intent Insight Ladder)에서 발견된 후속 항목

### 5.1 Sparse-optional payload의 simulate() 실패 — ✅ 해결됨

- 원인 확인: `studio-core.simulate(intent)`가 `intent.input` 전체(`{payload: {...}}`)를 SDK runtime.simulate의 positional arg로 그대로 넘겨서 `"Unknown field: payload"` throw. `dispatchAsyncWithReport`는 intent 직접 받아 내부에서 unwrap하므로 영향 없었음.
- 수정: `simulate()` 내부에서 `schema.actions[intent.type].params` 순서로 intent.input을 positional args로 spread.
- 테스트: InteractionEditor 회귀 테스트를 Rule S1 경로 (Simulate → Dispatch)로 되돌리고 `enforceSimulateFirst={false}` opt-out 제거.

### 5.2 Pillar 1 (Harness > Guardrail) Studio UI — ✅ 부분 해결됨

- 구현: `studio-core.isActionAvailable(name)` surface 추가. InteractionEditor의 액션 `<select>`를 `<optgroup>` 두 개로 분할 — "Available now" + "Currently unavailable"(∅ prefix).
- 남은 부분: H3 정적 counterfactual (unavailable 액션별로 "이렇게 하면 가능" 힌트). `available when` expression에 `firstProvableHint` 적용 필요. 다음 사이클.

### 5.3 Pillar 4 (Time is first-class) Studio UI — ✅ 부분 해결됨

- 구현: Studio Core에 synthetic `LineageTracker` 추가. build 성공과 completed dispatch마다 World 레코드(parent chain + snapshot hash + origin) 기록. `StudioCore.getLineage() / getLatestHead() / getWorld(id)` surface 노출. NowLine 우측에 현재 world id 뱃지 + hover tooltip (parent → id, depth, origin).
- 남은 부분:
  - 진짜 SDK `withLineage` 기반 Merkle DAG로 교체 (SealAttempt 포함). 현재는 UI projection이고 재구동 시 체인 사라짐.
  - "Lineage" lens — world list + branch tree 시각화.
  - Scrub-to-past가 현재는 edit envelope 기반. World-id 기반 scrub으로 확장.
- 우선순위: Medium — 당장 UI에 lineage가 보이므로 "silent" 상태는 해결. 깊은 통합은 사용자 체감 피드백 후.

---

## 6. Cluster-aware LiveGraph 후속 (Phase 2/3)

Phase 1 (`detectClusters` + cluster-aware column layout + dashed 경계)이 landing됨. 다음은 사용자 요청으로 백로그 이관.

### 6.1 Collapsible cluster — ✅ 해결됨

- 구현: cluster 경계에 chevron 토글 버튼, 접힘 상태 `collapsedClusters: Set<ClusterId>` 로컬 관리. 접힌 cluster는 member rect를 cluster 중앙으로 override → FLIP 애니메이션이 카드를 중앙으로 모음 + supernode overlay 1개를 중앙에 렌더. Edge endpoint가 member rect를 따라가므로 자동으로 supernode로 수렴(explicit reroute 없이도 시각 효과 확보).
- 남은 부분: 접힌 상태에서 내부 edge가 0-length로 그려짐(시각상 안 보여도 DOM에 남음). Phase 3 edge reroute와 함께 정리 고려.

### 6.2 Hierarchical edge bundling — ✅ 해결됨

- 구현: `bundledEdgePath(from, to, rendezvous)` helper — source/target attach에서 perpendicular로 나와 rendezvous(두 cluster 중심의 midpoint)에서 만나는 2-segment bezier. 같은 src/tgt cluster pair edges는 같은 rendezvous를 통과해 "trunk" 효과. `EdgeLayer`에 `bundlingEnabled` prop. focus mode에서는 비활성.
- 남은 부분: hover 시 해당 edge만 un-bundle하는 인터랙션 (복잡도 높음, 후속).

### 6.3 Cluster 알고리즘 튜닝 — ✅ 해결됨

- 구현: bridge-action heuristic. 전체 state의 60% 이상을 mutate하는 action은 "universal"로 간주하고 Jaccard 비교에서 제외. 단, 어떤 state가 bridge action 만으로 mutation된다면 fallback으로 bridge 포함 (그래야 singleton으로 떨어지지 않음). 테스트 케이스 추가.
- 남은 부분: threshold 값(0.3 / 0.6)이 실사용에서 어떻게 보이는지 관찰 후 조정. computed affinity가 실제 cluster membership과 어긋나는 경우 추가 검토.

---

## 7. Value rendering 후속 (InlineValue 승격 이후)

Phase 1 (`InlineValue` 공통 컴포넌트 + NowLine 툴팁/SimulatePreview diff 마이그레이션)이 landing됨. 다음은 사용자 요청으로 백로그 이관.

### 7.1 JsonTree — 확장 가능한 트리 뷰어 (B)

- 목적: 깊은 객체/배열을 Chrome DevTools console 스타일로 재귀적 key/value 트리로 표시. `▸` 클릭으로 레벨별 확장, 타입별 색 (string/number/bool/null 구분).
- 사용처 후보: Snapshot pane, dedicated inspect panel, dispatch diff의 객체가 많을 때 "펼쳐보기" 링크.
- 설계: 자체 구현(~200줄) vs `react-json-view` 같은 라이브러리 도입. 번들 크기/테마 통합 고려하면 자체 구현이 나음.
- InlineValue와의 관계: InlineValue는 1줄 요약, JsonTree는 multi-line 드릴다운. 트리 노드의 leaf 값은 InlineValue로 재사용 가능.
- 우선순위: Low — InlineValue 도입 후 "이 이상의 드릴다운이 필요하다"는 신호가 나올 때 착수.

### 7.2 Semantic diff rendering — 구조 보존 diff (C)

- 목적: `-`/`+` 행을 "변경된 서브키 단위"로 쪼개서 보여줌. 예:
  ```
  todos[0]
    completed  − false  + true
    priority   − 1      + 3
  ```
  현재는 path 전체의 before/after 2줄로만 표시 — 객체 한 덩어리가 `{...}`로 축약되면 실제 무엇이 변경됐는지 숨겨짐.
- 구현: deep-diff 알고리즘 (`diff` / `microdiff` 등 경량 라이브러리 또는 자체 40줄 재귀) + `InlineValue`의 leaf 렌더러 재사용.
- InlineValue가 이미 shape을 보여주므로 체감 이점은 "깊이 2 이상의 객체 diff에서 가장 뚜렷"함. 단순 scalar 변경에서는 이득 작음.
- 우선순위: Low — InlineValue 적용 후 실제로 "diff가 {...}로 뭉쳐서 안 보인다"는 케이스가 많이 관찰되면 착수.

### 7.3 InlineValue와 ValueView 통합

- 현재 두 컴포넌트가 각자 존재:
  - `ValueView` (apps/webapp): 카드 내 stateful 렌더 (토글 UI, 대형 숫자, array 타일, object 접힘)
  - `InlineValue` (studio-react): 어디서든 1줄 inline 표시
- 중복 로직 (type 분기, truncate) 일부 있음. 장기적으로는 `ValueView = InlineValue + card-affordances` 레이어로 합치는 게 좋음.
- 지금은 역할 분리로 유지. 각 사용처의 요구가 충분히 다를 때까지는 통합 부담이 이득보다 큼.

---

## 8. Agent-first Studio — "Deterministic Agent Observatory"

Studio의 장기 방향. MEL 작성을 **에이전트가 담당**하고, 사용자는 Studio에서 에이전트의 제안을 **읽고 · 비교하고 · 승인 · 재지시**하는 공동작업대로 진화.

포지셔닝: "그래프 IDE" → "**Deterministic Agent Observatory**" — 의미론적 결정론 시스템을 에이전트와 공유하고 함께 작업하는 작업대.

### 8.0 왜 Manifesto + Agent가 맞는가 (설계 근거)

- **MEL Non-Turing-complete** → 에이전트가 "이상한 짓"을 할 공간 자체가 좁음. 무한 루프 / 숨은 부작용 / 암묵적 IO 모두 불가능.
- **컴파일러 즉시 판정** → LLM이 뽑은 MEL 을 compile → diagnostics 로 부적합이 선형 포착. 에이전트 verify loop 이미 제공됨.
- **Simulate가 pure projection** → 에이전트가 "이 변경이 기존 상태에 무슨 영향을 주는지" 실행 없이 검증 가능. `compile → simulate(sample intents) → diff` 가 에이전트 self-check 루프.
- **Reconciliation plan 결정론** → 에이전트가 state 필드 변경 시 `preserved/initialized/discarded/warned` 가 결정론적 결과. 사용자에게 "안전한가?" 를 plan 으로 그대로 답 가능.
- **Lineage (withLineage)** → 에이전트가 과거 world chain 을 읽고 "이 필드는 이 action 에서 이렇게 변해왔다" 는 맥락을 정확히 복원.

### 8.1 Agent turn 시각화

- 에이전트의 tool call 하나하나가 "제안" 단위로 Studio 에 들어와야 함.
- NowLine 에 dispatch tick / edit envelope tick 있는 것처럼 **agent turn tick** 도입.
  - 각 turn = schema edit proposal / action simulation / dispatch 중 하나
  - `origin: "agent" | "human"` 으로 색 / 아이콘 구분
- 승인 전 상태(proposed, pending user approval) 를 UI 에서 명확히 — `ghost` tick 스타일.
- 우선순위: High — 다른 대부분의 agent 기능의 기반 UI.

### 8.2 Diff-first Editor

- 에이전트가 주 작성자가 되면 Monaco 는 **diff view** 가 메인.
  - `git diff` 스타일 + 에이전트의 근거(comment) 인라인.
  - 사용자는 accept / reject / revise 지시만.
- Monaco 는 "edge case 직접 편집" 으로 후퇴 — 필요할 때만 toggle.
- 우선순위: High — 사용자-에이전트 공동작업 핵심.

### 8.3 Structured Agent Directive

- 자연어 입력 → 에이전트의 MEL patch proposal 이 묶여 함께 뜸.
  - "sort 된 todos 추가해줘" → directive + proposed MEL + plan + simulate result 한 카드.
- SDK 의 Phase 3 EditIntent "structured agent intents" 와 맞물릴 수 있음.
- 의존: 8.1 (turn 시각화), 8.2 (diff editor).
- 우선순위: High — 사용자가 에이전트에 지시하는 단방향 엔트리 포인트.

### 8.4 Proposal replay — multi-action simulate

- 현재 Playback 은 한 action 의 전파. 에이전트 제안은 보통 여러 step 의 시나리오 (예: "create task + move to in-progress + fire complete").
- 제안된 action sequence 를 연속 simulate 로 묶어 **총 영향** 시각화.
- 단계별 snapshot 스냅샷 + 최종 state + reconciliation plan 동시 제공.
- 구현: `StudioCore.simulateSequence(intents[])` surface 추가 필요 (SDK 에 있으면 proxy, 없으면 Studio Core 에서 base runtime restore 기반 구현).
- 우선순위: Medium — 8.3 의 자연스러운 확장.

### 8.5 Lineage 의 `origin` 필드 + 감사 뷰

- 승인된 제안이 정상 dispatch 경로로 들어갈 때 world 에 `origin: "agent" | "human"` 기록.
- Lineage lens 에 origin 별 필터 + 세션 단위 그룹핑.
- "이 world 는 누가 만든 것인지" 감사 가능.
- 현재 synthetic lineage-tracker 에서 `WorldOrigin` 구조만 확장하면 low cost.
- 우선순위: Medium — 8.1 에 딸려옴.

### 8.6 Plan-based approval policy

- 에이전트가 낸 MEL 이 Pillar 위반(side effect / non-determinism) 시도하면 컴파일러가 막아주므로 OK.
- 하지만 **의도하지 않은 state wipe** (rebuild 로 `discarded` bucket 이 커지는 것) 는 컴파일러가 못 막음.
- Plan panel 에 임계점 정책 UI:
  - "≥ 3 fields discarded 시 추가 승인 필요" 같은 rule
  - 에이전트의 bulk rewrite 제안을 한 클릭으로 반려 또는 선택적 accept.
- 우선순위: Medium — 에이전트가 실제로 돌기 시작하면 우선순위 급상승.

### 8.7 Agent context injection channel

- 에이전트가 현재 schema + state + recent history 를 읽어내는 canonical channel 필요.
- SDK 에 이미 있음: `getSnapshot / getEditHistory / getSchemaGraph / getLineage`.
- 추가 필요: **agent-friendly serialization** — 토큰 효율적인 축약 포맷.
  - 예: `snapshot.compact = { data: {...}, computed-summary: {count, tags} }`
  - `getEditHistory` 의 envelope 요약 (`{kind, target, impact-summary}`)
- Studio 가 이 serialization 을 agent tool description 에 직접 붙여 제공.
- 우선순위: Medium — 없으면 LLM context 낭비. 있으면 에이전트 품질 ↑.

### 8.8 Uncertainty 표현 surface

- 에이전트가 "이거 맞는 것 같은데 자신 없음" 을 표현할 채널.
  - MEL 내부 structured comment (`// @uncertain: ...`) — 컴파일러는 무시, Studio 는 inline 배지.
  - 또는 제안 메타에 `confidence: number` + reasoning snippet.
- 사용자가 "어떤 부분이 위험하다고 보는가" 한눈에.
- 우선순위: Low — 에이전트 품질이 어느 정도 올라온 후.

### 8.9 Turn-based dispatch session

- "에이전트 턴" 이라는 세션 개념 도입.
  - 한 턴 = 여러 action proposal + 승인 전 모두 simulate 상태
  - 턴 전체 commit / rollback 단위
- SDK 의 transaction 개념은 없음 (base runtime 은 per-dispatch). Studio Core 에서 가상 "세션" 관리 — uncommitted proposals queue.
- 승인 시 queue 전체를 순차 dispatch, 실패 시 rollback (lineage restore).
- 우선순위: Medium-High — 이게 없으면 agent 제안이 낱개로 흩어짐.

### 8.10 NLI (자연어 인터페이스) chat pane

- LensPane 에 "Agent" lens 추가.
- 하단: 대화 입력, 상단: 에이전트 응답 + 제안 카드 stream.
- 에이전트 response 내 "이 제안 보기" 링크 클릭 → 8.1 agent turn tick + 8.2 diff view focus.
- 우선순위: Low (선행 8.1-8.3 필요) — 하지만 실제 사용자 흐름의 최종 엔트리 포인트.

---

## 우선순위 요약 (§8)

1. **Immediate foundation**: 8.1 (agent turn) · 8.2 (diff editor) · 8.3 (structured directive)
2. **Safety / correctness**: 8.6 (plan approval) · 8.9 (turn session)
3. **Quality enablers**: 8.7 (context channel) · 8.5 (lineage origin)
4. **Polish / UX layer**: 8.10 (chat pane) · 8.4 (proposal replay) · 8.8 (uncertainty)

현재 Studio 자산 중 **Intent Ladder / Simulate preview / Observatory / Focus / Inspect / Plan / Playback / Diagnostics** 는 이미 §8 의 대부분 기능의 시각/검증 인프라로 직접 전용 가능. 추가로 짓는 것은 주로 **agent surface + approval workflow**.

---

## 9. MVP Launch Levers — post-playground productivity

> Added 2026-04-22 after the IndexedDB project storage MVP landed (PR #7). 세 가지 레버 모두 feasibility 검토 완료 — `studio-core` / SDK 소스 기반으로 실행 가능성 확인됨. 우선순위: §9.2 → §9.1(A) → §9.3 → §9.1(B).

### 9.1 Snapshot Import — "production state 재현 / what-if 분석"

사용자가 production 로그의 JSON snapshot을 붙여넣으면 Studio가 그 상태를 그대로 복원해서 시각화 + 거기서부터 액션을 (가상으로) 흘려볼 수 있게 하는 기능.

**Feasibility 검토 결과**

- SDK는 `getCanonicalSnapshot()`로 이미 직렬화 가능한 JSON snapshot을 내보냄 (`CanonicalSnapshot<T["state"]>`).
- Extensions surface는 **arbitrary-snapshot read를 이미 지원**: `simulateSync(snapshot, intent)`, `explainIntentFor(snapshot, intent)`, `getAvailableActionsFor(snapshot)`, `createSimulationSession(snapshot)` (`@manifesto-ai/sdk/dist/extensions-types.d.ts:14-20`).
- 단, `activate()`가 `initialSnapshot` 파라미터를 **안 받음** — 활성화된 런타임의 state를 실제로 바꿔 끼는 path는 SDK 변경 필요.

**두 경로**

**9.1.A — Pinned-snapshot read-only mode (SDK 변경 없음, 바로 가능)**
  - Studio 쪽에만 "pinned snapshot" 상태 추가. 활성화 시 Observatory / Inspect가 `projectSnapshot(pinnedCanonical)`로 렌더, Interact의 dispatch는 `extensionKernel.simulateSync(pinned, intent)`로 라우팅.
  - 사용자 시나리오: production snapshot 붙여넣기 → 상태 시각적 검증 → 거기서 가상 액션 흘려보기 (what-if).
  - 작업 범위: `studio-core`에 `kernelForSnapshot(canonical)` wrapper + UI 토글 ("Imported state" 배너) + LensPane 라우팅 가드.

**9.1.B — 진짜 restore (SDK 팀과 조율 필요)**
  - SDK에 `activate({ initialSnapshot })` 또는 `runtime.setCanonicalSnapshot(canonical)` seam 추가 요청.
  - `@manifesto-ai/host` 쪽은 `initialData: extractDefaults(schema.state)` 경로를 snapshot-driven으로 확장.
  - 이쪽이 되면 lineage tracker도 "imported world"로 자연스럽게 기록 가능 (이미 `lineage.record`는 canonicalSnapshot 받음).

**우선순위**: 9.1.A부터. 사용자 반응이 "production 버그 재현에 쓴다"가 되면 9.1.B로 확장. 9.1.A만으로도 지원 엔지니어링 / 도메인 리뷰 UX에 즉효.

### 9.2 Test-as-trace Export — "Studio 세션 → Vitest spec"

Studio에서 돌린 dispatch 시퀀스를 `.test.ts` 파일로 export. 그 파일을 그대로 CI에 넣으면 도메인 회귀 테스트.

**Feasibility 검토 결과**

- `createStudioCore + createHeadlessAdapter` 파이프라인이 **이미 test fixture 구조와 동일** — `packages/studio-adapter-headless/src/__tests__/smoke.test.ts`(40줄)가 정확히 타겟 템플릿.
- `StudioProvider.dispatchHistory`가 각 dispatch의 `intentType`, `schemaHash`, `status`, `changedPaths`, `diffs`를 이미 capture (`packages/studio-react/src/StudioProvider.tsx:74-85`).
- MEL source + 최종 snapshot + 단계별 before/after diff 모두 이미 접근 가능.

**한 가지 gap**

- `DispatchHistoryEntry`가 `intent.input`을 저장 안 함 (`StudioProvider.tsx:216-247` — `intent.type`만 capture). 테스트 재생에 input이 필요. **한 줄 추가로 해결**.

**결정론 주의**

- `$system.uuid`, `$system.timestamp`, `$system.isoTimestamp` 주입이 있는 action(예: `todo.mel`의 `addTodo`)은 재생 시 uuid가 달라져 snapshot 동등성이 깨짐.
- 생성 전략: (a) 구조적 assertion만 내보내기(`todos.length === 1`, `title === "first"` — smoke test와 같은 패턴), 또는 (b) SDK에 test-mode seed option 요청. (a)가 훨씬 가벼움.

**작업 범위**
- `StudioProvider`의 `recordDispatch`에 `input: intent.input` 추가
- `exportAsTest(history, source): string` 생성기 (문자열 템플릿)
- ProjectSwitcher 또는 Dispatches 렌즈에 "Export as test" 액션

**우선순위**: High — 구현 난이도 낮고, 실제로 "시각적 탐색이 회귀 테스트가 된다"는 메시지는 강력함.

### 9.3 MEL Agent Integration — "이미 가능, 문서/예제만 필요"

LLM 에이전트가 MEL을 쓰고, Studio가 에이전트의 edit → build → simulate → dispatch 피드백 루프가 되는 시나리오.

**Feasibility 검토 결과**

**이미 모든 API가 준비됨** — 에이전트는 Node에서 완전 headless로 루프 가능.

| 에이전트 필요 기능 | 제공 API |
|---|---|
| source edit + build | `adapter.setSource()` + `core.build()` |
| structured diagnostics | `core.getDiagnostics(): Marker[]` (severity/message/span/code) — `adapter-interface.ts:6-11` |
| list actions | `core.getModule().schema.actions` |
| simulate before commit | `core.simulate(intent)` → changedPaths, requirements |
| structured blockers | `core.whyNot(intent)` → `DispatchBlocker[]` (layer/expression/description) |
| dispatch + report | `core.dispatchAsync(intent)` → StudioDispatchResult |
| get snapshot (live + canonical) | `core.getSnapshot()` / SDK의 `getCanonicalSnapshot()` |
| stable world id per dispatch | `core.getLatestHead()` / `core.getLineage()` |

**두 아키텍처**

**9.3.A — Agent as Node library (zero new code)**
  - 에이전트가 `@manifesto-ai/studio-core` + `@manifesto-ai/studio-adapter-headless`를 Node 디펜던시로 import. 완전 headless 루프 돌리고 결과만 읽음.
  - SDK / studio-core 변경 **전혀 필요 없음**. 바로 시작 가능.
  - 필요한 결과물: 예제 repo + 블로그 포스트 "Building a MEL agent with Manifesto Studio Core". 30줄짜리 end-to-end 예제.

**9.3.B — Agent drives the live Webapp (Phase 2)**
  - 에이전트가 브라우저 내 Studio와 대화 (페어 프로그래밍 UX).
  - 필요 작업: webapp에 postMessage/WebSocket seam, agent edit을 Monaco에 반영, diagnostic/snapshot을 주기적으로 송신.
  - 2-3일 작업. 하지만 B는 UX 기능이고, 에이전트 개발 자체엔 불필요.

**우선순위**: 9.3.A는 **코드 작업 없음** — 문서 + 예제 repo만. 9.3.B는 §8 (Agent-first Studio) 작업과 크게 겹치므로 §8 진행에 녹여넣기.

---

## 우선순위 요약 (§9)

1. **§9.2 Test-as-trace export** — 구현 낮음, 메시지 강력, 즉시 가능
2. **§9.1.A Pinned-snapshot read-only mode** — SDK 손 안 대고 production 재현 UX 확보
3. **§9.3.A Agent as Node library** — 코드 없음, 문서/예제만
4. **§9.1.B Real snapshot restore** — SDK 팀 조율 후, §9.1.A 사용자 반응 보고 결정
5. **§9.3.B Live-webapp agent** — §8 작업에 흡수
