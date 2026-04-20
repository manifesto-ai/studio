# Manifesto Studio UX 철학 문서

> **상태**: Phase 1 최종 초안
> **작성일**: 2026-04-19
> **선행 자료**: `core/docs/mel/REFERENCE.md`, `core/docs/internals/adr/016`·`017`·`019`, `core/docs/api/sdk.md`
> **대상**: 이 프레임워크의 의미론은 알지만 Studio UI를 본 적 없는 독자.

이 문서는 Studio UX의 **북극성**이다. 기능을 더하는 것이 목적이 아니라, 이미 존재하는 것 하나하나가 Manifesto만의 주장을 **능동적으로 증거하도록** UI를 재정렬하는 것이 목적이다.

Studio는 지금도 동작한다. 그러나 방문자가 보는 화면은 "조금 더 엄격한 XState + 워크플로우 DSL IDE"로도 해석 가능하다. 이것은 전략적 손실이다. 이 문서는 그 손실을 회수하기 위한 계약이다. 픽셀 하나하나가 "이것은 어떤 Manifesto 주장을 증거하는가?"라는 물음에 응답해야 한다.

---

## 1. 다섯 기둥 (Five Pillars)

각 기둥은 철학적 주장이면서 동시에 UI 의무다. 런타임에 없는 것을 UI가 주장하는 것은 기만이고, 런타임에 있는 것을 UI가 침묵하는 것은 낭비다.

### 1.1 Pillar 1 — Harness > Guardrail

- **Claim**: 합법성은 "행위 금지"가 아니라 **구조적 불가능**이다. 호출 불가능한 액션은 "비활성화된 버튼"이 아니라 **호출 가능한 표면 자체에 존재하지 않는다**.
- **Evidence in runtime**: `available when`은 입력 없이 coarse availability를 판정한다. `getAvailableActions()`는 현 스냅샷에서 합법인 액션 이름만 반환한다. MEL REFERENCE §6.4는 `available when`에서 `$input`, `$meta`, `$system`을 명시적으로 금지한다 — 가용성은 **입력에 의존하지 않는 구조적 속성**이다.
- **UI obligation**: 주 액션 표면(액션 셀렉터, 디스패치 버튼, Observatory 그래프의 노드 호버 컨트롤)은 `getAvailableActions()`의 결과만 표시한다. `available when`이 false인 액션은 "어딘가 회색으로" 놓이는 것이 아니라, **다른 의미 영역**에 놓인다.
- **Anti-pattern**: 모든 액션을 항상 드롭다운에 나열하고 가용 여부를 `disabled` 속성으로만 표현하는 UI. 이것은 Manifesto를 "선언적 validation 래퍼"로 오해시킨다. XState의 `guard`와 구조적으로 구별되지 않는다.
- **MVP status**: **partial**. `InteractionEditor`의 액션 `<select>`는 `schema.actions` 전체를 나열한다. `BlockerList`가 사후에 `available: false`를 설명하지만, 그 시점에 이미 사용자는 "이 액션은 호출 가능한 후보"라고 학습해버린 상태다.

### 1.2 Pillar 2 — Simulate-first

- **Claim**: 모든 쓰기는 결정론적 preview를 **선행**한다. 현재가 바뀌기 전에 미래가 먼저 보인다.
- **Evidence in runtime**: `simulate()`는 SDK 활성 런타임 표면의 **일급 시민**이다 (`sdk.md` §"Static Graph And Dry-Run Introspection"). `simulate → dispatchAsync` 순서는 SDK가 직접 권장한다 ("The intended legality ladder"). 결과 스냅샷, `changedPaths`, `newAvailableActions`, `requirements`가 모두 커밋 전에 얻어진다. ADR-019의 Extension Kernel은 임의 스냅샷에 대한 dry-run을 **관찰적으로 순수**한 작업으로 공식화했다.
- **UI obligation**: write verb 버튼(Dispatch, Commit, Propose)은 **해당 입력 바인딩에 대해 현재 해결된 simulate preview가 존재할 때만** 활성화된다. 입력이 수정되면 simulate 결과는 무효화되고 버튼은 다시 비활성화된다.
- **Anti-pattern**: "Simulate"와 "Dispatch"가 나란히 배치되어 사용자가 선택적으로 고를 수 있는 UI. 이것은 simulate를 "선택적 디버깅 도구"로 격하시키고 Manifesto의 가장 강력한 주장 중 하나를 장식으로 만든다.
- **MVP status**: **partial**. `SimulatePreview` 컴포넌트는 존재하지만 Dispatch 버튼은 simulate 없이도 클릭 가능하다.

### 1.3 Pillar 3 — Three-Layer Legality

- **Claim**: `available` → `dispatchable` → `outcome`은 **존재론적으로 구분되는 세 계층**이다. 동의어가 아니다. `available`이 거절된 액션과 `dispatchable`에서 거절된 intent는 서로 다른 부류의 실패다.
- **Evidence in runtime**: MEL REFERENCE §6.4–6.5. ADR 020 (intent-level dispatchability). SDK는 `DispatchBlocker`에 `layer: "available" | "dispatchable"` 필드를 실제로 담아 반환한다. `explainIntent()`의 반환 타입은 `kind: "blocked" → available: boolean`으로 두 계층을 explicit하게 분기한다. SDK §"Intent Explanation"은 거절 코드 `ACTION_UNAVAILABLE`, `INVALID_INPUT`, `INTENT_NOT_DISPATCHABLE`을 stable public contract로 선언했다.
- **UI obligation**: blocker는 결코 한 통에 뒤섞이지 않는다. `available` 블로커와 `dispatchable` 블로커는 시각적·문법적으로 분리된다. 실패는 **실패할 순서대로** 표시된다. 상위 계층이 해결되기 전에는 하위 계층의 블로커는 "아직 평가되지 않음"으로 demoted된다 (숨기지 않는다 — 사용자는 나중에 학습할 것을 미리 인지할 수 있어야 한다).
- **Anti-pattern**: 모든 실패 이유를 `reason: string` 하나로 flatten해 보여주는 토스트. XState나 Zod 에러 처럼 "validation failed"로 뭉치는 순간, Manifesto의 계층 구분은 사라진다.
- **MVP status**: **partial**. `BlockerList`는 `LayerBadge`로 계층을 표시하지만 한 리스트 안에 뒤섞여 있고, 시뮬레이션 실패 시 어느 계층에서 short-circuit 되었는지 **순차 서사**로 보여주지 않는다.

### 1.4 Pillar 4 — Time is First-Class

- **Claim**: 상태는 가변 셀이 아니라 Merkle DAG의 한 점이다. 정체성은 `schemaHash + snapshotHash + parentWorldId`. 동일한 현재 내용을 갖더라도 부모가 다르면 **다른 존재**다 (Phineas Gage 원리).
- **Evidence in runtime**: ADR-016. WorldId 계산식에 `parentWorldId`가 포함된다. `BranchInfo`는 `head`와 `tip`을 분리해 가지며 전자는 completed seal에서만, 후자는 모든 seal에서 전진한다. `SealAttempt`는 매 시도마다 기록되고 `reused` 플래그로 idempotent reuse를 드러낸다.
- **UI obligation**: 히스토리 UI는 "시간 순 로그"가 아니라 **DAG**로 렌더된다. `tip`과 `head`는 시각적으로 구별되는 포인터다. 같은 `snapshotHash`를 공유하는 여러 World는 **같은 박스로 뭉뚱그려지지 않고** 각자의 `parentWorldId`로 구분되는 별개 노드로 표시된다. Branch/reuse는 명시적 형상으로 드러난다.
- **Anti-pattern**: `HistoryTimeline`을 flat한 commit log로 렌더해 "state A → state B → state C" 선형 나열로 보여주기. 이것은 Manifesto를 Redux DevTools나 Temporal 히스토리 뷰어와 식별 불가능하게 만든다.
- **MVP status**: **silent**. 현재 `HistoryTimeline`은 `EditIntentEnvelope`(schema 편집 이벤트) 로그이며 Merkle World 체인이 아니다. `tip`/`head`/`parentWorldId`/`SealAttempt` 어떤 것도 UI에 존재하지 않는다.

### 1.5 Pillar 5 — Provable, not Plausible

- **Claim**: MEL이 Non-Turing-complete이기 때문에 reachability, guard failure, impact range에 대한 정적 주장은 **증명 가능**하다. UI는 증명할 수 없는 주장을 하지 않는다.
- **Evidence in runtime**: MEL REFERENCE §1 "What MEL is NOT" — 반복문·사용자 함수·변수·reduce 없음. 모든 가드는 컴파일러가 AST로 보유한다. `DispatchBlocker.expression`은 이미 구조화된 AST이고 `BlockerList.summarizeExpr`는 그것을 pretty print한다. Simulate의 `changedPaths`는 정적으로 유도된 집합이지 heuristic 샘플링이 아니다.
- **UI obligation**: UI가 반사실적 힌트("만약 `state.x == 1` 이면 통과합니다")를 보일 때는 **컴파일러가 보유한 guard AST를 정적으로 해독**해서만 보인다. LLM 요약이나 heuristic 추정은 금지. 해독 불가능한 가드에 대해서는 **침묵**이 올바른 UX다. `deterministic` 배지는 "무엇이 결정적인가"를 런타임 사실에 근거해 설명해야 한다.
- **Anti-pattern**: 자연어 요약 AI를 붙여 "이 액션이 실패한 이유는 대략 …입니다" 같은 해석을 내놓는 UI. 정확성이 아무리 높아도 **증명되지 않았다**는 점에서 Pillar 5를 배신한다.
- **MVP status**: **partial**. `BlockerList`는 AST 요약을 보여주고 TopBar의 `DeterminismIndicator`는 determinism을 표시하지만, 후자는 "왜 결정적인지"를 설명하지 않고 전자는 "어떤 상태가 바뀌면 통과할지"로 확장되지 않는다.

---

## 2. UI Atomic Rules

각 규칙은 기둥에서 도출되고, 각 규칙은 테스트 가능하다 ("이 UI 상태에서 이 요소가 존재/부재하는가?"라는 질문으로 자동화 가능). 규칙은 서로 모순되지 않으며, 구현 시 기둥 번호와 규칙 ID를 commit 메시지에 인용한다.

### 2.1 Pillar 1에서 도출

- **Rule H1** — `available when`이 false인 액션은 주 액션 표면(액션 셀렉터, Observatory 그래프 액션 노드의 primary affordance)에 **표시되지 않는다**. 별도의 "currently impossible" 레지스터로 이동하고, **어떤 상태 변화가 일어나면 가능해지는가**를 함께 서술한다.
- **Rule H2** — 액션 셀렉터의 "사용 불가 레지스터"는 접근 가능하되 **default collapsed**다. 기본 노출 영역은 "지금 할 수 있는 일"뿐이다.
- **Rule H3** — 디스패치 표면의 DOM은 `available when` 집합으로부터 직접 유도된다. 클라이언트 측 필터 루프를 통한 런타임 계산이 아니라 `getAvailableActions()` 반환값의 직접 렌더다. (불가능성이 구조라는 주장을 구현 수준에서 반복한다.)

### 2.2 Pillar 2에서 도출

- **Rule S1** — write verb 버튼은 해당 바인딩된 intent에 대해 **현재 해결된 simulate preview가 존재할 때만** 활성화된다.
- **Rule S2** — 입력 필드 변경은 simulate 결과를 즉시 stale로 표시하고 write verb 버튼을 비활성화한다. stale 상태는 `SimulatePreview`를 숨기지 않고 "입력이 변경됨 — 재시뮬레이트 필요" 배너와 함께 demoted 렌더한다.
- **Rule S2a** — `SimulatePreview`가 보여주는 before/after 구분은 **색상으로 암시**가 아니라 **명시적 레이블**로 표시한다 ("현재" / "시뮬레이트된 미래"). 미래가 현재보다 먼저 보이는 경험을 글자 그대로 구현한다.
- **Rule S3** — 시뮬레이션 결과의 `requirements` (호스트 효과 요구)는 "이 intent를 현재 commit하면 런타임이 수행할 부수 효과 목록"임을 명시한다. 효과는 숨겨진 구현이 아니라 **커밋 전에 사용자가 합의해야 할 계약**으로 제시된다.

### 2.3 Pillar 3에서 도출

- **Rule L1** — `available` blocker와 `dispatchable` blocker는 **같은 리스트 안에 혼재하지 않는다**. 두 계층 모두 실패해야 할 조건이더라도, 런타임이 short-circuit하는 순서대로 표시되고 하위 계층은 상위 계층이 해결되기 전까지 demoted 렌더된다.
- **Rule L2** — `available`이 실패했을 때의 프레이밍은 "이 액션은 현재 호출 가능한 표면에 존재하지 않습니다"이다. "disabled"나 "locked"가 아니다. `dispatchable`이 실패했을 때는 "이 특정 intent는 거절됩니다; 동일 액션은 다른 입력으로 여전히 호출 가능합니다"이다.
- **Rule L3** — `INVALID_INPUT`은 `dispatchable`과 혼동되지 않는다. SDK는 INVALID_INPUT을 dispatchability 평가 이전에 throw하므로 (sdk.md §"Intent Explanation"), UI는 input validation 실패를 **별도 레이어**로 렌더한다. 세 종류의 거절(`ACTION_UNAVAILABLE`, `INVALID_INPUT`, `INTENT_NOT_DISPATCHABLE`)은 각자의 서사를 갖는다.

### 2.4 Pillar 4에서 도출

- **Rule T1** — 히스토리 뷰는 선형 리스트가 아니라 **DAG 시각화**다. 최소한 노드(World), 엣지(WorldEdge), 현재 `tip`/`head` 포인터가 시각적으로 구별된다.
- **Rule T2** — 동일한 `snapshotHash`를 갖지만 `parentWorldId`가 다른 두 World는 **다른 노드**로 렌더된다. 뭉뚱그리면 Pillar 4를 직접 위반한다.
- **Rule T3** — `head`와 `tip`의 구분은 시각적이고 도구 설명이 제공된다. "head는 신뢰할 수 있는 최신 상태, tip은 가장 최근에 기록된 사건 (실패 포함)." 사용자가 두 포인터가 왜 분리되는지를 UI에서 배울 수 있어야 한다.
- **Rule T4** — 모든 World 노드는 hover/클릭 시 `parentWorldId` 체인을 보여준다. `SealAttempt` 정보(createdAt, proposalRef, reused 플래그)는 노드 상세 패널에서 접근 가능하다.

### 2.5 Pillar 5에서 도출

- **Rule P1** — 반사실적 힌트는 guard AST를 정적으로 해독해서만 제공한다. 해독 불가능한 가드(예: 복합 aggregation 참조)에 대해서는 **아무 말도 하지 않는다**. heuristic이나 LLM 요약은 금지.
- **Rule P2** — `DeterminismIndicator`는 hover 시 "이 세션에서 determinism이 의미하는 바"를 한 문장으로 설명한다. 문구는 SDK 사실로부터 도출되어야 한다 (예: "MEL이 Non-Turing-complete이므로 이 스냅샷의 모든 합법성 판정은 재현 가능합니다"). 새로 만들어낸 카피가 아니라 런타임 계약의 직접 인용이다.
- **Rule P3** — Simulate 결과의 `changedPaths`는 "정적으로 유도된 상태 경로"임을 명시한다. 배지 또는 주석으로 "이 목록은 완전하다"는 사실을 UI가 주장할 수 있어야 한다. 비-MEL DSL의 "예상 영향 범위"와의 차이를 사용자가 학습하게 한다.

---

## 3. 스크린 레벨 매핑

현재 Studio는 3개의 주요 영역(SOURCE, OBSERVATORY, INTERACT)과 부가 lens들(SNAPSHOT, PLAN, HISTORY, DIAGNOSTICS)로 구성되어 있다. 각 영역을 다섯 기둥 관점에서 평가한다.

### 3.1 SOURCE (Monaco MEL 에디터)

- **현재 주장하는 기둥**: Pillar 5 (부분). MEL 언어 자체의 존재는 "이 언어는 제한되어 있다"는 사실을 암시적으로 전달한다. `DiagnosticsPanel`은 정적 컴파일러 경고를 표시한다.
- **침묵하는 기둥**: 1, 2, 3, 4. SOURCE는 언어 레벨에서만 작동하므로 런타임 합법성에 대해 말하지 않는다. 합리적이다.
- **최고 영향력 한 가지 변경**: 에디터 거터에 "이 액션의 `available when` 조건이 현재 스냅샷에서 충족됨/미충족"을 정적으로 표시하는 **라이브 합법성 주석**. 소스와 런타임 상태를 한 화면에서 연결해 Pillar 5를 더 적극적으로 주장한다. 단, 계산은 컴파일러의 guard AST + 현재 canonical snapshot으로 순수하게 수행되어야 한다 (Rule P1).

### 3.2 OBSERVATORY (LiveGraph + ActionDispatchPopover + SimulationPlayback)

- **현재 주장하는 기둥**: Pillar 4 (매우 부분). 스키마 그래프는 state/computed/action의 위상 관계를 보여주지만 **시간적 DAG은 아니다** — 이것은 정적 스키마 그래프다. `SimulationPlayback`은 Pillar 2에 약하게 기여한다.
- **침묵하는 기둥**: Pillar 1 (노드 호버 시 가용 액션 필터링 없음), Pillar 4 (Merkle DAG 없음).
- **최고 영향력 한 가지 변경**: Observatory를 **스키마 그래프 + Merkle DAG 오버레이** 이중 모드로 확장. 기본 뷰는 현 스키마 그래프이지만 "time" 토글을 켜면 World 노드의 DAG와 `tip`/`head` 포인터가 같은 캔버스에 나타난다. 구조(스키마)와 역사(lineage) 모두가 Manifesto의 정체성 모델임을 시각적으로 주장한다.

### 3.3 INTERACT (InteractionEditor → ActionForm + SimulatePreview + BlockerList)

- **현재 주장하는 기둥**: Pillar 2 (부분 — SimulatePreview 존재), Pillar 3 (부분 — LayerBadge 존재), Pillar 5 (부분 — guard AST 요약).
- **침묵하는 기둥**: Pillar 1 (액션 셀렉터가 불가능한 액션을 여전히 후보로 제시), Pillar 2 강제 (simulate 없이도 dispatch 가능).
- **최고 영향력 한 가지 변경**: **Intent Insight를 "legality ladder demonstrator"로 승격**. 현재 개별 섹션으로 흩어진 Legality/Impact/Requirements를 수직 5단 사다리로 재구성: `available → input-valid → dispatchable → simulated → admitted`. 각 단은 `passed / blocked-here / not-yet-evaluated` 상태를 가진다. INTERACT 한 화면에서 다섯 기둥 중 네 개 (1, 2, 3, 5)를 동시에 주장할 수 있다. 이것이 Phase 2의 주요 과제다.

---

## 4. 기각한 대안 (Rejected Alternatives)

### 4.1 "Studio를 디버거로 취급한다" (기각)

Chrome DevTools나 Redux DevTools의 idioms를 전면 채택해 time-travel, inspector, breakpoint 중심으로 재구성하는 방향. 기각 이유: 디버거는 **사후 진단** 도구다. Manifesto의 핵심은 **사전 합법성**과 **시뮬레이트 우선**이다. 디버거 metaphor를 채택하는 순간, 사용자는 "먼저 실행하고 나중에 본다"는 Redux-식 멘탈 모델로 회귀한다. Pillar 2(Simulate-first)와 Pillar 1(Harness)이 침묵당한다. Redux DevTools와 구별 불가능한 Studio는 전략적 실패다.

### 4.2 "최종 사용자 우선, 에이전트는 나중" (기각)

Studio를 인간 엔드유저(코딩을 배우는 개발자)를 일차 청중으로 설계하고 LLM 에이전트 통합은 후순위로 두는 방향. 기각 이유: Manifesto의 차별점 중 하나는 **에이전트가 SDK를 직접 소비할 때 얻는 합법성 구조**다. Agent-friendly UX (structured explanation, deterministic preview, typed affordance)는 곧 human-friendly UX의 상위 집합이다. 역은 성립하지 않는다. 인간 UX를 먼저 최적화하면 튜토리얼·토스트·감성적 피드백처럼 에이전트에 노이즈가 되는 요소가 누적된다. 두 청중을 같은 계약(structured output)으로 동시에 겨냥하는 것이 더 저렴하다.

### 4.3 "XState 스타일의 statechart 시각화를 전면 채택" (기각)

Observatory를 XState visualizer처럼 state node + transition edge 중심으로 재설계. 기각 이유: XState의 statechart는 **하나의 뷰**다. Manifesto는 state(스키마) + lineage(Merkle) + availability(intent) 라는 세 종류의 그래프를 갖는다. XState의 시각화 언어를 빌려오면 나머지 둘(특히 Pillar 4 Merkle DAG)이 XState의 statechart 안에 억지로 끼워진다. Observatory가 "XState-clone"으로 보이는 것은 Pillar 1, 4를 동시에 배신한다.

### 4.4 "redux-devtools idioms 전면 채택" (기각)

왼쪽 패널에 action 로그, 오른쪽에 state diff, 상단에 time slider. 기각 이유: 4.1과 같은 이유에 추가해, redux-devtools는 **직렬 시간**을 가정한다. Manifesto의 시간은 분기하는 DAG이다. time slider는 Pillar 4를 기술적으로 왜곡한다. 또한 redux-devtools idioms는 Manifesto의 "intent는 먼저 합법성 사다리를 통과해야 존재한다"는 주장을 희석시킨다 — dispatched된 것만 로그된다는 가정 때문이다.

### 4.5 "LLM 요약을 blocker에 더해 친절한 UX를 만든다" (기각)

각 blocker에 "이 액션이 실패한 이유는 X입니다" 같은 자연어 요약을 LLM으로 덧댄다. 기각 이유: Pillar 5 직접 위반. LLM 요약은 **그럴듯**하지만 **증명되지 않는다**. 정확도 99%여도 남은 1%는 Manifesto의 강점(정적 증명) 자체를 무효화한다. 사용자가 "이 UI는 때때로 틀릴 수 있다"를 한번이라도 학습하면 Pillar 5의 모든 주장이 의심받는다. 요약이 필요하다면 그것은 컴파일러의 guard AST 직접 해독에서 도출되어야 한다.

---

## 5. Deferred — requires SDK work

아래 항목들은 기둥에서 자연스럽게 도출되는 UI 의무지만 현재 SDK 표면만으로는 구현 불가능하다. **코드로 끼워 넣지 않는다** — SDK 작업으로 처리되어야 한다.

- **D1** (Pillar 4): Merkle DAG 조회. 현재 SDK base runtime은 `getSnapshot` / `getCanonicalSnapshot`만 노출한다. `tip`, `head`, `WorldEdge`, `SealAttempt` 조회는 lineage-decorated runtime에서 제공되지만 Studio Core가 현재 이를 래핑하는지 불확실. Pillar 4의 UI를 본격 구현하려면 `@manifesto-ai/lineage`의 query 계약을 Studio에 통합해야 한다.
- **D2** (Pillar 1): `available when` guard의 **반사실적 counterfactual API**. 현재 SDK는 `whyNot(intent)`로 실패 blocker를 반환하지만, "이 블로커를 통과시키려면 어떤 상태 변화가 필요한가"를 API 레벨로는 제공하지 않는다. Rule P1을 만족하려면 컴파일러의 guard AST를 Studio에서 직접 분석해야 한다 — SDK 변경 없이 구현 가능하되, AST 접근 경로가 **public**이어야 한다. 현재 `DispatchBlocker.expression`이 그 역할을 일부 담당 중이나 전체 guard expression이 아니라 실패한 sub-expression일 수 있음을 확인해야 한다.
- **D3** (Pillar 5): `DeterminismIndicator`의 런타임 근거. 현재 TopBar의 "deterministic" 라벨은 diagnostics 상태에 기반한 **heuristic** 파생이다. determinism이 Non-Turing-complete MEL에서 유래한다는 주장을 UI가 하려면 schema 레벨에서 "이 도메인의 모든 guard가 정적 분석 가능한가"를 반환하는 API가 필요할 수 있다 (또는 컴파일러가 항상 그것을 보장한다면 단순 상수로 충분).

---

## 6. 구현 원칙 요약

- 기둥은 쌓이지 않는다. 각 픽셀은 한 번에 한 기둥만 명확히 주장할 수도 있고, 네 개를 동시에 주장할 수도 있다. 그러나 **아무 기둥도 주장하지 않는** 픽셀은 Manifesto UI에 존재할 이유가 없다.
- 침묵이 올바른 선택일 때가 있다. 증명 불가능한 주장을 늘어놓는 것보다 말하지 않는 것이 Pillar 5에 충실하다.
- 신규 SDK 표면이 필요하다고 결론 난 규칙은 Deferred 섹션에 남긴다. 문서에서 암묵적으로 SDK 변경을 제안하지 않는다.
- Phase 2는 INTERACT 영역의 Intent Insight에 집중한다. 단일 영역에서 네 기둥을 동시에 주장할 수 있기 때문이다 (§3.3). Observatory(Pillar 4)와 SOURCE(Pillar 5)는 각자의 Phase를 갖는다.

---

*이 문서는 contract이다. Phase 2의 코드는 이 contract의 performance다. 이 문서와 코드가 충돌할 경우, 선택지는 두 가지다: (1) 규칙을 개정하고 이유를 기록한다. (2) 코드를 고친다. 조용히 scope를 확대하지 않는다.*
