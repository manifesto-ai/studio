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
