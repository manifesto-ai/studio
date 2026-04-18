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
