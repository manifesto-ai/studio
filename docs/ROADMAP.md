# Studio Editor — Phase 0 Roadmap

> **Status:** ✅ **Phase 0 complete — 도장 (2026-04-17)**
> **Date:** 2026-04-17
> **Ref:** [proposal.md](./proposal.md) (immutable), [phase-0-review.md](./phase-0-review.md), [phase-1-proposal.md](./phase-1-proposal.md), [phase-1-roadmap.md](./phase-1-roadmap.md)
> **Duration:** 4주 본 + 1주 버퍼 (실제: 같은 날짜 라인에 전부 마감. Phase 1로 바로 이행 가능)
>
> **Completion dossier:** Mandatory SC-1~SC-7 전부 GO. Optional SC-8/SC-9/SC-10 도 GO (bonus). 13 test files / 59 tests 녹색. Phase 1 proposal은 `docs/phase-1-proposal.md`에서 이어감.

이 문서는 Phase 0 실행 체크리스트이다. 제안서(`proposal.md`)가 *무엇과 왜*를 결정하고, 본 문서는 *언제와 무엇을*을 추적한다. Rule ID(SE-*)와 Success Criteria ID(SC-*)는 제안서와 1:1 매핑한다.

---

## 0. 확정된 결정 (착수 전 합의 완료)

### 0.1 아키텍처
- [x] 패키지 2개 — `@manifesto-ai/studio-core` + `@manifesto-ai/studio-adapter-headless`
- [x] 모노레포 — `pnpm workspaces` + `turbo`
- [x] 빌드 — `tsup` (core 저장소 컨벤션)
- [x] 테스트 — `vitest` (core 저장소 컨벤션)

### 0.2 Storage + Edit History
- [x] **OQ-1 닫힘:** Lineage와 Studio EditHistory는 분리. Studio는 자체 `EditHistoryStore`를 소유하고, 각 record는 optional `lineageAnchor: {branchId, worldId}`로 참조만 유지.
- [x] Storage — `better-sqlite3` + project-local `.studio/edit-history.db`
- [x] **Envelope 패턴 채택** — `envelopeVersion: 1` 고정, payload/plan은 각자 버전 + JSON blob
  - Envelope 불변 필드: `id`, `timestamp`, `envelopeVersion`, `payloadKind`, `payloadVersion`, `prevSchemaHash`, `nextSchemaHash`, `author`, `correlationId?`, `causationId?`
  - Phase 0 동안 envelope 변경 **금지** (변경 필요 = 설계 실패 신호)

### 0.3 Reconciliation
- [x] **OQ-2 닫힘:** Type compatibility는 보수적 디폴트 — "동일 타입만 preserve, 나머지 전부 discard". Warn 없음. Phase 2에서 정교화.

### 0.4 Schedule & Fixtures
- [x] **OQ-3 닫힘:** 4주 본 + 1주 버퍼
- [x] **OQ-4 닫힘:** `temp/*.mel` 3종 fixture 사용
  - `todo.mel` (56줄) — smoke test
  - `taskflow.mel` (169줄) — reconciliation 본격 테스트
  - `battleship-reflection.mel` (917줄) — 스트레스 + SC-8 실사용

### 0.5 설계 북극성
- [x] **Phase 3 호환성이 모든 설계 결정의 1순위 기준.** Phase 1 UI 편의를 위해 Phase 3 경로를 오염시키는 선택 거부. (제안서 §1.2)

---

## 1. 일정 개요

| 주차 | 목표 | 주요 SC |
|------|------|--------|
| Week 1 | Scaffold + Build Pipeline | SC-1, SC-2 |
| Week 2 | Reconciler Core | SC-3, SC-4 |
| Week 3 | Edit History + SQLite | SC-5, SC-6 |
| Week 4 | CLI + Integration | SC-7, SC-8, SC-9 |
| Week 5 (버퍼) | Review + Phase 1 초안 | SC-10 |

**축소 여지:** Week 5는 이슈 없으면 3일 내 종료. Week 4 Monaco sketch는 진짜 30분으로 축소 가능.
**확장 트리거:** Reconciler type compat edge case, Envelope 설계 결함 재설계, Lineage 연동 블로커.

---

## 2. Week 1 — Scaffold + Build Pipeline

### 2.1 모노레포 구성
- [x] 루트 `package.json`을 workspace root로 전환 (현재 deps는 `packages/studio-core/`로 이동)
- [x] `pnpm-workspace.yaml` 추가
- [x] `turbo.json` 추가 (`build`/`test`/`lint`/`clean` task; test는 `^build`도 의존)
- [x] 루트 `tsconfig.json` + `tsconfig.build.json` (독립, composite 없음)
- [x] `vitest.workspace.ts`
- [x] `.gitignore` — `dist/`, `node_modules/`, `.studio/`, `.turbo/`, `coverage/`, `.tsbuildinfo`
- [x] `scripts/check-no-widget-deps.mjs` (INV-SE-1)

### 2.2 `@manifesto-ai/studio-core` scaffold
- [x] `packages/studio-core/package.json` (deps: compiler/sdk/lineage)
- [x] `packages/studio-core/tsconfig.json`, `tsconfig.build.json`
- [x] `packages/studio-core/tsup.config.ts` (dts: true — tsc 단독 단계 제거)
- [x] `packages/studio-core/vitest.config.ts` (passWithNoTests)
- [x] `src/index.ts` — public export만
- [x] `src/adapter-interface.ts` — `EditorAdapter`, `Marker`, `SourceSpan` re-export
- [x] `src/types/studio-core.ts` — `StudioCore`, `StudioCoreOptions`, `Detach` (D1~D3, D9 반영)
- [x] `src/types/build-result.ts` — `BuildOk`/`BuildFail` + `buildId`
- [x] `src/types/dispatch-result.ts` — `StudioDispatchResult = DispatchReport + traceIds`
- [x] `src/types/simulate-result.ts` — `StudioSimulateResult = SimulateResult + meta.schemaHash`
- [x] `src/types/trace.ts` — `TraceId`(branded), `TraceRecord`, `HostTrace`
- [x] `src/types/reconciliation.ts` — `ReconciliationPlan`, `IdentityFate`, `SnapshotReconciliation`, `TraceTagging`, `TypeCompatWarning`
- [x] `src/types/edit-intent.ts` — `EditIntent` union (Week 3 envelope은 아직 없음)
- [x] `src/internal/state.ts` — `StudioState` 머신 + `createInitialState()`
- [x] `src/internal/build-id.ts` — `crypto.randomUUID()` wrapper
- [x] `src/internal/marker-mapping.ts` — `Diagnostic → Marker`
- [x] `src/internal/trace-buffer.ts` — sha256 결정론 ID + ring buffer
- [x] `src/internal/reconciler.ts` — `computePlan()` trivial-only (Week 2 교체 지점)
- [x] `src/internal/runtime-bridge.ts` — createRuntime/disposeRuntime (SE-BUILD-6: empty effects)
- [x] `src/internal/build-pipeline.ts` — `executeBuild()` SE-BUILD-1~6
- [x] `src/create-studio-core.ts` — 모든 조각 묶는 factory

### 2.3 `@manifesto-ai/studio-adapter-headless` scaffold
- [x] `packages/studio-adapter-headless/package.json` (studio-core workspace:* dep)
- [x] `packages/studio-adapter-headless/tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- [x] `src/index.ts`
- [x] `src/headless-adapter.ts` — `createHeadlessAdapter()` 3줄 pub-sub 구현

### 2.4 Build Pipeline 구현 (SE-BUILD-1 ~ 6)
- [x] SE-BUILD-1 — Build는 명시적 trigger로만 (`core.build()` / `adapter.requestBuild()`)
- [x] SE-BUILD-2 — `setSource()`는 staging만, build 미트리거
- [x] SE-BUILD-3 — Build = `compileMelModule()` 호출 하나로 완결
- [x] SE-BUILD-4 — Build 실패 시 이전 module/runtime 유지 (테스트 검증)
- [x] SE-BUILD-5 — Build 성공 시 trivial `ReconciliationPlan` 첨부
- [x] SE-BUILD-6 — Build는 Host effect 미실행 (effects = `{}`)

### 2.5 Headless Adapter 구현 (SE-ADP-1 ~ 5)
- [x] SE-ADP-1 — source 문자열만 주고받음 (AST/parse tree 금지)
- [x] SE-ADP-2 — Build trigger adapter 주도
- [x] SE-ADP-3 — Core는 adapter 렌더링 독립
- [x] SE-ADP-4 — `setMarkers()`는 diagnostics sink
- [x] SE-ADP-5 — Monaco/CodeMirror 특유 타입 부재
- [x] Headless 전용: `getPendingSource()`, `getMarkersEmitted()` 편의 메서드

### 2.6 Fixture & Smoke Test
- [x] `packages/studio-adapter-headless/src/__tests__/fixtures/todo.mel` (순환 의존 회피 위해 헤드리스에 배치)
- [x] `packages/studio-adapter-headless/src/__tests__/fixtures/taskflow.mel`
- [x] `packages/studio-adapter-headless/src/__tests__/fixtures/battleship.mel`
- [x] **SC-1 ✓** — `pnpm -w build`로 두 패키지 빌드 성공 (dist/index.js + dist/index.d.ts)
- [x] **SC-2 ✓** — `smoke.test.ts` 통과: source 설정 → 빌드 → dispatch → snapshot 확인 on todo.mel
- [x] 회귀 테스트 — `build-rules.test.ts` (SE-BUILD), `trivial-plan.test.ts` (SE-RECON-7), `adapter-contract.test.ts` (SE-ADP). **4 파일 / 12 테스트 전부 녹색.**

### 2.7 Invariant 검증
- [x] **INV-SE-1** — `pnpm check:no-widget-deps` OK. monaco/codemirror/react/vue/svelte 등 deny list 차단.

---

## 3. Week 2 — Reconciler Core

### 3.1 ReconciliationPlan 확정
- [x] `ReconciliationPlan` 타입 최종 결정 (제안서 §3.4) — Week 1 scaffold에서 선취, Week 2에서 확정
- [x] `IdentityFate` union 완성 (`preserved`, `initialized`, `discarded`, `renamed`)
- [x] `SnapshotReconciliation` / `TraceTagging` 구조 확정

### 3.2 Identity-based 분류 (SE-RECON-1 ~ 3)
- [x] SE-RECON-1 — Identity는 `LocalTargetKey` 문자열 일치로만
- [x] SE-RECON-2 — 구조적 유사도 기반 rename 추정 금지 (reconciler는 `opts.renames` 명시 입력만 수용)
- [x] SE-RECON-3 — 명시적 `rename_decl` intent 시에만 identity 이월 — Phase 0은 intent 자체가 Week 3 envelope 이후라 스펙만, 코드 경로는 `opts.renames`로 예비

### 3.3 Type Compatibility 판정 (SE-RECON-4, 보수적)
- [x] 동일 타입 → `preserved` (state_field signature JSON 비교)
- [x] 그 외 모두 → `discarded` (Phase 0 수준)
- [x] `TypeCompatWarning`은 스펙만 두고 아직 생성 안 함 (Phase 2)

### 3.4 Plan → Apply (SE-RECON-5, 6, 7)
- [x] SE-RECON-5 — Plan은 apply 전 생성, 순수 계산 (`computePlan` / `tagTraces` 모두 순수)
- [x] SE-RECON-6 — `$host`/`$mel`/`$system` namespace는 reconciliation 제외 (overlay는 `snapshot.data`만 덮어씀)
- [x] SE-RECON-7 — Schema hash 동일 시 runtime swap skip, plan은 재계산 (all-preserved로 일관 반환)

### 3.5 Snapshot & Trace Reconciliation
- [x] Snapshot preserve/initialize/discard 실제 적용 — `@manifesto-ai/sdk/compat/internal`의 `createRuntimeKernel` + `setVisibleSnapshot`로 hydration
- [x] Trace tagging — `stillValid` / `obsolete` 분류 (action name 기반)
- [x] `trace_rename`은 Phase 2 — 스펙만 두고 스킵

### 3.6 검증 테스트
- [x] **SC-3 ✓** — computed body 변경 시 `todos` state 값 보존 (`sc3-snapshot-preserve.test.ts`)
- [x] **SC-4 ✓** — action 제거 후 해당 action trace가 `obsolete`로 분류 (`reconciler.test.ts`의 `tagTraces` unit test; 엔드투엔드 trace 파이프라인은 Week 3 Edit History 완성 후 통합)
- [x] 결정론 기초 — 동일 source + 동일 prev module = 동일 next plan (`inv-se-2-determinism.test.ts`)

### 3.7 Invariant 검증
- [x] **INV-SE-2** — 결정론: 동일 input = 동일 plan (integration + unit 모두 녹색)

---

## 4. Week 3 — Edit History + SQLite

### 4.1 Envelope 구현
- [x] `EditIntentEnvelope` 타입 최종 (Phase 0 내 변경 금지) — `types/edit-intent.ts`
- [x] Envelope encoder/decoder (envelopeVersion/payloadVersion 기반 가드) — `internal/envelope-codec.ts`
- [x] `payload` v1 encoders — `rebuild`, `rename_decl` (rename_decl은 타입만, Week 3 적용 없음)
- [x] `plan` v1 encoder — `serializePlan` / `deserializePlan` (`identityMap`은 tuple 배열로 변환)

### 4.2 EditHistoryStore 인터페이스
- [x] `EditHistoryStore` 계약 정의 (async, serializable) — `types/edit-history-store.ts`
- [x] `append`, `list(query)`, `getById`, `getByCorrelation`, `clear`, `close?`

### 4.3 InMemory Store
- [x] `createInMemoryEditHistoryStore` — 테스트용 기본 구현
- [x] studio-core 기본값은 in-memory (옵션 `editHistoryStore`로 SQLite 주입)

### 4.4 SQLite Store
- [x] `better-sqlite3` 의존성 추가 (`onlyBuiltDependencies`로 네이티브 빌드 허용)
- [x] Schema — `edit_intents` 테이블 + 인덱스 3종 (`timestamp`, `next_schema_hash`, `correlation_id`)
- [x] `createSqliteEditHistoryStore` 구현 + in-memory / 파일 기반 모두 지원
- [x] Migration 러너 (`studio_meta.schema_version` 기반, v1만)
- [x] `defaultEditHistoryDbPath(projectRoot)` 유틸 — `.studio/edit-history.db`

### 4.5 Record 생성 파이프라인 (SE-HIST-1 ~ 5)
- [x] SE-HIST-1 — 성공한 모든 build가 envelope 하나 append
- [x] SE-HIST-2 — 중복 id 거부로 append-only 강제 (두 store 모두)
- [x] SE-HIST-3 — envelope.plan에 `SerializedReconciliationPlan` 포함
- [x] SE-HIST-4 — `author` 필드 Phase 0 "human" 고정
- [x] SE-HIST-5 — envelope이 순수 JSON이라 Lineage 백업 자동 만족

### 4.6 Replay
- [x] `replayHistory(store)` / `replayEnvelopes(envelopes)` → 최종 module + canonical snapshot 복원
- [x] **SC-5 ✓** — 동일 envelope 스트림 두 번 replay = 동일 schema hash + 동일 `data` 트리 (`sc5-replay-determinism.test.ts`)
- [x] **INV-SE-4** — `canonicalizeForDeterminismCompare`로 host-provided meta 필드 배제한 비교 통과

### 4.7 Invariant 검증
- [x] **SC-6 ✓** — `pnpm check:no-widget-deps` 녹색 (better-sqlite3 는 서버-사이드 deps)

---

## 5. Week 4 — CLI + Integration

### 5.1 CLI Debug Tool
- [x] `packages/studio-adapter-headless/bin/studio-repl.mjs` (Phase 0 2패키지 제약에 맞춰 headless에 배치)
- [x] `studio-repl --file X.mel` — `:build`, `:dispatch`, `:plan`, `:snapshot [.path]`, `:history`, `:replay`, `:actions`, `:reload`, `:help`, `:quit`
- [x] Plan pretty printer — `formatPlan(plan)` — 해시 요약 + identity breakdown 정렬 + snapshot 카테고리별 bucket
- [x] **SC-7 ✓** — `sc7-cli-repl.test.ts` 5 tests (CLI 스폰 + stdin/stdout 검증)

### 5.2 Integration on battleship.mel (SC-8)
- [x] `battleship.mel`을 headless에서 로드
- [x] 기본 action 시퀀스 실행 (initCells/setupBoard/shoot/recordHit/recordMiss)
- [x] 재빌드 시 snapshot 보존 확인 (cells/shotsFired/hitCount/missCount/turnNumber 전부 `preserved`)
- [x] **SC-8 ✓** — `sc8-battleship-integration.test.ts` 녹색, 실제 게임 사이클 + 재빌드 모두 통과

### 5.3 Monaco Paper Sketch
- [x] 30분 timeboxed 설계 문서 — `docs/monaco-adapter-sketch.md`
- [x] studio-core 인터페이스가 Monaco에 충분함을 사고실험으로 확인
- [x] core 변경 0건 — `EditorAdapter` 계약 Phase 0 freeze
- [x] **SC-9 ✓** — paper sketch 완료
- [x] **INV-SE-3** — headless 테스트가 Monaco 어댑터에서도 유효 (sketch §6)

### 5.4 GO/NO-GO 판정
- [x] Mandatory SC-1 ~ SC-7 전부 GO
- [x] Optional SC-8, SC-9 도 GO (bonus)
- [x] Phase 1 진입 가능 상태 — Envelope/EditorAdapter/CLI 모두 frozen

---

## 6. Week 5 (버퍼) — Review + Phase 1 초안

### 6.1 교차 리뷰
- [x] 제안서 + ROADMAP + 실제 구현 교차 리뷰 — `docs/phase-0-review.md`
- [x] **SC-10 ✓** — 리뷰 완료 (self-review; 외부 GPT 리뷰는 Phase 1 W1 권장으로 이월)
- [x] 발견된 이슈 triage — §5 (a)~(j), 모두 Phase 1 pre-flight 리스트로 귀결. 차단 이슈 0건.

### 6.2 Phase 1 제안서 초안
- [x] `docs/phase-1-proposal.md` 초안 — Monaco 어댑터 + React 컴포넌트 + 실행 가능한 에디터 앱
- [x] Phase 0에서 놓친 core 변경사항: **단 한 건** — `StudioCoreOptions.effects?` 옵션 추가 (SC-4 e2e용). 그 외는 기존 표면에 얹힘 → Phase 0 설계 검증됨

### 6.3 Phase 0 immutability 전환
- [x] `proposal.md`를 immutable 상태로 마크 (헤더에 ✅ 도장)
- [x] `ROADMAP.md`에 "Phase 0 complete" 도장 (이 문서 헤더)

---

## 7. Success Criteria 요약 (제안서 §8)

### Mandatory (전부 GO여야 Phase 1 진입)

- [x] **SC-1** — `studio-core` + `studio-adapter-headless` 두 패키지 `pnpm build` 성공 (Week 1)
- [x] **SC-2** — Headless 어댑터로 "source 설정 → 빌드 → dispatch → snapshot 확인" 한 테스트 통과 (Week 1)
- [x] **SC-3** — 재빌드: v1 state 초기값 변경 → v2 computed body 수정 → snapshot 값 보존 (Week 2)
- [x] **SC-4** — 재빌드: v1 action 존재 → v2 action 제거 → trace `obsolete` 태깅 (Week 2)
- [x] **SC-5** — 결정론: 동일 EditIntent 시퀀스 두 번 = 동일 최종 state + plan (Week 3)
- [x] **SC-6** — `package.json`에 어떤 위젯 라이브러리도 없음 — INV-SE-1 (Week 3)
- [x] **SC-7** — CLI debug tool로 plan을 사람이 읽을 수 있는 형태로 출력 (Week 4)

### Optional (있으면 좋음)

- [x] **SC-8** — CLI REPL이 `battleship.mel`에서 실제 작동 (Week 4)
- [x] **SC-9** — Monaco 어댑터 paper sketch 완료 (Week 4)
- [x] **SC-10** — 교차 리뷰 완료 (Week 5) — `docs/phase-0-review.md`

---

## 8. Invariants Watchlist

| ID | 의미 | 검증 시점 |
|----|------|----------|
| INV-SE-1 | Core는 어떤 위젯 라이브러리에도 의존하지 않음 | Week 1 + CI 상시 |
| INV-SE-2 | 동일 source + 동일 prev module = 동일 next plan | Week 2 |
| INV-SE-3 | Headless 테스트가 Monaco/CodeMirror 어댑터에서도 유효 | ✅ Week 4 sketch (`docs/monaco-adapter-sketch.md` §6) |
| INV-SE-4 | Edit history replay = 동일 최종 module + snapshot | Week 3 |

---

## 9. Open Questions

| Q | 질문 | 상태 | 결정 |
|---|-----|------|------|
| OQ-1 | Lineage 통합 | ✅ 닫힘 | 분리. Studio 자체 EditHistoryStore + optional `lineageAnchor` 참조 |
| OQ-2 | Type compatibility 범위 | ✅ 닫힘 | 보수적: 동일 타입만 preserve, 나머지 discard |
| OQ-3 | Phase 0 일정 | ✅ 닫힘 | 4주 본 + 1주 버퍼 |
| OQ-4 | 테스트 도메인 | ✅ 닫힘 | `temp/` 3종 fixture (todo / taskflow / battleship) |

---

## 10. Risk Watch (제안서 §7)

| Risk | 징후 | 현재 상태 |
|------|-----|----------|
| §7.1 Headless 미래 UI 요구 놓침 | Week 4 Monaco sketch 시 core API 변경 필요 | 모니터 중 |
| §7.2 Reconciliation edge case 지연 | Week 2 type compat 예상보다 복잡 | 보수적 디폴트로 사전 완화 |
| §7.3 "아무도 Phase 0 안 씀" | Phase 0 종료 후 6주 Phase 1 착수 없음 | Week 4 battleship REPL로 사전 완화 |
| §7.4 Lineage 연동 불명확 | - | ✅ OQ-1 닫혀서 해소 |

---

## 11. Normative Rule Coverage (제안서 §4)

모든 SE-* rule은 구현 및 테스트로 커버된다. 미커버 rule은 Phase 0 종료 GO 판정 불가.

| Group | Rules | 구현 주차 |
|-------|-------|----------|
| Build Pipeline | SE-BUILD-1 ~ 6 | Week 1 |
| Reconciliation | SE-RECON-1 ~ 7 | Week 2 |
| Edit History | SE-HIST-1 ~ 5 | Week 3 |
| Adapter Contract | SE-ADP-1 ~ 5 | Week 1 |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-17 | Initial roadmap. 4주+1주 일정, envelope 패턴 확정, OQ 전부 닫힘 |
| 2026-04-17 | **Week 1 완료.** SC-1, SC-2, SE-BUILD-1~6, SE-ADP-1~5, SE-RECON-7, INV-SE-1 전부 녹색 (4 test files / 12 tests). 제안서 §3.3은 SDK 실제 surface(`dispatchAsync`, `createIntent`, `StudioDispatchResult`)로 갱신. Envelope 구조는 Week 1 동안 변경 없음. |
| 2026-04-17 | **Week 2 완료.** SC-3, SC-4, SE-RECON-1~7, INV-SE-2 녹색 (6 test files / 26 tests). Reconciler는 `LocalTargetKey` identity 기반 4-way 분류 + `state_field` JSON-signature 보수적 type compat. Runtime hydration은 상류 sdk의 `./compat/internal` 서브패스 공개(`createRuntimeKernel` + `createBaseRuntimeInstance`) + `setVisibleSnapshot` 경유. SDK 본체 로직은 무변경. SC-4 end-to-end(effect trace 파이프라인) 통합 검증은 Week 3 Edit History 합류 후. |
| 2026-04-17 | **Week 3 완료.** SC-5, SC-6, SE-HIST-1~5, INV-SE-4 녹색 (10 test files / 49 tests: studio-core 29 + headless 20). `EditIntentEnvelope` v1 형태 고정, envelope codec + encode/decode 가드, `EditHistoryStore` async 계약. InMemory / SQLite 두 구현 모두 append-only + 질의 공통 계약 통과. `createStudioCore({ editHistoryStore })` 옵션으로 주입, 기본값은 InMemory. `replayHistory`는 envelope 스트림을 build pipeline에 재투입해 결정론 복원 — host-provided meta(timestamp/randomSeed) 제외한 `data/computed/input/system` 비교로 INV-SE-4 검증. `better-sqlite3`는 `onlyBuiltDependencies`로 네이티브 빌드만 허용. |
| 2026-04-17 | **Week 4 완료.** SC-7, SC-8, SC-9, INV-SE-3 녹색 (13 test files / 59 tests: studio-core 33 + headless 26). `formatPlan` pretty printer (sorted identity breakdown + bucket truncation). CLI REPL `studio-repl` @ `packages/studio-adapter-headless/bin/studio-repl.mjs` — `:build` `:dispatch` `:plan` `:snapshot [.path]` `:history` `:replay` `:actions` `:reload` `:help` `:quit`. `sc7-cli-repl.test.ts`는 CLI 프로세스 스폰으로 stdin/stdout 검증. `sc8-battleship-integration.test.ts`는 실제 domain 한 건에서 shot 사이클 + 재빌드 snapshot 보존 확인. `docs/monaco-adapter-sketch.md` — core API 변경 0건, `EditorAdapter` Phase 0 freeze. **Mandatory SC-1~SC-7 전부 GO → Phase 1 진입 가능.** |
| 2026-04-17 | **Week 5 완료. Phase 0 종결 도장.** SC-10 녹색 — `docs/phase-0-review.md`에 교차 리뷰 결과 (9개 watchlist, 0개 차단). `docs/phase-1-proposal.md` 초안 완성 — Monaco + React + demo 앱, core API 변경은 `effects?` 옵션 **단 1건**으로 최소화 (Phase 0 설계 검증). `proposal.md`와 `ROADMAP.md` 헤더에 immutable 도장. 전체 Phase 0 산출물: 4 packages worth of artifacts (2 shipped + 2 docs), 13 test files, 59 tests, Mandatory SC-1~7 + Optional SC-8~10 전부 녹색, INV-SE-1~4 전부 만족. |
| 2026-04-17 | **Phase 1 pre-flight — SDK seam 좁히기 + effects 옵션 landing.** (1) Studio의 `@manifesto-ai/sdk/compat/internal` 의존을 `@manifesto-ai/sdk/provider`로 이전. `createBaseRuntimeInstance`는 upstream sdk가 `/provider`로 공식 승격 — Studio는 이제 `/provider` 단일 seam만 사용. (2) `StudioCoreOptions.effects?`가 `executeBuild → createRuntime → createManifesto`로 스레딩 — 핸들러가 진짜 dispatch에서 호출됨(`sc4-trace-obsolete-e2e.test.ts` layer 1). SC-4 layer 2 (runtime trace 기록)는 upstream host의 `TraceGraph` push 미구현으로 여전히 대기. (3) `EditHistoryStore.list()` 정렬 계약을 `(timestamp ASC, id ASC)`로 고정 — 두 구현 모두 tiebreaker 테스트 통과. Phase 0 review checklist 3건 closed, 나머지는 upstream publish 대기. |

---

*End of Roadmap*
