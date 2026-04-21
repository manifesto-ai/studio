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

### 5.1 Sparse-optional payload의 simulate() 실패 (의심)

- 증상: `type Payload = { title: string, note?: string }` 같은 optional 필드를 갖는 action에 대해 sparse form value(`{title: "hello"}`, note 생략)로 `simulate()` 호출 시, `simulate()`가 throw하거나 `admitted` 가 아닌 결과를 반환하는 것으로 관찰됨. 동일한 sparse intent의 `dispatchAsync()`는 성공 (기존 regression 테스트로 검증).
- 재현: `packages/studio-react/src/InteractionEditor/__tests__/InteractionEditor.test.tsx` → "dispatches sparse optional payloads" 테스트. 현재 이 테스트는 `<InteractionEditor enforceSimulateFirst={false} />` 로 Rule S1을 opt-out하여 dispatch 경로만 검증한다. Rule S1을 enforce하면 `expect(dispatchBtn.disabled).toBe(false)`에서 실패 (disabled=true).
- 원인 가설: `createIntentArgsForValue` 또는 SDK `createIntent()`가 sparse object를 intent input으로 packing하는 방식이 simulate 경로에서만 문제를 일으킴. 또는 `simulate()` 내부의 canonical snapshot projection 단계에서 undefined 필드 접근 에러.
- 영향: `InteractionEditor.enforceSimulateFirst` prop의 escape hatch가 이 버그 해결까지 유지되어야 함. 해결 후 해당 테스트를 다시 Rule S1 경로로 전환 + prop 제거.
- 우선순위: Medium — production에서 optional 필드를 포함한 schema를 빌드하는 순간 사다리 Step 4가 스스로 블록됨. 유저가 "왜 Dispatch가 안 열리지" 상태로 멈춤.

### 5.2 Pillar 1 (Harness > Guardrail)의 Studio UI 구현

- 현재 상태: 철학 문서 Rule H1/H2/H3 전체 미구현. 액션 셀렉터가 `getAvailableActions()` 필터를 적용하지 않고 `schema.actions` 전체를 나열.
- 필요 작업: 셀렉터를 두 레지스터로 분할 — "지금 할 수 있는 일" (default 열림) + "현재 불가능" (default 접힘, 각 액션에 대해 `available when` guard의 정적 counterfactual 동반).
- 의존: Rule H3은 SDK 반환을 DOM에 직접 매핑해야 함 — 현재 `useStudio` 훅이 `getAvailableActions`를 노출하는지 확인 후 진행.
- 우선순위: High — Pillar 1이 철학 문서에서 가장 강한 주장이면서 UI 침묵이 가장 심함.

### 5.3 Pillar 4 (Time is first-class)의 Studio UI 구현

- 현재 상태: 완전 silent. `HistoryTimeline`은 schema edit log이지 Merkle World 체인이 아님.
- 의존: `docs/studio/ux-philosophy.md` §5 Deferred D1 — Studio Core가 lineage-decorated runtime을 wrapping해야 함. 현재 base runtime만 사용.
- 우선순위: High after D1 해결.

---

## 6. Cluster-aware LiveGraph 후속 (Phase 2/3)

Phase 1 (`detectClusters` + cluster-aware column layout + dashed 경계)이 landing됨. 다음은 사용자 요청으로 백로그 이관.

### 6.1 Collapsible cluster (Phase 2)

- 목적: cluster 당 헤더를 추가해 클릭 시 내부 전체 카드를 하나의 축약 "supernode" 카드로 접고, 재클릭 시 펼침.
- 설계 스케치:
  - `useState<Set<ClusterId>>` 로컬 관리(collapsed set).
  - 접힌 cluster의 member 카드는 렌더 스킵, supernode 1개를 cluster rect 중앙에 렌더.
  - 외부(다른 cluster 또는 orphans)에서 들어오는/나가는 edge는 supernode 앵커로 redirect.
  - 내부 edge는 숨김.
- Tradeoff: 상태 관리 + edge redirect 로직 추가. 상호작용 디자인(hover vs click, shift+click로 전체 collapse 등) 필요.
- 우선순위: Medium — Battleship 같이 cluster가 3–4개 있는 시나리오에서 체감 효과 큼. 작은 도메인(todo)에서는 over-engineering 위험.

### 6.2 Hierarchical edge bundling (Phase 3)

- 목적: 같은 source-cluster → target-cluster edges를 trunk 하나로 수렴시켜 시각 소음 감소.
- 설계: Holten 2006 방식의 간이 구현 — cluster 중심으로의 control point를 bezier에 주입해 edges가 가운데로 휘도록. hover 시 해당 edge만 untangle.
- Tradeoff: SVG path 계산 복잡도 moderate. EdgeLayer를 확장하거나 별도 `BundledEdgeLayer` 도입.
- 의존: Phase 2와 독립적으로 구현 가능. Phase 1 출력(ClusterMap)만 있으면 됨.
- 우선순위: Low — Phase 1/2 이후 여전히 edge 밀도가 문제로 남으면 착수.

### 6.3 Cluster 알고리즘 튜닝

- Jaccard threshold 0.3이 battleship 실사용에서 어떻게 보이는지 관찰 후 조정.
- `reset` 같은 universal action이 너무 많은 cluster를 묶는 경우 "degree > N 이상 action은 bridge로 제외" 같은 heuristic 추가 검토.
- 현재는 action share만 봄. computed dependency가 실제 cluster membership과 어긋나는 경우(예: unused computed)에 대한 처리 검토.
