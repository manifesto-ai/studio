# Studio Agent — Roadmap

> **Status:** 🟢 **Phase α done + β partially shipped + deployed to production (2026-04-24)**
> **Ref:** [studio-backlog.md §8 Agent-first Studio](./studio-backlog.md), [phase-1-roadmap.md](./phase-1-roadmap.md), [building-agents-on-manifesto.md](./building-agents-on-manifesto.md)
> **Duration target:** 4 weeks prototype + 1 week extraction decision
> **Scope marker:** every item tagged `AG-*` below is a single trackable deliverable.
>
> ## Progress snapshot (2026-04-24)
>
> - **Phase α Infra**: ✅ 100% done + exceeded
> - **Phase β Tool expansion**: 🟢 ~80% (introspection + grounding + simulate + source-map done; persistence missing)
> - **Phase γ Refactor proposals**: 🟡 ~55% (Verified Patch MVP + headless MEL Author Agent package landed; critic/rich preview missing)
> - **Phase δ Critic + consolidation**: 🟠 ~5% (error cascade partially; no critic, no E2E)
> - **Phase ε Package extraction**: ❌ 0%
> - **Phase ζ Follow-on agents**: ❌ 0%
>
> Two major deviations from the plan, both in production:
>   1. **Provider** is AI SDK-configurable: Vercel AI Gateway for deploy,
>      Ollama OpenAI-compatible for local/private `gemma4:e4b`. See AG-D1.
>   2. **Transport + orchestrator** replaced with Vercel AI SDK —
>      deletes ~1800 LOC of custom Ollama/SSE/tool-loop plumbing. See
>      AG-α4, AG-α6, AG-α9.
>
> New surfaces landed that weren't in the original plan (see §9 below
> for why these were additive wins, not scope creep):
>   - `inspectLineage` / `inspectConversation` / `recordAgentTurn` —
>     agent sees runtime history + its own transcript as first-class.
>   - `StudioCore.subscribeAfterDispatch` — one core notifier every
>     observer shares; killed a class of "stale React / agent / mock
>     palette" bugs.
>   - `seedMock` / `generateMock` / `MockDataPalette` — type-walking
>     mock data generator shared by the agent and a human UI.
>   - `studio.mel` as its own runtime — UI state (focus/lens/viewMode)
>     is Manifesto, so the agent reads and writes it via the same
>     dispatch surface as user domain state.
>   - `docs/building-agents-on-manifesto.md` — happy-path playbook.
>   - Production deploy: Vercel Edge function `/api/agent/chat` + Upstash
>     rate limit (fail-open) + Vercel Analytics + Google Analytics.

이 문서는 Studio에 에이전트 레이어를 얹는 단계별 실행 체크리스트이다.
"무엇을 왜"는 [`studio-backlog.md §8`](./studio-backlog.md#8-agent-first-studio-—-deterministic-agent-observatory)에 있고, 본 문서는 "언제 무엇을"을 추적한다.

핵심 가정은 두 가지다:

1. **Manifesto SDK가 이미 agent-first 설계**. Studio agent는 SDK introspection surface를 LLM-facing 도구로 노출할 뿐, legality / simulate / source-map 의미론을 재구현하지 않는다.
2. **패키지 분리는 4주 후 재평가**. Phase α–δ 동안엔 `apps/webapp/src/agent/`에 패키지처럼 구조화된 in-app 프로토타입으로 살되, `tools/` / `agents/` / `session/` 디렉토리는 React / webapp-local 의존을 받지 않는 규율을 유지한다.

---

## 0. 착수 전 합의 (Phase α 시작 전에 모두 ✓)

### 0.1 아키텍처 경계선

- [x] **AG-B1**: `apps/webapp/src/agent/` 생성. 하위 구조:
  `tools/`, `session/`, `ui/`, `adapters/`. `agents/` + `provider/`는
  AI SDK 전환 때 제거됨 (orchestrator 는 SDK, provider 는 server
  route).
- [x] **AG-B2**: 경계선 테스트 `import-boundaries.test.ts` 로 강제.
- [~] **AG-B3**: `provider/` 삭제됨 — AI SDK 전환으로 더 이상 필요
  없음. 서버 프록시 (`src/server/agent-chat-handler.ts`) 가 webapp-only.
- [x] **AG-B4**: `ui/`는 React 전용. tool context 를 binding 으로 주입.

### 0.2 외부 의존성 결정

- [~] **AG-D1**: **DEVIATED** — provider 를 AI SDK 스위치로 수렴.
  Vercel AI Gateway (`google/gemma-4-26b-a4b-it`) 는 deploy 경로,
  Ollama OpenAI-compatible (`gemma4:e4b`) 는 local/private 경로.
  `AGENT_MODEL_PROVIDER=gateway|ollama` 로 선택.
- [x] **AG-D2**: OpenAI-호환 경로로 시작해서 native fallback 까지
  모두 구현 후, AI SDK 전환하면서 둘 다 제거. 선택 자체는 OpenAI-
  호환이 맞았음.
- [x] **AG-D3**: 배포 아키텍처는 server proxy (`/api/agent/chat` Edge
  function) 로 수렴. 브라우저는 절대 Gateway 를 직접 호출하지 않음.
- [x] **AG-D4**: provider/model env 로 교체 가능.
  `AGENT_MODEL_PROVIDER`, `AI_GATEWAY_MODEL`, `OLLAMA_MODEL` 지원.
- [x] **AG-D5**: Function calling 검증 완료 — gemma4 4B 모델에서 10
  단계 ReAct 추론 + 툴 체인 안정적. Vercel Gateway 로 26B 변형 쓰면
  더 여유 있음.
- [x] **AG-D6**: Upstash 기반 IP rate limit (2h / 20req) 로 대체.
  Token 예산 대신 request 예산. Fail-open 정책 (Upstash 장애 시 agent
  계속 동작).

### 0.3 추출 시그널 (Phase ε 트리거 조건)

다음 중 **2개 이상** 만족하면 `studio-agent-core` / `studio-agent-react`
패키지로 추출한다 (Phase δ 말 재평가).

- [ ] **AG-S1**: 아직 webapp consumer 만. studio-cli agent mode 미착수.
- [~] **AG-S2**: tools/ 시그니처 — α 말부터 꾸준히 진화. 3주 stable
  미충족 (projection/fields 도입 + seedMock 추가 + inspectLineage /
  inspectConversation 추가 등). β 작업이 계속되는 동안 재평가 필요.
- [ ] **AG-S3**: 외부 import 수요 없음.
- [x] **AG-S4**: `tools/` / `session/` 이 webapp / React 모듈을 import
  하지 않는 역방향 금지는 지속 유지. `import-boundaries.test.ts` 로
  강제 중.

---

## 1. Phase α — Infra (Week 1)

**Goal**: Single-tool orchestrator가 사용자 질문에 Legality Inspector
결과를 인용해 답하는 최소 루프 완성. "에이전트가 Studio 안에서
동작함"을 증명.

### 1.1 Deterministic tool layer — Legality Inspector

- [x] **AG-α1**: `tools/types.ts` — `AgentTool<TIn, TOut, TCtx>`,
  `ToolRunResult`, `BoundAgentTool`, `ToolRegistry`. 원 계획보다
  context 주입을 첫급 시민으로 만들었음.
- [x] **AG-α2**: `tools/legality.ts` (→ `explainLegality` 로 노출).
  `blockers[]` 에 guard expression + evaluatedResult 까지 구조화.
- [x] **AG-α3**: JSON Schema 생성은 AI SDK 가 그대로 받아감
  (`jsonSchema(tool.jsonSchema)` 래퍼). Anthropic-specific
  generator 는 불필요해졌음.

### 1.2 LLM provider wrapper (Ollama)

- [~] **AG-α4**: 커스텀 Ollama 구현은 AI SDK 전환 때 삭제. 현재는
  `@ai-sdk/openai-compatible` 로 Ollama (`gemma4:e4b`) 를 연결하고,
  bare model string 으로 Vercel AI Gateway 를 연결.
- [x] **AG-α5**: `.env.local` + Vercel project env 로 주입. 서버측
  (`AGENT_MODEL_PROVIDER`, `AI_GATEWAY_*`, `OLLAMA_*`) + 클라이언트측
  (`VITE_AGENT_MODEL`) 분리.
- [x] **AG-α5b**: 서버 프록시 아키텍처로 수렴 — dev 는 Vite
  middleware, prod 는 Vercel Edge function. 둘이 같은 handler 공유.
- [x] **AG-α5c**: 스트리밍은 AI SDK 의 `useChat` + `toUIMessage
  StreamResponse()` 로 first-class. 토큰별 델타 → `llm-pending`
  partial → markdown 렌더.

### 1.3 Orchestrator (single-turn)

- [~] **AG-α6**: 커스텀 orchestrator 초기 구현 (maxToolUses, onStep,
  onStream, signal) 후 AI SDK 의 `streamText` + `stopWhen` +
  `sendAutomaticallyWhen` 으로 대체. 최대 10 step tool 루프.
- [x] **AG-α7**: System prompt — identity anchor + tool catalog +
  grounding recipe + MEL source + recent-turns tail. Phase 내내 가장
  많이 손댄 부분이고 가장 중요한 부분. 상세는 `building-agents-on-
  manifesto.md` §1 참조.
- [~] **AG-α8**: **REFRAMED** — "context packet serializer" 접근은
  폐기. 대신 introspection tools (`inspectFocus` / `inspectSnapshot`
  / `inspectAvailability` / `inspectNeighbors`) 로 에이전트가 필요할
  때 필요한 만큼 조사하는 패턴. 이 전환이 4B 모델 품질을 근본적으로
  올린 결정적 변화. **"MEL = identity (prompt), snapshot = state
  (tools)"** 분리 원칙 정착.

### 1.4 Session state (in-memory)

- [~] **AG-α9**: 커스텀 `TranscriptStore` (llm-pending partials +
  stream delta merging + turn grouping) 구현 후, AI SDK 전환하면서
  삭제. `useChat().messages` + `UIMessage.parts` 가 같은 역할.
- [x] **AG-α10**: AI SDK `useChat({id: "manifesto-agent"})` 로 대체.
  프로젝트 스위칭 시 `chat.setMessages([])` 로 reset. Persistent
  전환은 Phase β 잔여 작업 (AG-β8~10).

### 1.5 UI shell — Agent lens

- [x] **AG-α11**: `agent/ui/AgentLens.tsx` — 전면 재작성 (AI SDK).
  Manifesto-native 시각 모티프 (좌측 2px violet accent bar, 채널
  컬러 툴 rows, 하이라이트-in-place 패턴).
- [x] **AG-α12**: LensPane 6번째 탭으로 등록.
- [x] **AG-α13**: 메시지 렌더러 — MarkdownBody (react-markdown +
  remark-gfm), 인라인 툴 rows (`▸ toolName { args } → ok`), reasoning
  pane (접이식 italic mono). 채널 컬러 (write=violet, read=cyan,
  explain=orange). Legality 결과 → Ladder lens 점프는 미구현.
- [x] **AG-α14**: Hairline status strip (`● model · streaming…` /
  `ready` / `error`), error 배지, 429 rate-limit 응답 헤더 지원.

### 1.6 검증 시나리오

- [x] **AG-α15**: "이게 왜 막혀있어?" → `inspectFocus` →
  `explainLegality` → guard expression 인용해서 자연어 설명 →
  remedy 제안 (e.g. "먼저 addTodo 로 항목 추가하세요"). 확인 완료.
- [x] **AG-α16**: 다른 action / 다른 snapshot 에서 일관되게 근거 있는
  답변. 스크린샷 근거 확보 (changeView focus → MEL 기반 설명,
  emptyTrash focus → deletedCount 가드 설명).
- [x] **AG-α17**: 그래프 클릭 포커스, 시뮬레이션 세션, Monaco
  커서 포커스 sync, project switch 등 기존 UX 회귀 없음.

**Phase α 종료 기준**: AG-α15 시나리오 ✅. 실사용자 피드백 "이미
온보딩 에이전트" 수준. 응답 속도도 Vercel Gateway 에서 cold start
밀리초급이라 UX 충분.

---

## 2. Phase β — Tool expansion (Week 2)

**Goal**: Orchestrator가 multi-tool 계획을 세우고, transcript가
persistent. 에이전트가 "legality + simulation + source 인용"을
합성해 답할 수 있음.

### 2.1 추가 deterministic tools

- [x] **AG-β1**: `simulateIntent` 툴 MVP shipped. `core.explainIntent`
  로 blocked intent 는 dry-run 하지 않고, admitted intent 만
  `core.simulate` 해서 changedPaths / newAvailableActions /
  requirements / schemaHash 를 compact projection 으로 반환.
- [x] **AG-β2**: `locateSource` 툴 MVP shipped. `module.sourceMap`
  entries 를 graph node id (`state:*`, `action:*`, `computed:*`) /
  localKey 로 조회하고 source span + preview 를 반환. Monaco jump 는
  아직 UI 후속.
- [x] **AG-β3**: `inspectNeighbors({nodeId})` 로 통합 구현 —
  feeds/mutates/unlocks 라벨과 함께 incoming/outgoing 반환. upstream
  /downstream 을 별개 툴로 나누지 않고 direction 필드로 포함 (더
  적은 툴 수가 작은 모델에 유리).
- [x] **AG-β4**: `inspectAvailability` 의 `describeAction` 컨텍스트로
  커버 (param names, hasDispatchableGate, description). Source span
  은 Phase γ 에서 추가 예정.
- [x] **AG-β5**: `inspectSnapshot()` — `{data, computed, system}`
  리턴. Summarization 은 하지 않고 그대로 리턴 (projection 이 필요
  하면 에이전트가 후속 tool 로 필터).

### 2.2 Multi-tool orchestrator

- [x] **AG-β6**: AI SDK `streamText({stopWhen: stepCountIs(10)})` +
  `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`
  로 multi-step tool loop. 실제 기록: 사용자 "이걸 작동시키려면?" →
  3 툴 체인 (`inspectFocus` → `inspectAvailability` → `inspectSnapshot`)
  → 최종 답변까지 자동 루프.
- [x] **AG-β7**: 툴 에러 값 형태로 리턴 (`{ok: false, kind:
  "invalid_input" | "runtime_error", message}`) → 모델이 read +
  self-correct. `seedMock` 의 rejection outcomes 에 `{code, message}`
  까지 구조화.

### 2.3 Persistent session

- [ ] **AG-β8**: IndexedDB 전체 transcript 저장 미착수. 현재는
  studio.mel 에 단건 메모리 (`lastUserPrompt` / `lastAgentAnswer` /
  `agentTurnCount`) + React useChat 내부 state. 탭 닫으면 대화 전체
  소실.
- [ ] **AG-β9**: Persistence 미착수이므로 schema migration 도 해당 없음.
- [ ] **AG-β10**: 세션 복원 미착수. 프로젝트 스위칭 시 `chat.set
  Messages([])` 로 리셋.

### 2.4 Context quality

- [~] **AG-β11**: **REFRAMED** — "scene packet" 대신 **projection-
  first tool 설계**. 각 inspect 툴이 compact default + `fields?` opt-
  in + per-field cap (changedPaths 20 per entry, assistantText 2000c,
  reasoning 1500c). 결과: 10-step 추론 체인에서도 컨텍스트 여유.
- [x] **AG-β12**: **REFRAMED** — delta 요약 대신 **recent 5 turns tail
  injection** (`buildRecentTurnsForPrompt`, 매 excerpt 280c cap) +
  long-horizon 은 `inspectConversation({beforeTurnId, fields?})` 로
  lazy search. Short-horizon 연속성 + long-horizon 검색 분리.

### 2.5 검증 시나리오

- [~] **AG-β13**: 부분 — 읽기/설명은 완전 작동 ("이거 왜 막혔어" →
  guard expression 인용 + remedy 제안). 쓰기 제안 (Phase γ refactor
  agent) 은 미착수.
- [ ] **AG-β14**: 미착수 (AG-β8 필요).
- [x] **AG-β15**: Upstash IP rate limit 으로 세션당 20 req/2h 고정.
  Token 단위 제어는 아니지만 abuse 방지 목적은 달성.

**Phase β 종료 기준**: AG-β13 읽기/설명 ✅, 쓰기 제안 ❌ (Phase γ).
AG-β14 persistence ❌. **β 는 약 60% 완료**.

---

## 3. Phase γ — Refactor agent + proposal buffer (Week 3)

> **Status: 🟡 ~55% — Verified Patch MVP + headless MEL Author Agent
> package landed.** `authorMelProposal` 은 독립 패키지
> `@manifesto-ai/studio-mel-author-agent` 를 호출해 임시 workspace 에서
> MEL 초안을 만들고, webapp 은 결과를 기존 proposal verifier / Preview
> 로 묶는다. Critic / persistence / rich before-after ladder 는 후속.

**Goal**: 에이전트가 MEL 편집을 제안하고, 사용자는 diff + simulate
preview를 보고 승인/거부. 첫 "쓰기" 에이전트.

### 3.1 Proposal buffer

- [~] **AG-γ1**: `agent/session/proposal-buffer.ts` — 단일 in-memory
  proposal shipped. `{originalSource, proposedSource, diagnostics,
  status}` shape. `diffHunks` 는 저장하지 않고 UI 렌더 시 deterministic
  계산.
- [x] **AG-γ2**: webapp의 Monaco 실제 source는 **승인 전엔 건드리지
  않음**. `adapter.setSource`는 승인 이후에만 호출
- [~] **AG-γ3**: proposal에 대해 shadow `createStudioCore` 인스턴스를
  돌려 build diagnostics 를 검증. simulate 결과 미리보기는 미착수.

### 3.2 Refactor/Repair agent

- [x] **AG-γ4**: `packages/studio-mel-author-agent/` — scoped edit 전문
  headless MEL Author Agent package. 입력: 현재 source + 사용자 의도,
  출력: ephemeral workspace 에서 build 된 full-source draft + rationale.
- [x] **AG-γ5**: Orchestrator가 source-change 요청을 `authorMelProposal`
  tool 로 위임. 결과는 기존 proposal buffer / verifier 로 묶음.

### 3.3 Contract Verifier (deterministic gate)

- [x] **AG-γ6**: proposal을 실제 적용하기 전 shadow `core.build()`
  실행, diagnostics 수집. 실패 proposal 은 Preview 에 표시되지만
  Accept 비활성화.
- [~] **AG-γ7**: Reserved namespace (`$host`, `$mel`, `$system`)
  declaration 오염 검사 shipped. identifier 충돌 검사는 미착수.

### 3.4 UI — Proposal preview

- [~] **AG-γ8**: `ui/ProposalPreview.tsx` — compact diff preview +
  diagnostics + Accept / Reject shipped. Monaco split diff / Discuss 는
  미착수.
- [ ] **AG-γ9**: proposal inline에서 IntentLadder를 "before" vs "after"
  로 렌더 — 변경이 legality를 어떻게 바꾸는지 미리 보기
- [~] **AG-γ10**: Accept 시 `adapter.setSource` + `requestBuild` shipped.
  에이전트 응답에 "proposed and accepted — rebuilt" 기록은 미착수.
- [~] **AG-γ11**: Reject 시 proposal 폐기 shipped. 이유 prompt 는
  미착수.

### 3.5 안전 장치

- [x] **AG-γ12**: 단일 proposal buffer 로 에이전트는 한 번에 1개
  proposal 만 표시. 새 proposal 은 기존 proposal 을 대체.
- [ ] **AG-γ13**: proposal 적용 후 build 실패 시 자동 rollback (Monaco
  이전 버퍼 복원)
- [ ] **AG-γ14**: Cost / token budget — Phase γ 완료 시점에 세션당
  한도 설정

### 3.6 검증 시나리오

- [ ] **AG-γ15**: "decrement(n: number)로 받도록 바꾸고 n만큼
  감소시켜줘" → refactor agent가 proposal 생성 → verifier 통과 →
  simulate preview로 legality 변화 미리 보기 → 사용자 accept →
  Monaco 반영 → 빌드 OK
- [ ] **AG-γ16**: 컴파일 실패하는 잘못된 proposal → verifier가 거절 →
  에이전트 재시도 → 두 번째 proposal 통과
- [ ] **AG-γ17**: User rejects "reason: 너무 큰 변경" → 에이전트가
  작은 변경으로 재시도

**Phase γ 종료 기준**: AG-γ15 시나리오 end-to-end 작동.

---

## 4. Phase δ — Critic + consolidation (Week 4)

> **Status: 🟠 ~5% — 거의 미착수.** error cascade (AG-δ5) 만 Zod +
> 구조화된 tool 에러 + rate-limit fail-open 으로 부분 커버됨. Critic
> sub-agent, snapshot-bound simulate session, E2E 테스트, 10-prompt
> regression 테스트, transcript export, 추출 결정 전부 미수행.

**Goal**: Critic이 proposal의 edge case를 적극 찾아냄. 에이전트 코드
품질이 "자신감 높고 품질 낮음" 방향으로 안 가도록 제도적 반례
생산자 수립. Phase ε 추출 여부 결정.

### 4.1 Critic agent

- [ ] **AG-δ1**: `agents/critic.ts` — proposal을 받아 "이 변경이
  어떤 snapshot에서 깨지는가" 탐색. 시나리오별 synthetic snapshot
  생성
- [ ] **AG-δ2**: backlog §9.1(A) **snapshot-bound simulate session**
  타입을 이 시점에 함께 붙임. SDK의 `projectSnapshot + simulateSync`
  이미 지원. Critic이 "이 snapshot에서 실행하면…" 시뮬 가능
- [ ] **AG-δ3**: counterexample이 발견되면 proposal에 경고 태그 붙여
  사용자에게 보여줌 (거절 강제는 안 함 — 판단은 사람)

### 4.2 전체 에이전트 loop 안정화

- [ ] **AG-δ4**: Orchestrator가 sub-agent 위임 결정을 어떻게 내리는지
  system prompt에 명문화 (refactor vs critic vs author)
- [ ] **AG-δ5**: Error cascade — tool failure, provider timeout, build
  failure 모두 사용자-친화적 메시지로 환원
- [ ] **AG-δ6**: Transcript export — 디버깅 / 이슈 리포트용 전체
  세션을 JSON + markdown으로 다운로드 가능

### 4.3 품질 gate

- [ ] **AG-δ7**: E2E 테스트 — headless browser로 "empty project →
  에이전트에게 addTodo action 만들어달라고 요청 → accept → dispatch
  → snapshot 확인"의 전 과정. 한 테스트에 5분 이내.
- [ ] **AG-δ8**: 10개 고정 프롬프트에 대한 응답 snapshot test
  (regression 방지)

### 4.4 추출 결정

- [ ] **AG-δ9**: AG-S1~S4 (추출 시그널) 재평가
- [ ] **AG-δ10**: 시그널 충족 시 → Phase ε 착수 (패키지 분리)
- [ ] **AG-δ11**: 시그널 미충족 시 → 현재 in-app 구조 유지하며 Phase
  ζ(후속 에이전트) 진행

### 4.5 검증 시나리오

- [ ] **AG-δ12**: Critic이 "proposal이 count=NaN일 때 무한 loop에
  빠짐" 같은 edge case를 실제로 찾아내는 케이스 확보
- [ ] **AG-δ13**: AG-δ7 E2E 통과
- [ ] **AG-δ14**: 5번 이상의 실사용 세션 (개발자 본인 + 테스터) 피드백
  수집

**Phase δ 종료 기준**: AG-δ7 E2E 통과 + 추출 결정 문서화.

---

## 5. Phase ε — 패키지 추출 (optional, δ 이후 결정)

> **Status: ❌ 미착수.** 추출 signal (AG-S1~S4) 중 AG-S4 (역방향
> import 금지) 만 달성. AG-S1 (webapp 외 consumer) / AG-S3 (외부
> 수요) 는 없음. 현 단계에선 추출 비 recommend.

AG-δ9에서 추출 결정 시에만 실행. 순서는 mechanical이지만 신중한
breaking change semver 필요.

- [ ] **AG-ε1**: `packages/studio-agent-core/` 생성. `tools/`,
  `agents/`, `session/` 이동. `package.json` / `tsconfig` /
  `tsup.config` 설정
- [ ] **AG-ε2**: `packages/studio-agent-react/` 생성. `ui/` 이동.
  studio-agent-core + studio-react 의존
- [ ] **AG-ε3**: webapp이 `@manifesto-ai/studio-agent-core` +
  `@manifesto-ai/studio-agent-react` consumer로 전환
- [ ] **AG-ε4**: 공개 API 문서화 — `studio-agent-core`의 tool function
  signature, agent composition pattern, transcript schema
- [ ] **AG-ε5**: studio-cli에 `agent` subcommand 실험적 추가 (두 번째
  consumer 확보 → AG-S1 충족)

---

## 6. Phase ζ — 후속 에이전트 (선택, 장기)

> **Status: ❌ 미착수.** 단, `inspectLineage` / `inspectConversation`
> / `recordAgentTurn` / subscribeAfterDispatch / mock data generator
> 같은 **원래 ζ 스코프였거나 계획 밖이었던 foundation 몇 개가
> 조기에 landing 됨** — AG-ζ3 turn-based dispatch queue, AG-ζ5
> agent-first telemetry 를 언젠가 붙일 때 이 기반 위에 앉힐 수 있음.

Phase α–δ의 infra 위에 추가 에이전트를 올리는 단계. 추출 여부와
독립적으로 진행 가능.

- [x] **AG-ζ1**: **MEL Authoring agent** — v1 headless package 로 조기
  landing. 완전 자율 authoring 이 아니라 ephemeral workspace + verified
  proposal 경계로 제한. Critic 커버리지는 후속.
- [ ] **AG-ζ2**: **UI Intent Translator** — "이 버튼 왜 막혔어?" 같은
  UI 자연어 → semantic target 매핑. DOM selection → graph node id
- [ ] **AG-ζ3**: **Turn-based dispatch session** (backlog §8.9) — 한
  턴에 여러 action proposal을 uncommitted queue로 관리, 승인 후 순차
  dispatch, 실패 시 rollback (lineage restore)
- [ ] **AG-ζ4**: **NLI chat pane** (backlog §8.10) — 자연어 입력을
  주된 인터랙션으로 승격. 사용자가 MEL을 아예 안 봐도 되는 모드
- [ ] **AG-ζ5**: **Agent-first telemetry** — transcript에서 자주
  걸리는 가드 / 자주 실패하는 proposal 패턴 집계, 제품 개선 피드백
  루프로 활용

---

## 7. 비목표 (non-goals)

- 자율 dispatch — 에이전트가 사람 승인 없이 `dispatchAsync`를
  호출하는 모드. 최소 Phase δ까지 금지.
- 멀티 유저 / 협업 — 단일 브라우저 단일 사용자 전제.
- LLM fine-tuning — 훈련 없이 base Claude + 좋은 prompt + 좋은 tool
  surface만으로 버틴다. Fine-tuning 이야기는 최소 10개 이상의 실사용
  세션이 쌓인 후.
- Visual agent (VM screenshot 해석 등) — 모든 interaction은 구조화된
  Studio surface를 통한다. 시각적 파싱 불필요.

---

## 8. Open questions (Phase 착수 시 해결)

- [ ] **AG-Q1**: System prompt 길이 예산 — Manifesto 개념 소개 +
  tool spec + 현재 스키마를 어떻게 압축? 현재 스키마 전체를 매
  turn에 넣으면 비용 폭발
- [ ] **AG-Q2**: Tool 응답 citation 포맷 — 에이전트가 "source line
  27"이라고 했을 때 UI가 자동으로 Monaco jump 링크를 만들어주는
  패턴을 system prompt에 hard-code? 아니면 post-process?
- [ ] **AG-Q3**: Session scoping — 세션은 project 단위? 아니면 action
  단위? 후자가 가볍지만 "도메인 전체에 대한 질문"을 하기 어려움
- [ ] **AG-Q4**: 실패 시 에이전트가 몇 번까지 retry? 무한 retry loop
  방지 — 기본 3회, 사용자가 interrupt 가능
- [ ] **AG-Q5**: Proposal 적용 후 rollback 범위 — Monaco 버퍼만?
  Snapshot도? 둘 다?
- [ ] **AG-Q6**: 에이전트가 도움 안 되는 답변을 할 때 피드백 루프 —
  thumbs up/down? Critic이 retroactively 평가?
- [ ] **AG-Q7**: `gemma4:e4b`의 실제 `num_ctx` 실측 후 scene packet /
  transcript compression 전략 튜닝. 32k+ 가능한 하드웨어이므로
  공격적 압축보다 정확한 context를 선호하는 방향으로 결정 가능성
  높음. Ollama `/api/show` 로 조회.
- [ ] **AG-Q8**: Ollama 서버 장애 / 응답 지연 시 UX — 사용자에게
  즉시 알림? 로컬 retry? "에이전트 사용 불가" 상태 표시?

---

## 9. 계획에 없었던 shipping (Phase α–β 내 추가 landings)

원 계획 수립 시 고려하지 못했거나 Phase δ+ 로 미뤄뒀던 구조물이
early-land 했음. 모두 **additive** (계획된 체크리스트를 치우고
들어간 게 아니라 위에 올렸음):

- **`StudioCore.subscribeAfterDispatch`** (packages/studio-core).
  단일 notifier seam — React provider / StudioUiRuntime / agent tool
  / MockDataPalette 전부 여기 구독. "누가 dispatch 하든 UI 가 알아
  서 재렌더" 가 규율-기반 → 구조-기반으로 승격됨. 이게 없었으면
  agent dispatch 시 UI 가 stale 되는 버그를 call-site 마다 리마인드
  해야 했을 것.
- **studio.mel 에 agent memory 단건 저장** — `lastUserPrompt` /
  `lastAgentAnswer` / `agentTurnCount` + `recordAgentTurn`. 대화
  타임라인이 Manifesto lineage 의 first-class 시민이 됨. Scrubbing
  과 매끄럽게 통합 가능 (아직 UI 는 미노출).
- **`inspectLineage`** — runtime dispatch 히스토리 탐색 툴. 원래
  Phase δ critic 영역 생각했는데 β 에서 projection 패턴의 자연스러운
  연장으로 앞당겨짐. `fields` 옵트인 + `intentType` 필터 +
  `beforeWorldId` 페이지네이션.
- **`inspectConversation`** — 에이전트 자신의 transcript 검색.
  recent-5-turns auto-grounding 의 long-horizon 보완.
- **Mock data 생성 삼위일체**:
  - `mock/generate.ts` (pure, seedable)
  - `agent/tools/seed-mock.ts` (generate + dispatch 원샷)
  - `agent/tools/generate-mock.ts` (preview only)
  - `mock/MockDataPalette.tsx` (human UI, Interact lens 내부)
  - 3 consumer 가 하나의 순수 함수 공유.
- **studio.mel 자체가 자체 Manifesto domain** — focus / lens /
  viewMode / simulation session / scrub envelope 이 React state 가
  아닌 Manifesto state. 에이전트가 이 runtime 도 `studioDispatch`
  로 조작 가능.
- **Production 스택** — Vercel Edge function `/api/agent/chat` +
  Upstash rate limit (fail-open) + Vercel Analytics + Google
  Analytics. 원 계획은 Phase δ+ 이었는데 Vercel AI Gateway 전환과
  함께 β 말에 조기 deploy.
- **UX 대대적 redesign** — 채팅 widget 느낌 제거, Studio 의 schema-
  graph / SnapshotTree 와 같은 시각 언어 (2px violet accent bar,
  channel-colored tool rows, hairline status strip). 사용자 피드백
  "이미 온보딩 에이전트" 확보.
- **SnapshotTree 재설계** — focus 에 따라 scope 를 좁히던 모드 →
  전체 트리 유지 + focused row 하이라이트 + ancestor 자동 expand +
  scrollIntoView. 데이터 분석 UX 개선.
- **`docs/building-agents-on-manifesto.md`** — 다음 Manifesto 런타임
  위에 에이전트 얹을 때 쓸 happy-path playbook. 이번 Phase 를 통해
  형성된 패턴 (MEL=identity/snapshot=state 분리, projection-first
  tools, escape-valve 제거, 채널 컬러링) 을 prescriptive 형식으로
  정리.

---

## 10. 관련 문서

- [§8 Agent-first Studio](./studio-backlog.md#8-agent-first-studio-—-deterministic-agent-observatory) — 에이전트
  개념 / 12개 에이전트 카탈로그 / 우선순위
- [§9.3 MEL Agent Integration](./studio-backlog.md#93-mel-agent-integration--이미-가능-문서예제만-필요) — agent-as-Node-library
  feasibility (webapp 외 사용처)
- [ux-philosophy.md](./studio/ux-philosophy.md) — Studio UX 5 pillars
  (agent도 이 원칙 준수)
- [phase-1-roadmap.md](./phase-1-roadmap.md) — Phase 1 체크리스트 참조
  (같은 형식)
- [building-agents-on-manifesto.md](./building-agents-on-manifesto.md)
  — 이번 Phase 에서 형성된 prescriptive playbook
