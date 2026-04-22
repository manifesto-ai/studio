# Studio Agent — Roadmap

> **Status:** 📝 **Draft — kickoff pending (2026-04-22)**
> **Ref:** [studio-backlog.md §8 Agent-first Studio](./studio-backlog.md), [phase-1-roadmap.md](./phase-1-roadmap.md)
> **Duration target:** 4 weeks prototype + 1 week extraction decision
> **Scope marker:** every item tagged `AG-*` below is a single trackable deliverable.

이 문서는 Studio에 에이전트 레이어를 얹는 단계별 실행 체크리스트이다.
"무엇을 왜"는 [`studio-backlog.md §8`](./studio-backlog.md#8-agent-first-studio-—-deterministic-agent-observatory)에 있고, 본 문서는 "언제 무엇을"을 추적한다.

핵심 가정은 두 가지다:

1. **Manifesto SDK가 이미 agent-first 설계**. Studio agent는 SDK introspection surface를 LLM-facing 도구로 노출할 뿐, legality / simulate / source-map 의미론을 재구현하지 않는다.
2. **패키지 분리는 4주 후 재평가**. Phase α–δ 동안엔 `apps/webapp/src/agent/`에 패키지처럼 구조화된 in-app 프로토타입으로 살되, `tools/` / `agents/` / `session/` 디렉토리는 React / webapp-local 의존을 받지 않는 규율을 유지한다.

---

## 0. 착수 전 합의 (Phase α 시작 전에 모두 ✓)

### 0.1 아키텍처 경계선

- [ ] **AG-B1**: `apps/webapp/src/agent/` 생성. 하위 구조:
  `tools/`, `agents/`, `session/`, `provider/`, `ui/`, `index.ts`.
- [ ] **AG-B2**: `tools/`, `agents/`, `session/` 세 디렉토리에서
  React / Monaco / webapp-local 모듈 import 금지. ESLint rule
  (`no-restricted-imports`)로 강제.
- [ ] **AG-B3**: `provider/`는 webapp-only. 추출 시점에 함께 이동하지
  않는다는 걸 디렉토리 README에 명시.
- [ ] **AG-B4**: `ui/`는 React 전용. LLM provider를 직접 import하지
  말고, prop / context로 주입 받음.

### 0.2 외부 의존성 결정

- [x] **AG-D1**: LLM provider는 **self-hosted Ollama**. 엔드포인트
  `http://100.84.214.42:11434/`, 모델 `gemma4:e4b`. 벤더 추상화
  없이 단일 provider로 시작. 교체 수요 실제 발생 시에만 추출.
- [ ] **AG-D2**: **Ollama 호환 client** — native API (`/api/chat`)
  vs OpenAI-호환 (`/v1/chat/completions`) 둘 중 선택. OpenAI-호환
  쪽이 tool-call 스펙이 문서화되어 있어 시작점으로 유력. Phase α
  첫 3일 안에 결정.
- [x] **AG-D3**: **네트워크 접근** — Tailscale private network로
  webapp이 Ollama endpoint에 직접 도달 가능함을 확인. CORS는
  Phase α에서 webapp origin으로 브라우저 요청을 넣을 때 점검. 막히면
  Vite dev proxy fallback, 서버측 `OLLAMA_ORIGINS` 화이트리스트 둘
  중 택일.
- [ ] **AG-D4**: **모델 host / 이름 config 화** — 개발 환경에서
  모델 교체가 잦을 수 있으므로, 엔드포인트와 모델명을 코드에
  하드코드하지 않고 `.env` / Studio settings로 주입.
- [x] **AG-D5**: **Function calling 품질 검증** — `gemma4:e4b`가
  Ollama에서 MEL 작성 / 수정을 하는 에이전트 구성으로 **이미 반복
  검증됨**. tool-call / structured output 지원 OK. 교체 없이 단일
  모델로 진행.
- [ ] **AG-D6**: 자원 guardrail — API token cost 없음. Latency +
  동시성만 관리. 호스트 스펙(4090 24GB VRAM / 64GB RAM / 7800X3D)
  기준 동시 요청 1~2개로 시작. `num_ctx` 실측 후 session token
  예산 결정.

### 0.3 추출 시그널 (Phase ε 트리거 조건)

다음 중 **2개 이상** 만족하면 `studio-agent-core` / `studio-agent-react`
패키지로 추출한다 (Phase δ 말 재평가).

- [ ] **AG-S1**: Consumer가 webapp 외 1개 이상 (studio-cli agent mode,
  GitHub Action 등)
- [ ] **AG-S2**: `tools/`의 function signature가 3주 이상 breaking
  change 없음
- [ ] **AG-S3**: webapp 외부에서 `@manifesto-ai/studio-agent-core`
  import 실제 수요 등장
- [ ] **AG-S4**: webapp이 `src/agent`를 쓰는 건 자연스러움; 역방향
  (`src/agent`가 webapp 내부 모듈을 import) 경고 신호 — 안 일어나야 함

---

## 1. Phase α — Infra (Week 1)

**Goal**: Single-tool orchestrator가 사용자 질문에 Legality Inspector
결과를 인용해 답하는 최소 루프 완성. "에이전트가 Studio 안에서
동작함"을 증명.

### 1.1 Deterministic tool layer — Legality Inspector

- [ ] **AG-α1**: `agent/tools/types.ts` — `ToolName`,
  `ToolCallRequest`, `ToolCallResult`, `ToolError` 기본 타입
- [ ] **AG-α2**: `agent/tools/legality.ts` — `legalityInspect(intent)`
  wraps `core.explainIntent` + `core.whyNot`. 반환: LLM-facing JSON
  (layer, blockers with resolved ref values, counterfactual hint).
  `renderExprWithValues`와 같은 resolver 로직 재사용.
- [ ] **AG-α3**: `agent/tools/types.ts`에 Anthropic function-call
  스펙 제너레이터 (`toAnthropicTool(def)`) — 각 tool이 자기
  description + schema를 export하도록

### 1.2 LLM provider wrapper (Ollama)

- [ ] **AG-α4**: `agent/provider/ollama.ts` —
  `createMessage({messages, tools, system})` wrapper. OpenAI-호환
  endpoint (`/v1/chat/completions`) 우선 시도 (tool-call 스펙
  표준). 실패 시 native `/api/chat` fallback.
- [ ] **AG-α5**: 엔드포인트 / 모델명은 `.env` 또는 Studio settings
  에서 주입. Default: `OLLAMA_URL=http://100.84.214.42:11434`,
  `OLLAMA_MODEL=gemma4:e4b`.
- [ ] **AG-α5b**: **Network path 확인** — webapp이 dev(Vite) /
  production(Vercel) 모두에서 Ollama endpoint에 도달 가능한지
  검증. 불가 시 Vite proxy 또는 서버사이드 forwarding 추가.
- [ ] **AG-α5c**: **스트리밍** — Ollama는 `stream: true` 지원.
  UI에서 토큰별 프린트로 시작. 실패 / rate-limit 시 fallback
  non-stream.

### 1.3 Orchestrator (single-turn)

- [ ] **AG-α6**: `agent/agents/orchestrator.ts` — 사용자 메시지 +
  현재 Studio context → Ollama message loop. Tool call 1회까지
  지원 (`max_tool_uses: 1`로 시작, Week 2에 확장). 모델이 tool
  call을 안정적으로 emit 못 하는 경우 JSON-in-text 파싱으로
  fallback (AG-D5와 연동).
- [ ] **AG-α7**: System prompt — Manifesto 개념 요약, 사용 가능한
  도구 목록, 응답 형식 규칙 (markdown prose, AST dump 금지, 소스
  인용 시 line 번호 포함)
- [ ] **AG-α8**: Context packet serializer — 현재 focus, selected
  action, snapshot의 subset, 최근 dispatch를 LLM prompt 사이즈에
  맞게 JSON으로 압축

### 1.4 Session state (in-memory)

- [ ] **AG-α9**: `agent/session/transcript.ts` — in-memory turn log.
  각 turn: user prompt, tool calls, tool results, assistant response
- [ ] **AG-α10**: StudioProvider에 `useAgentSession()` 훅 추가.
  project switching 시 reset (Phase β에서 persistent로 전환)

### 1.5 UI shell — Agent lens

- [ ] **AG-α11**: `agent/ui/AgentLens.tsx` — `LensPane`의 6번째
  lens. 채팅 입력 + 응답 스트림
- [ ] **AG-α12**: `LensPane` + icon rail에 `"agent"` lens 등록
- [ ] **AG-α13**: 메시지 렌더러 — user / assistant / tool-call
  블록 구분 스타일. assistant 응답에서 tool 사용 인용 시 링크
  (legality 결과를 클릭하면 Ladder lens로 이동)
- [ ] **AG-α14**: 로딩 / error 상태 (LLM 호출 실패, rate limit 등)

### 1.6 검증 시나리오

- [ ] **AG-α15**: "왜 toggleTodo가 blocked인가?" 질문 → 에이전트가
  `legalityInspect` 호출 → blocker + counterfactual로 자연어 설명
- [ ] **AG-α16**: 같은 질문을 다른 action / 다른 snapshot 상태에서
  반복 → 응답이 실제 state에 근거하는지 확인 (hallucinate 안 함)
- [ ] **AG-α17**: Studio 외 모든 UX 기능(그래프 클릭 포커스, 시뮬레이션
  세션 등)이 그대로 동작하는지 회귀 확인

**Phase α 종료 기준**: AG-α15 시나리오가 사용 가능하게 작동. 응답
속도는 상관 없음 (Week 2 이후 최적화 대상).

---

## 2. Phase β — Tool expansion (Week 2)

**Goal**: Orchestrator가 multi-tool 계획을 세우고, transcript가
persistent. 에이전트가 "legality + simulation + source 인용"을
합성해 답할 수 있음.

### 2.1 추가 deterministic tools

- [ ] **AG-β1**: `tools/simulate.ts` — `simulateIntent(intent)` wraps
  `core.simulate`. 반환: changedPaths 요약, new available actions,
  trace tree summary (depth 제한)
- [ ] **AG-β2**: `tools/source-map.ts` — `locate(localKey)` →
  `{line, column, preview}`. 역방향 `whatIsAtLine(line, col)` 지원
- [ ] **AG-β3**: `tools/graph.ts` — `upstream(nodeId)`,
  `downstream(nodeId)`, `blastRadius(nodeId)`. `buildGraphModel`
  결과를 BFS로 projection
- [ ] **AG-β4**: `tools/schema.ts` — `describeAction(name)` — action
  param schema + 가드 문자열 + source location을 LLM-facing shape으로
- [ ] **AG-β5**: `tools/snapshot.ts` — `readSnapshot()` — 현재
  canonical snapshot 요약. 대용량일 때 path-level summarization

### 2.2 Multi-tool orchestrator

- [ ] **AG-β6**: orchestrator가 한 turn에서 여러 tool_use → 결과 수합
  → 다음 tool_use 라우팅 지원 (`max_tool_uses: 5`)
- [ ] **AG-β7**: tool call failure / invalid args 복구 로직 —
  에이전트에게 re-try 기회 주기

### 2.3 Persistent session

- [ ] **AG-β8**: `agent/session/store.ts` — IndexedDB에 transcript
  저장. 기존 `ProjectRecord`에 `agentSessions?: AgentSession[]`
  필드 추가 (storage schema v2)
- [ ] **AG-β9**: schema migration v1 → v2 (자동, 기존 project 데이터
  보존)
- [ ] **AG-β10**: project switch 시 session 복원. "이전 대화" 리스트에서
  과거 세션 재개 가능

### 2.4 Context quality

- [ ] **AG-β11**: scene packet — selected node / focus 기반의
  minimal but sufficient context. token budget 내에서 priority 있는
  정보만 담기
- [ ] **AG-β12**: delta context — transcript가 길어질 때 old turn의
  tool results 요약 압축 (full JSON 대신 citation만 유지)

### 2.5 검증 시나리오

- [ ] **AG-β13**: "decrement를 어떻게 dispatchable하게 만들 수 있지?"
  → orchestrator가 `legalityInspect` → `describeAction` →
  `upstream(count)`을 연쇄 호출해 "count를 증가시켜야 함. setCount
  같은 action 있음"을 종합 답변
- [ ] **AG-β14**: Transcript persistence — 프로젝트 바꾸고 돌아와도
  이전 대화 이어지는지
- [ ] **AG-β15**: token budget 제어 — 긴 세션에서 max token /
  cost 한도 내 동작

**Phase β 종료 기준**: AG-β13 시나리오 작동 + AG-β14 persistent.

---

## 3. Phase γ — Refactor agent + proposal buffer (Week 3)

**Goal**: 에이전트가 MEL 편집을 제안하고, 사용자는 diff + simulate
preview를 보고 승인/거부. 첫 "쓰기" 에이전트.

### 3.1 Proposal buffer

- [ ] **AG-γ1**: `agent/session/proposal-buffer.ts` — 제안된 MEL
  변경을 unsaved buffer로 유지. `{original, proposed, diffHunks}`
  shape
- [ ] **AG-γ2**: webapp의 Monaco 실제 source는 **승인 전엔 건드리지
  않음**. `adapter.setSource`는 승인 이후에만 호출
- [ ] **AG-γ3**: proposal에 대해 shadow `createStudioCore` 인스턴스를
  돌려 simulate 결과 미리보기 (`simulate-agent-preview.ts`)

### 3.2 Refactor/Repair agent

- [ ] **AG-γ4**: `agents/refactor.ts` — scoped edit 전문 sub-agent.
  입력: 현재 action/guard + 사용자 의도, 출력: proposed MEL + 변경
  이유
- [ ] **AG-γ5**: Orchestrator가 사용자 질의에 따라 refactor sub-agent
  위임 (예: "decrement가 negative도 허용하게 해줘" → refactor agent에
  이관, 결과를 proposal buffer로 묶음)

### 3.3 Contract Verifier (deterministic gate)

- [ ] **AG-γ6**: proposal을 실제 적용하기 전 `core.build()` 실행,
  diagnostics 수집. 컴파일 실패 시 에이전트에게 re-attempt 요청
- [ ] **AG-γ7**: Reserved namespace (`$host`, `$mel`, `$system`)
  오염 검사 + identifier 충돌 검사 (deterministic lint rules)

### 3.4 UI — Proposal preview

- [ ] **AG-γ8**: `ui/ProposalPreview.tsx` — split-pane diff
  (Monaco diff editor). Accept / Reject / Discuss 버튼
- [ ] **AG-γ9**: proposal inline에서 IntentLadder를 "before" vs "after"
  로 렌더 — 변경이 legality를 어떻게 바꾸는지 미리 보기
- [ ] **AG-γ10**: Accept 시 `adapter.setSource` + `requestBuild`.
  에이전트 응답에 "proposed and accepted — rebuilt" 기록
- [ ] **AG-γ11**: Reject 시 proposal 폐기 + 이유 prompt ("왜
  거절했는지 에이전트에 알려주기" optional input)

### 3.5 안전 장치

- [ ] **AG-γ12**: 에이전트는 한 turn에 최대 1개 proposal만 생성 (spam
  방지)
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

Phase α–δ의 infra 위에 추가 에이전트를 올리는 단계. 추출 여부와
독립적으로 진행 가능.

- [ ] **AG-ζ1**: **MEL Authoring agent** — 완전 신규 entity 생성
  (state / action / computed). Refactor agent보다 리스크 높음, Critic
  커버리지 필수
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

## 9. 관련 문서

- [§8 Agent-first Studio](./studio-backlog.md#8-agent-first-studio-—-deterministic-agent-observatory) — 에이전트
  개념 / 12개 에이전트 카탈로그 / 우선순위
- [§9.3 MEL Agent Integration](./studio-backlog.md#93-mel-agent-integration--이미-가능-문서예제만-필요) — agent-as-Node-library
  feasibility (webapp 외 사용처)
- [ux-philosophy.md](./studio/ux-philosophy.md) — Studio UX 5 pillars
  (agent도 이 원칙 준수)
- [phase-1-roadmap.md](./phase-1-roadmap.md) — Phase 1 체크리스트 참조
  (같은 형식)
