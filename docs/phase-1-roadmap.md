# Studio Editor — Phase 1 Roadmap

> **Status:** Active (kickoff pending — see §0)
> **Date:** 2026-04-17
> **Ref:** [phase-1-proposal.md](./phase-1-proposal.md) (draft · to be ratified)
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
- [x] `studio.manifesto-ai.dev` — 공식 운영 도메인
- [x] `apps/webapp` — private, `@manifesto-ai/studio-webapp` 스코프
- [x] 정식 운영 (demo 아님) — 외부 사용자·에이전트 진입점

### 0.4 Pre-flight (Phase 1 진입 전 완료)
- [x] `StudioCoreOptions.effects?` 옵션 스레딩 (SC-4 e2e layer 1 확보)
- [x] `EditHistoryStore.list()` 정렬 계약 `(timestamp ASC, id ASC)` 고정
- [x] SDK seam narrow — `@manifesto-ai/sdk/provider` 단일 seam 사용 (`/compat/internal` 의존 제거)
- [x] `check-no-widget-deps.mjs` allowlist 구조로 전환 — 현재 `studio-core`만 감시
- [x] `pnpm-workspace.yaml`에 `apps/*` 추가

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
- [ ] `packages/studio-adapter-monaco/package.json` (`monaco-editor` dep, `studio-core` workspace:*)
- [ ] `packages/studio-adapter-monaco/tsconfig.json`, `tsconfig.build.json`, `tsup.config.ts`, `vitest.config.ts`
- [ ] `src/monaco-adapter.ts` — `createMonacoAdapter({ editor, markerOwner? })`
- [ ] `src/marker-mapping.ts` — `Marker → monaco.editor.IMarkerData`
- [ ] `src/source-bridge.ts` — `setValue` loop-suppression (`sketch` §4)
- [ ] `src/index.ts` — public export
- [ ] 테스트 — jsdom 기반 Monaco stub, `adapter-contract.test.ts` 포팅

### 2.2 `@manifesto-ai/studio-react` 스캐폴드
- [ ] `packages/studio-react/package.json` (`react`, `react-dom`, `d3-force`, `d3-selection`, `d3-shape`; `studio-core` + `studio-adapter-monaco` workspace:*)
- [ ] `tsconfig` + `tsup` + `vitest` (jsdom environment 설정)
- [ ] `src/StudioProvider.tsx` — React context + `core` / `adapter` hand-in
- [ ] `src/useStudio.ts` — hook (module / snapshot / plan / history / diagnostics / build / simulate / dispatch / createIntent / setSource)
- [ ] `src/index.ts` — 타입 + 컴포넌트 skeleton re-export

### 2.3 `apps/webapp` 스캐폴드
- [ ] `apps/webapp/package.json` — `private: true`, `@manifesto-ai/studio-webapp`, `react` + `vite`
- [ ] `apps/webapp/vite.config.ts` — monaco-editor code-splitting
- [ ] `apps/webapp/index.html` — meta (og image, favicon 자리 holder)
- [ ] `apps/webapp/src/main.tsx` — Vite entry, `StudioProvider` 바인딩
- [ ] `apps/webapp/src/App.tsx` — 3-pane placeholder (editor / graph / interaction)
- [ ] `apps/webapp/src/fixtures/` — `todo.mel`, `battleship.mel` 번들 (symlink 대신 import-as-asset으로 Vite 친화)
- [ ] `pnpm -w build` 4 패키지 + 1 app 녹색

### 2.4 Headless parity 재실행
- [ ] Monaco 어댑터를 headless 대신 꽂은 상태에서 `smoke`, `sc3`, `sc5`, `inv-se-2` 테스트 재실행 (jsdom)
- [ ] **P1-SC-2 ✓** — 실패 시 W2 블록

### 2.5 Success Criteria
- [ ] **P1-SC-1 ✓** — `pnpm -w build` 4 packages + 1 app 녹색
- [ ] **P1-SC-2 ✓** — studio-adapter-monaco headless parity 녹색

---

## 3. Week 2 — Base Panels

### 3.1 `SourceEditor`
- [ ] `packages/studio-react/src/SourceEditor.tsx` — Monaco 인스턴스 생성 + `attach(adapter)` + `:build` 키바인딩 (CTRL-S)
- [ ] SE-UI-1, SE-UI-2 준수 — 렌더는 순수, 자동 build 없음
- [ ] 다이어그노스틱스는 build 경계에만 반영 (SE-UI-3)

### 3.2 `DiagnosticsPanel`
- [ ] `src/DiagnosticsPanel.tsx` — `core.getDiagnostics()` 리스트 렌더, 클릭 시 `SourceMapIndex`로 Monaco 라인 점프
- [ ] severity별 아이콘 + message + span

### 3.3 `PlanPanel`
- [ ] `src/PlanPanel.tsx` — `formatPlan(plan)` 재활용 + 구조화된 탭 뷰 (identity / snapshot / traces)
- [ ] preserved / initialized / discarded 배지

### 3.4 `SnapshotTree`
- [ ] `src/SnapshotTree.tsx` — `snapshot.data` 재귀 트리. 기본은 읽기 전용
- [ ] `.path` 경로 복사 UX (CLI의 `:snapshot .data.todos` 대응)

### 3.5 `HistoryTimeline`
- [ ] `src/HistoryTimeline.tsx` — `core.getEditHistory()` 폴링 (P1-OQ-5 W2 결정)
- [ ] envelope id / timestamp / payloadKind / hash 전후
- [ ] 향후 replay-from-here 훅 자리 확보 (P1-G8)

### 3.6 apps/webapp 통합
- [ ] `App.tsx`에 5개 패널 와이어 — 좌(에디터) / 중(스냅샷+플랜 탭) / 우(diagnostics+history 탭)
- [ ] 브라우저에서 `todo.mel` 편집 → 빌드 → dispatch → 스냅샷 갱신까지 수동 확인

### 3.7 Success Criteria
- [ ] **P1-SC-3 ✓** — 브라우저에서 `todo.mel` 풀 루프 (`apps/webapp` 수동 시나리오 테스트)

---

## 4. Week 3 — SchemaGraphView (D3)

### 4.1 D3 레이아웃
- [ ] `src/SchemaGraphView/layout.ts` — `d3-force` simulation (`forceLink`, `forceManyBody`, `forceCenter`, `forceCollide`)
- [ ] **캐시 전략:** `(schemaHash → Map<nodeId, {x, y}>)` — 동일 hash 재빌드 시 위치 유지, 새 node만 simulation 재시작
- [ ] `src/SchemaGraphView/render.ts` — SVG 렌더 (nodes, edges, labels), kind별 색/형태, relation별 선 스타일 (feeds/mutates/unlocks)

### 4.2 Plan overlay
- [ ] `plan.identityMap`을 읽어 node border color 오버레이 — preserved (=) / initialized (+) / discarded (-)
- [ ] `plan.snapshotPlan`도 동일하게 시각화 (state_field 노드 기준)
- [ ] Legend

### 4.3 Click-to-source
- [ ] `src/SchemaGraphView/hit-testing.ts` — 노드 클릭 시 `module.sourceMap`에서 `LocalTargetKey` → `SourceSpan` 변환
- [ ] 부모 패널에 `onNodeClick(key)` 콜백 전달, `App.tsx`가 Monaco `editor.revealLineInCenter` 호출

### 4.4 3-pane 레이아웃 고도화
- [ ] `App.tsx` — editor | graph | snapshot/interaction 3-pane (드래그 리사이저)
- [ ] graph pane이 webapp의 시각적 "central piece"가 되도록 레이아웃 균형

### 4.5 성능 & 레이아웃 선택
- [ ] **P1-OQ-4 결정** — battleship (~60 nodes, 100+ edges) 케이스에서 force vs ELK/Dagre 벤치
- [ ] 200ms 이하 프레임 예산; 초과 시 layered 레이아웃으로 전환

### 4.6 Success Criteria
- [ ] **P1-SC-4 ✓** — `todo.mel` 그래프 렌더 + computed body 변경 후 plan overlay 보임 (`sc4-graph.test.tsx`, jsdom)

---

## 5. Week 4 — InteractionEditor + Blocker UX

### 5.1 Action picker + 폼 생성
- [ ] `src/InteractionEditor/InteractionEditor.tsx` — `schema.actions` 드롭다운
- [ ] `src/InteractionEditor/action-form.tsx` — `ActionSpec.input` / `inputType` 기반 폼 생성
- [ ] `FieldSpec` kind별 입력 렌더링 — primitive (string/number/boolean), enum (select), object (nested group), array (list), union (kind select)
- [ ] **P1-OQ-6 결정** — 지원 안 되는 kind는 raw JSON textarea fallback (JSON.parse validation)

### 5.2 Simulate preview
- [ ] `src/InteractionEditor/simulate-preview.tsx` — `Simulate` 버튼 → `core.simulate(intent)` → 현재 snapshot과 diff 렌더 (`data.*` 경로별 before/after)
- [ ] Preview는 실제 dispatch와 분리 — SE-RECON-5 정신 유지

### 5.3 Dispatch + blocker list
- [ ] `Dispatch` 버튼 → `core.dispatchAsync(intent)` → `StudioDispatchResult` 렌더
- [ ] `src/InteractionEditor/blocker-list.tsx` — action이 unavailable이면 `core.whyNot(intent)` 블로커 리스트 인라인 표시

### 5.4 battleship 브라우저 parity
- [ ] `apps/webapp`에서 `battleship.mel` 로드 → `initCells` + `setupBoard` + `shoot`/`recordHit`/`recordMiss` 시퀀스 수행 (SC-8 브라우저 버전)
- [ ] 재빌드 시 그래프 + 스냅샷 모두 보존/반영 확인

### 5.5 Polish
- [ ] Loading/empty states (SE-UI-5)
- [ ] 에러 토스트 (빌드 실패 시 blocker 자리 대신 diagnostics로 routing)

### 5.6 Success Criteria
- [ ] **P1-SC-5 ✓** — `addTodo(title)` 폼 → simulate → dispatch 풀 플로우 (jsdom + `apps/webapp` 수동 시나리오)
- [ ] **P1-SC-6 ✓** — `battleship.mel` 브라우저 parity, ~60 node 그래프 안정 렌더
- [ ] **P1-SC-7 ✓** — `shoot` while phase != "playing" 시 blocker 리스트 렌더 (inline)

---

## 6. Week 5 (버퍼) — Deploy + Optional

### 6.1 배포 파이프라인
- [ ] **P1-OQ-7 결정** — Vercel / Cloudflare Pages / self-host 중 택1
- [ ] `apps/webapp` production build (`pnpm --filter @manifesto-ai/studio-webapp build`) — static bundle
- [ ] `studio.manifesto-ai.dev` DNS + TLS + CI 배포 트리거
- [ ] "Phase 1 — early access" 배너 + 제안서 링크

### 6.2 SDK publish + link 제거
- [ ] `@manifesto-ai/sdk` 새 버전 publish (`/provider`의 `createBaseRuntimeInstance` 공개 포함)
- [ ] studio monorepo `pnpm.overrides` → `link:` 라인 제거
- [ ] `pnpm install` 후 62 tests 그대로 녹색 확인
- [ ] **P1-G6 ✓**

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

- [ ] **P1-SC-1** — 4 packages + 1 app 빌드 녹색 (Week 1)
- [ ] **P1-SC-2** — Monaco 어댑터 headless parity (Week 1)
- [ ] **P1-SC-3** — apps/webapp 풀 루프 브라우저 (Week 2)
- [ ] **P1-SC-4** — SchemaGraphView + plan overlay (Week 3)
- [ ] **P1-SC-5** — InteractionEditor 폼 + simulate + dispatch (Week 4)
- [ ] **P1-SC-6** — battleship 브라우저 parity (Week 4)
- [ ] **P1-SC-7** — Blocker UX (Week 4)
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
| P1-OQ-4 | SchemaGraphView 레이아웃 — force vs ELK vs Dagre | **Week 3 spike** |
| P1-OQ-5 | Envelope 구독 — push vs poll | Week 2 |
| P1-OQ-6 | InteractionEditor 미지원 FieldSpec 처리 | Week 4 |
| P1-OQ-7 | 배포 타깃 — Vercel / CF Pages / self-host | Week 5 |
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

---

*End of Phase 1 Roadmap.*
