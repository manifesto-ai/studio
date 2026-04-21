# Studio Editor — Phase 1 Roadmap

> **Status:** 🚀 **Active — kickoff (2026-04-17)**
> **Date:** 2026-04-17
> **Ref:** [phase-1-proposal.md](./phase-1-proposal.md) (ratified), [studio-backlog.md](./studio-backlog.md)
> **Duration:** 4주 본 + 1주 버퍼 (최대 5주)
> **Phase 0 closure:** 62 tests / 14 files green · Mandatory SC-1~7 + Optional SC-8~10 전부 GO

이 문서는 Phase 1 실행 체크리스트이다. Phase 1 proposal이 *무엇과 왜*를 결정하고, 본 문서는 *언제와 무엇을*을 추적한다. 목표 ID(P1-G*), 규범 ID(SE-UI-*), Success Criteria ID(P1-SC-*), Open Question ID(P1-OQ-*)는 proposal과 1:1 매핑한다.

---

## 0. 확정된 결정 (착수 전 합의 완료)

### 0.1 Phase 0 동결
- [x] `proposal.md` immutable 도장 — Phase 0 contract 변경 불가
- [x] `ROADMAP.md` (Phase 0) 완료 도장
- [x] 62 tests / 14 files green 상태로 `main`에 push

### 0.2 Phase 1 스코프
- [x] Primary: P1-G1 Monaco 어댑터, P1-G2 Base React 패널, P1-G3 **D3 SchemaGraphView**, P1-G4 **InteractionEditor**, P1-G5 production webapp, P1-G6 sdk publish + link 제거
- [x] Secondary: P1-G7~G10
- [x] Tertiary: P1-G11~G12
- [x] **D3 그래프와 인터렉션 에디터는 첫 공개 필수**로 확정 (proposal §0 TL;DR)

### 0.3 배포 타깃
- [x] `studio.manifesto-ai.dev` — 공식 운영 도메인 (DNS/관리 권한 확보)
- [x] **Vercel** 배포 (P1-OQ-7 closed) — DNS + TLS + CI 준비 상태
- [x] `apps/webapp` — private, `@manifesto-ai/studio-webapp` 스코프
- [x] 정식 운영 (demo 아님) — 외부 사용자·에이전트 진입점

### 0.4 Pre-flight (Phase 1 진입 전 완료)
- [x] `StudioCoreOptions.effects?` 옵션 스레딩 (SC-4 e2e layer 1 확보)
- [x] `EditHistoryStore.list()` 정렬 계약 `(timestamp ASC, id ASC)` 고정
- [x] SDK seam narrow — `@manifesto-ai/sdk/provider` 단일 seam 사용 (`/compat/internal` 의존 제거)
- [x] `check-no-widget-deps.mjs` allowlist 구조로 전환 — 현재 `studio-core`만 감시
- [x] `pnpm-workspace.yaml`에 `apps/*` 추가
- [x] **`@manifesto-ai/sdk@3.15.1` publish 확인 → `pnpm.overrides link:` 제거** (link 시절 제거 완료)
- [x] **UI 러프 와이어프레임 합의** — Figma file `lpCRLkerxVWOzJVufgCe4I` 2 frames (main view / rebuild view with plan overlay)

### 0.5 설계 북극성 (proposal §1.2 그대로)
- [x] **Phase 3 호환성이 모든 설계 결정의 1순위 기준.** Phase 1 UI 편의를 위해 Phase 3 경로(에이전트 대칭 편집)를 오염시키는 선택 거부.

---

## 1. 일정 개요

| 주차 | 목표 | 주요 SC |
|------|------|--------|
| Week 1 | Monaco 어댑터 + studio-react 스캐폴드 + apps/webapp 셸 | P1-SC-1, P1-SC-2 |
| Week 2 | Base 패널 (Source/Diagnostics/Plan/Snapshot/History) | P1-SC-3 |
| Week 3 | SchemaGraphView (D3) + 3-pane 레이아웃 | P1-SC-4 |
| Week 4 | InteractionEditor + Blocker UX + battleship 브라우저 parity | P1-SC-5, P1-SC-6, P1-SC-7 |
| Week 5 (버퍼) | 배포 파이프라인 + sdk publish + 선택 항목 + Phase 2 초안 | P1-SC-8, 옵션 |

**축소 여지:** W5의 Optional 작업은 일정 압박 시 전부 Phase 2로 이월 가능. Mandatory P1-SC-1~8만 공개 게이트.
**확장 트리거:** 그래프 레이아웃 선택(force/ELK/Dagre) 결정 지연, sdk publish 지연, Monaco 번들 사이즈.

---

## 2. Week 1 — Adapter + Scaffolding

### 2.1 `@manifesto-ai/studio-adapter-monaco`
- [x] package.json (`monaco-editor` peer, `studio-core` workspace:*, jsdom devDep)
- [x] tsconfig + tsconfig.build + tsup + vitest (jsdom)
- [x] `src/monaco-adapter.ts` — `createMonacoAdapter({ editor, markerOwner?, monaco })` + `.dispose()`
- [x] `src/marker-mapping.ts` — `Marker → MonacoMarkerData` with 1-based line/column clamping
- [x] loop-suppression (sketch §4) — `suppressChangeDepth` counter, no auto-build
- [x] `src/index.ts` 공개 export

### 2.2 `@manifesto-ai/studio-react` 스캐폴드
- [x] package.json (`react`, `react-dom` peer; d3-force/d3-selection/d3-shape + @types; jsdom + @testing-library/react)
- [x] tsconfig + tsup + vitest (jsdom)
- [x] `src/StudioProvider.tsx` — Context + `adapter` attach/detach + version bump + history poll (P1-OQ-5 poll 기본 500ms)
- [x] `src/useStudio.ts` — hook (module / snapshot / plan / diagnostics / history + build / simulate / dispatch / createIntent / setSource)
- [x] `src/type-imports.ts` — SDK 타입 우회 re-export via studio-core

### 2.3 `apps/webapp` 스캐폴드
- [x] package.json `private: true`, `@manifesto-ai/studio-webapp`
- [x] `vite.config.ts` — `manualChunks: { monaco }` code-splitting, `*.mel` asset include
- [x] `index.html` — dark color-scheme + og meta 자리
- [x] `src/main.tsx` + `src/App.tsx` — 3-pane placeholder, Monaco 인스턴스 mount + Studio wiring
- [x] `src/fixtures/todo.mel` + `battleship.mel` 번들 (Vite `?raw` import)
- [x] `pnpm -w build` 4 패키지 + 1 app 녹색 — Monaco chunk 3.3MB, 별도 chunk로 격리

### 2.4 Headless parity 재실행
- [x] `parity-smoke.test.ts` (studio-adapter-monaco) — todo.mel build + addTodo dispatch + SC-3 parity + 진단 marker forwarding
- [x] **P1-SC-2 ✓** — jsdom + 가짜 Monaco editor로 `adapter-contract.test.ts` 6 tests + parity 3 tests 녹색

### 2.5 Success Criteria
- [x] **P1-SC-1 ✓** — `pnpm -w build` 4 packages + 1 app 녹색 (15.9s)
- [x] **P1-SC-2 ✓** — studio-adapter-monaco parity 녹색

### 2.6 Pre-planned 변경 (scope adjustment)
- **SQLite 서브패스 분리** — `@manifesto-ai/studio-core/sqlite`로 `createSqliteEditHistoryStore` 이동. 브라우저 번들에서 `better-sqlite3`/`node:fs`/`node:path` 제거. CLI REPL은 subpath에서 import.
- **WebCrypto 브리지** — `node:crypto` 의존 제거. `build-id` / `envelope-codec`은 `globalThis.crypto.randomUUID`, trace-buffer는 FNV-1a 64-bit 해시로 전환 (sync + isomorphic + 결정론 유지).
- 두 변경 모두 studio-core 공개 API surface 불변 (INV-P1-1 지킴).

---

## 3. Week 2 — Base Panels

### 3.1 `SourceEditor`
- [x] `packages/studio-react/src/SourceEditor.tsx` — 패널 chrome (tab + footer) + editor host via `children`
- [x] `StudioHotkeys` 컴포넌트 — CTRL/CMD + S 전역 훅 → `adapter.requestBuild()` (SE-UI-2)
- [x] footer에 errors / warnings 카운트 (SE-UI-3 — build 경계에서만 diagnostics 반영)

### 3.2 `DiagnosticsPanel`
- [x] `src/DiagnosticsPanel.tsx` — severity 점 + message + `line:column` 목록
- [x] `onSelect(marker)` 콜백으로 Monaco 라인 점프 (webapp이 editor 참조 보유)
- [x] 0-issue empty state

### 3.3 `PlanPanel`
- [x] `src/PlanPanel.tsx` — identity 배지 4종 + Snapshot 버킷 3종 + traces 요약
- [x] `formatPlan(plan)` raw 뷰 `<details>` 토글 (`data-testid=raw-plan`)
- [x] prevHash → nextHash 헤더 표시

### 3.4 `SnapshotTree`
- [x] `src/SnapshotTree.tsx` — `snapshot.data` 재귀 트리, 기본 depth<3 open
- [x] path 클릭 시 clipboard 복사 + 명시적 copy 버튼
- [x] 타입별 색상 (string/number/boolean/null)

### 3.5 `HistoryTimeline`
- [x] `src/HistoryTimeline.tsx` — envelope 목록 (payloadKind + prev→next hash + timestamp + author)
- [x] 선택 상태 — `onSelect(envelope)` 콜백 (P1-G8 replay-from-here용 자리 확보)
- [x] `StudioProvider`의 500ms poll로 자동 갱신

### 3.6 apps/webapp 통합
- [x] `App.tsx` 재구성 — 좌(`SourceEditor` + Monaco div) / 중(graph placeholder) / 우(탭 4종: Snapshot / Plan / History / Diagnostics)
- [x] 단일 `StudioProvider`로 좌·우 모두 감쌈 (이중 attach 방지)
- [x] `StudioHotkeys` 바인딩 — CTRL-S 전역
- [x] Diagnostics 탭에서 클릭 시 Monaco 라인 포커스 (`revealLineInCenterIfOutsideViewport`)

### 3.7 유닛 테스트 (`packages/studio-react/src/__tests__/panels.test.tsx`)
- [x] SourceEditor — header/children/footer smoke
- [x] DiagnosticsPanel — empty state + onSelect 콜백
- [x] PlanPanel — empty state
- [x] SnapshotTree — empty state
- [x] HistoryTimeline — empty state
- [x] Live flow — build + dispatch 후 4개 패널 상태 반영 (`preserved`, `todos`, `from-test` 문자열 확인)
- [x] StudioHotkeys — Ctrl-S 이벤트 → requestBuild 호출

### 3.8 Success Criteria
- [x] **P1-SC-3 ✓** — studio-react 8 tests + 79 tests 전체 녹색 + `pnpm --filter @manifesto-ai/studio-webapp build` 성공 (7.1s, main bundle 478kB / monaco 3.3MB 격리). 브라우저 실측은 사용자 확인으로 이관.

---

## 4. Week 3 — SchemaGraphView (D3)

### 4.1 D3 레이아웃
- [x] `src/SchemaGraphView/layout.ts` — `d3-force` simulation (`forceLink`, `forceManyBody`, `forceCenter`, `forceCollide`) + 좁은 pane 대응 boundary force + 결정론 seed (mulberry32 + FNV-1a over schemaHash)
- [x] **캐시 전략:** `GraphLayoutCache` (LRU N=8) with key = `schemaHash + size bucket`. INV-P1-3 hash-cached position 재사용 동작. 신규 schema 전환 시 `carryOver()`로 보존 노드 좌표를 prevPositions seed로 넘김.
- [x] `src/SchemaGraphView/SchemaGraphView.tsx` — SVG 렌더 (nodes, edges, labels, arrow markers, grid dot background), kind별 색/형태 (state=rounded rect / computed=hex / action=pill), relation별 선 스타일 (feeds 얇은 회색 / mutates 주황 굵은 / unlocks 파선), hover 강조, 팬/줌 (wheel + drag + 더블클릭 리셋 + ZoomChrome), keyboard focus ring + Enter/Space 클릭, `<title>` tooltip.

### 4.2 Plan overlay
- [x] `plan.identityMap`을 읽어 node FateHalo 링 — initialized (blue) / discarded (red) / renamed (accent), preserved는 quiet.
- [x] `plan.snapshotPlan`을 state_field 노드에 `FateBadge` dot으로 오버레이 (preserved 빼고).
- [x] TypeCompatWarning은 `WarnBadge`로 좌상단 표시.
- [x] `GraphLegend` — 기본 collapsed, Nodes / Edges / Plan 섹션으로 시각 어휘 문서화.

### 4.3 Click-to-source
- [x] `GraphNode.sourceSpan`을 `buildGraphModel`에서 `module.sourceMap.entries[toLocalKey(id)]`로 채움.
- [x] `SchemaGraphView`의 `onNodeClick(node)` prop → `App.tsx`가 `editor.revealLineInCenterIfOutsideViewport + setPosition + focus` 호출. preview 수동 확인으로 Monaco cursor 이동 검증.

### 4.4 3-pane 레이아웃 고도화
- [x] `App.tsx` — editor | graph | inspector 3-pane + `PaneDivider` 2개 (pointer drag + ArrowLeft/Right 키보드 + Home 리셋 + aria `role=separator`).
- [x] `usePaneSizes()` — localStorage `studio.layout.v1` persist, `ResizeObserver`로 viewport 변경 시 `MIN_LEFT=240 / MIN_RIGHT=260 / MIN_CENTER=260`으로 clamp.
- [x] graph pane 배경을 `COLORS.bg`로 유지해 시각적 "central piece"가 되도록 함.

### 4.5 성능 & 레이아웃 선택
- [x] todo.mel (11 노드, 17 엣지) — force 시뮬레이션 250 tick, 결정론 seed, 좁은 pane 대응 boundary force로 안정.
- [ ] **P1-OQ-4 최종 결정** — battleship (~60 nodes) 벤치는 W4로 이월 (apps/webapp에 battleship.mel fixture 로드되는 시점). todo 규모에서는 force 충분.

### 4.6 Success Criteria
- [x] **P1-SC-4 ✓** — `sc4-graph.test.tsx`: 첫 빌드 → 3 kind 모두 렌더 확인 → state field 추가 edit → 재빌드 → schemaHash 변경 + 모든 노드 identityFate 할당 + 최소 1개 노드 non-preserved fate + DOM `<title>` overlay 단어 확인. 39 tests / 5 files 녹색.

---

## 5. Week 4 — InteractionEditor + Blocker UX

### 5.1 Action picker + 폼 생성
- [x] `src/InteractionEditor/InteractionEditor.tsx` — `schema.actions` 정렬 드롭다운 + `useStudio()` 기반 module/snapshot 소비.
- [x] `src/InteractionEditor/field-descriptor.ts` — `ActionSpec.inputType` (v0.3.3 TypeDefinition) 우선, `input` (FieldSpec) 폴백, 재귀 `ref` 해소 + recursive-ref guard, 모든 kind → `FormDescriptor` 정규화.
- [x] `src/InteractionEditor/ActionForm.tsx` — primitive (text/number/checkbox/null chip), enum (select), object (nested group + optional indicator), array (list + add/remove), record (key+value + add/remove).
- [x] **P1-OQ-6 resolved** — 미지원 shape은 `kind: "json"` descriptor로 떨어뜨리고 `reason` 설명 포함한 raw JSON textarea 렌더 (parse 에러 인라인). mixed-union / non-string record key / unknown ref / recursive ref 모두 이 경로.

### 5.2 Simulate preview
- [x] `src/InteractionEditor/SimulatePreview.tsx` — `core.simulate(intent)` 결과 가공해서 changed paths (before/after diff) + newAvailableActions chips + pending host requirements + status 배너.
- [x] `snapshot` (현재 사용자 봐라보는 상태)을 `beforeSnapshot` prop으로 받아 `resolvePath()`로 before 값 추출. 실제 dispatch와 완전 분리 — `simulate()`는 순수.

### 5.3 Dispatch + blocker list
- [x] `Dispatch` 버튼 → `core.dispatchAsync(intent)` → `StudioDispatchResult` 3 variant 처리 (completed = success 배너 + `changedPaths` 수, rejected = BlockerList, failed = error toast).
- [x] `src/InteractionEditor/BlockerList.tsx` — `admission.failure.blockers: DispatchBlocker[]` + `rejection.reason` 를 렌더. `layer` 뱃지로 `available` vs `dispatchable` 구분, `expression` 요약 + `evaluatedResult` 병기.

### 5.4 battleship 브라우저 parity
- [x] `apps/webapp` 고정자 dropdown (`todo.mel` / `battleship.mel`) — TopBar에서 스위칭, `adapter.setSource` → `requestBuild()`.
- [x] 재빌드 시 graph + snapshot + interaction editor 모두 새 schema로 리프레시 (schemaHash 변경 → useMemo 재계산).
- [x] battleship은 실측 **182 nodes / 337 edges** (proposal의 "~60 nodes"는 state 필드만 집계한 수치). 현재 force 레이아웃 + 밀도 스케일로 안정 렌더, 초기 build+layout ~2.8초.

### 5.5 Polish
- [x] SchemaGraphView `densityScale()` — 노드 16+개부터 radius / font / label 모두 스케일 다운. 40+ 노드에서는 label 생략 (glyph-only).
- [x] layout.ts — iterations를 노드 수에 비례해 증가 (200 → 최대 800), collide radius / charge / link distance 모두 cell(√area/N) 기반으로 재튜닝.
- [x] Loading/empty states — InteractionEditor는 module=null일 때 "Build the module" hint, 폼이 없는 action은 "no input" chip.
- [x] 에러 경로 — createIntent/simulate throw는 runtimeError 박스, dispatch failed variant는 error toast, rejected variant는 BlockerList.

### 5.6 Success Criteria
- [x] **P1-SC-5 ✓** — [`InteractionEditor.test.tsx`](packages/studio-react/src/InteractionEditor/__tests__/InteractionEditor.test.tsx): build → addTodo 피커 → title 입력 → simulate preview changed paths 확인 → dispatch → `core.getSnapshot()` 확인 (todos.length=1 + title 일치) + 성공 배너.
- [x] **P1-SC-6 ✓** — [`sc6-battleship.test.tsx`](packages/studio-react/src/InteractionEditor/__tests__/sc6-battleship.test.tsx): battleship.mel build → `buildGraphModel` 노드 60+개 / 엣지 > 노드 수, 액션 picker에 `initCells`/`setupBoard`/`shoot`/`recordHit`/`recordMiss` 모두 존재, `setupBoard(shipCellCount: 20)` 풀 dispatch 후 `phase="playing"` + `totalShipCells=20` 검증.
- [x] **P1-SC-7 ✓** — 같은 파일: `shoot(cellId:"cell-0-0")` 초기(phase=idle, canShoot=false) dispatch → rejected admission → BlockerList DOM에 "blocked" + "available|dispatchable" 단어 렌더.

---

## 6. Week 5 (버퍼) — Deploy + Optional

### 6.1 배포 파이프라인
- [ ] **P1-OQ-7 결정** — Vercel / Cloudflare Pages / self-host 중 택1
- [ ] `apps/webapp` production build (`pnpm --filter @manifesto-ai/studio-webapp build`) — static bundle
- [ ] `studio.manifesto-ai.dev` DNS + TLS + CI 배포 트리거
- [ ] "Phase 1 — early access" 배너 + 제안서 링크

### 6.2 SDK publish + link 제거 — ✅ pre-kickoff 완료
- [x] `@manifesto-ai/sdk@3.15.1` publish (`/provider`의 `createBaseRuntimeInstance` 공개 포함)
- [x] studio monorepo `pnpm.overrides` → `link:` 라인 제거
- [x] `pnpm install` 후 62 tests 그대로 녹색
- [x] **P1-G6 ✓**

### 6.3 Optional 산출물 (우선순위 순)
- [ ] **P1-SC-9** — Plan diff view (P1-G7)
- [ ] **P1-SC-10** — Replay-from-here 타임라인 (P1-G8)
- [ ] **P1-SC-11** — CodeMirror paper sketch 또는 어댑터 (P1-G11)
- [ ] **P1-SC-12** — 실제 `studio.manifesto-ai.dev` 배포 완료
- [ ] **P1-SC-13** — GPT 교차 리뷰

### 6.4 Phase 2 초안
- [ ] `docs/phase-2-proposal.md` 초안 — type-compat 정교화, `TypeCompatWarning` 활성화, sub-declaration reconciliation, 구조화된 agent `EditIntent` kinds, rename 엔드투엔드
- [ ] Phase 1에서 놓친 core 변경사항 정리 (있으면)

### 6.5 Phase 1 immutability 판단
- [ ] Phase 1 proposal을 freeze할지 Phase 2 제안서가 덮을지 결정
- [ ] `phase-1-proposal.md`의 "Draft" 상태 업데이트 (ratified → immutable 또는 Phase 2 이관 표기)

---

## 7. Success Criteria 요약 (proposal §8)

### Mandatory (전부 GO여야 첫 공개)

- [x] **P1-SC-1** — 4 packages + 1 app 빌드 녹색 (Week 1)
- [x] **P1-SC-2** — Monaco 어댑터 headless parity (Week 1)
- [x] **P1-SC-3** — apps/webapp 풀 루프 브라우저 (Week 2)
- [x] **P1-SC-4** — SchemaGraphView + plan overlay (Week 3)
- [x] **P1-SC-5** — InteractionEditor 폼 + simulate + dispatch (Week 4)
- [x] **P1-SC-6** — battleship 브라우저 parity (Week 4)
- [x] **P1-SC-7** — Blocker UX (Week 4)
- [ ] **P1-SC-8** — 배포 가능 static bundle (Week 5)

### Optional (있으면 좋음)

- [ ] **P1-SC-9** — Plan diff view (Week 5)
- [ ] **P1-SC-10** — Replay-from-here 타임라인 (Week 5)
- [ ] **P1-SC-11** — CodeMirror sketch (Week 5)
- [ ] **P1-SC-12** — 실제 `studio.manifesto-ai.dev` 배포 (Week 5)
- [ ] **P1-SC-13** — GPT 리뷰 (Week 5)

---

## 8. Invariants Watchlist

| ID | 의미 | 검증 시점 |
|----|------|----------|
| INV-SE-1 | `studio-core`는 위젯 라이브러리 무의존 | `check:no-widget-deps` 상시 (allowlist 좁힘) |
| INV-SE-2 | 동일 source + 동일 prev module = 동일 next plan | Phase 0 녹색 유지 |
| INV-SE-3 | Headless 테스트가 Monaco에서도 유효 | **Week 1 실측** (P1-SC-2) |
| INV-SE-4 | Edit history replay = 동일 final module + snapshot | Phase 0 녹색 유지 |
| INV-P1-1 | studio-core API는 Phase 1 내 추가 변경 없음 | 매 주 점검 — 제안·추가 시 proposal §3.3 개정 요구 |
| INV-P1-2 | React 컴포넌트는 `StudioCore` 외 SDK 직접 import 금지 | lint/grep CI (Week 2 추가) |
| INV-P1-3 | 재빌드 시 그래프는 hash-cached position을 재사용 (새 노드만 simulation) | Week 3 구현 시 검증 |

---

## 9. Open Questions (proposal §9)

| Q | 질문 | 결정 시점 |
|---|-----|----------|
| P1-OQ-1 | React state library — Context vs Zustand | Week 1 |
| P1-OQ-2 | Monaco theme | Week 2 |
| P1-OQ-3 | Vite vs Next | Week 1 (Vite 권장) |
| ~~P1-OQ-4~~ | ✅ **resolved: force**. todo(11)/battleship(182) 모두 안정 렌더. density scale + iteration 증가로 180+ 노드까지 가용. ELK/Dagre 전환은 Phase 2 과제. | W4 |
| P1-OQ-5 | Envelope 구독 — push vs poll | Week 2 |
| ~~P1-OQ-6~~ | ✅ **closed**: raw JSON textarea fallback via `kind: "json"` FormDescriptor (mixed union / non-string record key / unknown ref / recursive ref 모두 이 경로) | W4 |
| ~~P1-OQ-7~~ | ✅ **closed: Vercel** — DNS + TLS 준비 완료 | resolved pre-kickoff |
| P1-OQ-8 | Fixture 전략 — 번들 vs 업로드 vs 둘 다 | Week 2 |

---

## 10. Risk Watch (proposal §7)

| Risk | 징후 | 현재 상태 |
|------|-----|----------|
| Monaco 번들 사이즈 | demo 빌드가 > 3MB | Vite chunk-splitting + lazy route로 사전 완화 |
| React state가 core truth에서 drift | `useStudio`를 우회한 내부 상태 등장 | SE-UI-1 + SE-UI-6 + INV-P1-2로 사전 완화 |
| INV-SE-3 실패 | Monaco가 headless 가정 하나라도 깸 | Week 1 parity suite가 가드 |
| D3 force가 battleship에서 부담스러움 | 60 nodes에서 200ms 넘음 | Week 3 spike + 레이아웃 옵션 교체 준비 |
| 폼 생성기 일반화 과잉 | 모든 FieldSpec 지원 시도 → 복잡도 폭발 | temp/*.mel에 등장하는 kind만 지원, 나머지 JSON fallback |
| Effects UI 누출 | React 컴포넌트가 핸들러 직접 보유 | Effects는 `StudioCoreOptions`로만 주입 |
| sdk 버전 skew | Phase 0 linked vs Phase 1 published | W5로 격리, W1~W4는 workspace link |
| 공개 도메인 리스크 | studio.manifesto-ai.dev 첫 인상 | "Early access" 배너 + proposal 링크 |

---

## 11. Normative Rule Coverage (proposal §4)

Phase 1 추가 규범 SE-UI-1~6. 모두 테스트/구조 가드로 커버.

| Rule | 구현 주차 | 검증 |
|------|----------|------|
| SE-UI-1 | Week 1 | React 컴포넌트는 `useStudio()`만 소비 (lint) |
| SE-UI-2 | Week 2 | `SourceEditor`는 `:build` 키바인딩만, 자동 build 금지 (SE-BUILD-1 파생) |
| SE-UI-3 | Week 2 | Diagnostics는 build 경계에만 (SE-BUILD-5 파생) |
| SE-UI-4 | Week 2 | snapshot 구독은 `core.getSnapshot()` 또는 향후 공식 구독 API만 |
| SE-UI-5 | Week 2 | 컴포넌트는 fallback/loading 상태 제공 |
| SE-UI-6 | Week 2 | React 컴포넌트는 `@manifesto-ai/sdk` 직접 import 금지 (CI grep) |

Phase 0의 SE-BUILD / SE-RECON / SE-HIST / SE-ADP 규범은 변경 없이 유지. Phase 1 신규 규범은 **추가** 이고 **대체** 아님.

---

## 12. Package Surface Deltas

| Package | Phase 0 | Phase 1 |
|---------|---------|---------|
| `@manifesto-ai/studio-core` | shipped | **no-change** (INV-P1-1) |
| `@manifesto-ai/studio-adapter-headless` | shipped | no-change (CLI + test harness 유지) |
| `@manifesto-ai/studio-adapter-monaco` | — | **new (W1)** |
| `@manifesto-ai/studio-react` | — | **new (W1~W4)** |
| `@manifesto-ai/studio-webapp` (app) | — | **new (W1~W4)** |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-17 | **Initial Phase 1 roadmap.** 4주+1주 일정, Primary P1-G1~G6, Mandatory P1-SC-1~8, SE-UI-1~6 규범, INV-P1-1~3 신설. Pre-flight 4건(effects/store ordering/SDK seam/CI allowlist) 완료 상태에서 착수. D3 그래프와 InteractionEditor는 첫 공개 필수로 확정. apps/webapp이 studio.manifesto-ai.dev 운영 타깃. |
| 2026-04-17 | **Phase 1 kickoff.** `phase-1-proposal.md` Ratified. `@manifesto-ai/sdk@3.15.1` publish 확인 → `pnpm.overrides link:` 제거, 62 tests 그대로 녹색. **P1-G6 pre-kickoff 완료**. P1-OQ-7 Vercel로 closed (DNS/TLS 확보). UI 러프 와이어프레임 합의 (Figma `lpCRLkerxVWOzJVufgCe4I`, main view + rebuild view). 외부 GPT 교차 리뷰는 on-demand (Codex) 보류. W1 scaffold 착수 가능. |
| 2026-04-18 | **W1 완료.** 5 패키지(studio-core + studio-adapter-headless + studio-adapter-monaco + studio-react + apps/webapp) 전부 빌드 녹색. 71 tests / 16 파일 (core 33 + headless 29 + monaco 9). **P1-SC-1 ✓ / P1-SC-2 ✓**. INV-SE-3 실측으로 검증됨 — Monaco 어댑터가 headless adapter-contract 6 tests + parity smoke 3 tests 통과. 선/후행: (1) `@manifesto-ai/studio-core/sqlite` 서브패스 분리 (브라우저 번들에서 node: 모듈 제거), (2) WebCrypto 브리지 + FNV-1a 해시로 `node:crypto` 의존 제거. studio-core 공개 API는 `SqliteEditHistoryStore` export 한 쌍만 서브패스로 이동, `Intent`/`Snapshot`/`DomainModule` 타입은 편의 re-export로 추가. INV-P1-1(core API 동결)은 내부 분할 범위라 유지. |
| 2026-04-18 | **W2 완료.** 79 tests / 17 파일 (core 33 + headless 29 + monaco 9 + react 8). **P1-SC-3 ✓**. `@manifesto-ai/studio-react`에 5개 패널 (SourceEditor / DiagnosticsPanel / PlanPanel / SnapshotTree / HistoryTimeline) + `StudioHotkeys` + 색 토큰 세트. `StudioProvider`가 `onBuildRequest`로 adapter의 build 신호를 받아 자동 bump; 500ms history poll (P1-OQ-5). `apps/webapp`는 단일 provider 아래 좌(에디터) / 중(graph placeholder) / 우(Snapshot/Plan/History/Diagnostics 4탭) 구성, Ctrl-S 전역 단축키 + Diagnostics 클릭으로 Monaco 라인 점프. vite build 7.1s, main bundle 478kB / monaco 3.3MB chunk 격리. INV-P1-1 유지 (core API 불변), SE-UI-1/2/3 모두 코드 구조로 강제. |
| 2026-04-18 | **W2 후속 리렌더 버그 수정.** `App.tsx` 초기 마운트 시 `wiring` null → non-null 전환으로 `<StudioProvider>` 래핑이 새로 생기면서 body 전체가 remount → Monaco host div DOM 재생성 → Monaco 인스턴스가 detached div에 그려 화면 빈칸 버그. Fix: `StudioProvider` prop `adapter: EditorAdapter \| null`로 확장 (null이면 attach/onBuildRequest/setSource/requestBuild 효과 모두 guard로 skip), App.tsx는 `useMemo`로 `core`를 초기 렌더부터 생성하고 조건부 분기 제거 — tree 포지션 안정. studio-react 8 tests 그대로 녹색. |
| 2026-04-18 | **W3 완료.** 39 tests / 5 files (graph-model 13 + layout 9 + SchemaGraphView 8 + sc4 1 + panels 8). **P1-SC-4 ✓**. `packages/studio-react/src/SchemaGraphView/` 4 파일 — `graph-model.ts` (state↔state_field prefix 정규화 + sourceSpan/identityFate/snapshotFate/warnings 인리치먼트), `layout.ts` (d3-force 결정론 simulation + 좁은 pane 대응 boundary force + `GraphLayoutCache` LRU), `SchemaGraphView.tsx` (SVG 렌더 + kind별 shape + relation별 edge 스타일 + hover/focus + pan/zoom + FateHalo/FateBadge/WarnBadge overlay + `<title>` tooltip), `GraphLegend.tsx` (collapsible, Nodes/Edges/Plan 섹션). `apps/webapp`는 `PaneDivider` 2개로 드래그 리사이저 (pointer + 키보드 + localStorage persist + ResizeObserver clamp), graph pane에 `SchemaGraphView` 마운트, 노드 클릭 → Monaco line reveal (P1-SC-5 click-to-source 통합). studio-core는 SchemaGraph/SourceMap 타입 re-export만 추가 (INV-P1-1 유지, §2.6 precedent). P1-OQ-4는 todo 규모에서 force 확정, battleship 벤치는 W4로 이월. |
| 2026-04-18 | **W4 완료.** 76 tests / 9 files (panels 8 + graph 31 + field-descriptor 18 + ActionForm 9 + InteractionEditor 7 + sc6-battleship 3). **P1-SC-5 / P1-SC-6 / P1-SC-7 ✓**. `packages/studio-react/src/InteractionEditor/` 4 파일 — `field-descriptor.ts` (`FieldSpec` + v0.3.3 `TypeDefinition` → `FormDescriptor` 정규화, unsupported → `kind:"json"` fallback = P1-OQ-6 closed), `ActionForm.tsx` (재귀 렌더: string/number/boolean/null/enum/object/array/record/json, required marker, disabled state), `SimulatePreview.tsx` (changed paths before/after diff + newAvailableActions chips + pending requirements + status 배너), `BlockerList.tsx` (`admission.failure.blockers` 렌더 + layer 뱃지 + expression/evaluatedResult). `apps/webapp` TopBar에 fixture dropdown — todo ↔ battleship 스위칭 (`adapter.setSource` + `requestBuild`). SchemaGraphView는 dense graph 대응 — `densityScale()` 기반 radius/font/label 스케일, 40+ 노드에서 label 생략. layout.ts는 iterations·collideRadius·linkDistance·charge 모두 cell(√area/N) 기반으로 재튜닝. battleship 실측 **182 nodes / 337 edges** — force 레이아웃으로 안정 렌더 (build+layout ~2.8초). studio-core는 `ActionSpec/FieldSpec/TypeDefinition/DispatchBlocker/IntentAdmission/ProjectedDiff/ExecutionOutcome` 타입 re-export만 추가 (INV-P1-1 유지). **P1-OQ-6 closed**. P1-OQ-4는 force로 확정 (180+ 노드까지 사용 가능, ELK/Dagre 전환은 Phase 2로). |

---

*End of Phase 1 Roadmap.*
