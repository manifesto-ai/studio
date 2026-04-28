/**
 * AgentLens — live Manifesto agent surface.
 *
 * Step 5b cutover: the AI SDK's `useChat` is gone. AgentSession owns
 * the turn lifecycle through `createAgentSessionDriver`, which calls
 * the model via `createAiSdkModelAdapter` (still using the same
 * server route under `/api/agent/chat`) and runs tools through
 * `createDefaultToolExecutor`. This lens is now thin in earnest:
 *   1. Compose tool implementations and inject them into the driver's
 *      executor.
 *   2. Subscribe React to the AgentSession projection so the
 *      MessageList renders from MEL lineage.
 *   3. On send / stop, dispatch into AgentSession and let the driver
 *      orchestrate model + tool effects.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  DefaultChatTransport,
  type UIMessage,
} from "ai";
import { AnimatePresence, motion } from "motion/react";
import { useStudio } from "@manifesto-ai/studio-react";
import type { StudioCore } from "@manifesto-ai/studio-core";
import {
  useStudioUi,
  type StudioUiSnapshot,
} from "@/domain/StudioUiRuntime";
import {
  useAgentSession,
  readAgentSessionSnapshot,
  type AgentSessionSnapshot,
} from "@/domain/AgentSessionRuntime";
import {
  createAgentSessionShadow,
  type AgentSessionShadow,
  type AgentSessionShadowRuntime,
} from "../session/agent-session-shadow.js";
import { createAgentSessionDriver } from "../session/agent-session-effects.js";
import { createAiSdkModelAdapter } from "../session/aisdk-model-adapter.js";
import { createDefaultToolExecutor } from "../session/agent-session-tool-executor.js";
import { createAgentSessionAnchorEffect } from "../session/agent-session-anchor.js";
import {
  ANCHOR_SUMMARIZATION_SYSTEM_PROMPT,
  createAiSdkAnchorSummarizer,
} from "../session/aisdk-anchor-summarizer.js";
import {
  buildUiMessagesForTransport,
  conversationToAgentMessages,
} from "../session/conversation-to-messages.js";
import { bindTool } from "../tools/types.js";
import {
  createAdmittedToolRegistry,
  createInspectToolAffordancesTool,
  type ToolAdmissionRuntime,
  type ToolImplementation,
} from "../tools/affordances.js";
import {
  createDispatchTool,
  type DispatchContext,
  type DispatchResultLike,
} from "../tools/dispatch.js";
import {
  createLegalityTool,
  type LegalityContext,
} from "../tools/legality.js";
import {
  createStudioDispatchTool,
  type StudioDispatchContext,
} from "../tools/studio-dispatch.js";
import {
  createInspectFocusTool,
  type InspectFocusContext,
} from "../tools/inspect-focus.js";
import {
  createInspectSchemaTool,
  type InspectSchemaContext,
} from "../tools/inspect-schema.js";
import {
  createInspectSnapshotTool,
  type InspectSnapshotContext,
} from "../tools/inspect-snapshot.js";
import {
  createInspectNeighborsTool,
  type InspectNeighborsContext,
} from "../tools/inspect-neighbors.js";
import {
  createInspectLineageTool,
  type FullLineageEntry,
  type InspectLineageContext,
} from "../tools/inspect-lineage.js";
import {
  createInspectConversationTool,
  type InspectConversationContext,
} from "../tools/inspect-conversation.js";
import {
  createInspectAvailabilityTool,
  type InspectAvailabilityContext,
} from "../tools/inspect-availability.js";
import {
  createSimulateIntentTool,
  type SimulateIntentContext,
} from "../tools/simulate-intent.js";
import {
  createGenerateMockTool,
  type GenerateMockContext,
} from "../tools/generate-mock.js";
import {
  createSeedMockTool,
  type SeedMockContext,
  type SeedMockDispatchResult,
} from "../tools/seed-mock.js";
import {
  buildAgentSystemPrompt,
  readStudioAgentContext,
  type TurnStartSnapshot,
} from "../session/agent-context.js";
import {
  digestSchema,
  digestSnapshot,
  formatSchemaDigestMarkdown,
} from "../digest/manifesto-digest.js";
import { buildActiveTurnMessages } from "../session/active-turn-messages.js";
import { buildRecentTurnsFromMessages } from "../session/recent-turns.js";
import { buildToolSchemaMap } from "../adapters/ai-sdk-tools.js";
import { MarkdownBody } from "./MarkdownBody.js";
import { ToolActivityRow } from "./ToolActivity.js";
import type {
  ConversationProjection,
  TurnEntry,
  TurnStep,
} from "@/agent/session/agent-session-types";
import {
  projectAction,
  projectEntity,
  projectFocus,
  type ManifestoProjectionInput,
} from "@/projections/manifesto-projections";

export function AgentLens(): JSX.Element {
  const { core } = useStudio();
  const ui = useStudioUi();
  const agentSession = useAgentSession();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Streaming text overlay for the in-flight assistant turn. Driven
  // by the model adapter's text-delta events and cleared on each new
  // model invocation. Lives in React state, not MEL — per the
  // step 5a streaming-text decision.
  const [streamingText, setStreamingText] = useState("");

  const uiSnapshotRef = useRef(ui.snapshot);
  uiSnapshotRef.current = ui.snapshot;

  const uiRef = useRef(ui);
  uiRef.current = ui;

  // Shadow now serves two roles:
  //   1. dispatcher for the AgentSessionDriver's turn lifecycle
  //   2. host-side conversation projection for rendering
  // It no longer mirrors the AI SDK — there is no AI SDK left. The
  // driver dispatches THROUGH the shadow so projection stays in sync.
  const agentSessionRef = useRef(agentSession);
  agentSessionRef.current = agentSession;
  const shadow = useMemo<AgentSessionShadow>(() => {
    const runtime: AgentSessionShadowRuntime = {
      get ready() {
        return agentSessionRef.current.ready;
      },
      // Read direct from core to bypass React-state staleness inside
      // subscribeAfterDispatch listeners. agentSession.snapshot only
      // updates on the next render, which races with the dispatch
      // notifications the driver is responding to.
      get snapshot() {
        return readAgentSessionSnapshot(agentSessionRef.current.core);
      },
      createIntent: (action, ...args) =>
        agentSessionRef.current.createIntent(action, ...args),
      dispatchAsync: (intent) =>
        agentSessionRef.current.dispatchAsync(intent),
    };
    return createAgentSessionShadow(runtime);
  }, []);

  // Subscribe React to the shadow's conversation projection. Identity-
  // stable on no-op renders so the MessageList memoization holds.
  const conversation = useSyncExternalStore(
    shadow.subscribe,
    shadow.getConversation,
    shadow.getConversation,
  );
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  const toolImplementations = useMemo<readonly ToolImplementation[]>(() => {
    const userCtx = buildUserToolContext(core);
    const inspectFocusCtx: InspectFocusContext = {
      getFocus: () =>
        projectFocus(
          buildManifestoProjectionInput(core, uiSnapshotRef.current),
        ),
    };
    const inspectSchemaCtx: InspectSchemaContext = {
      getModule: () => core.getModule(),
    };
    const inspectSnapshotCtx: InspectSnapshotContext = {
      getSnapshot: () => core.getSnapshot(),
    };
    const inspectNeighborsCtx: InspectNeighborsContext = {
      getRelations: (nodeId) => {
        const projected = projectEntity(
          nodeId,
          buildManifestoProjectionInput(core, uiSnapshotRef.current),
        );
        return projected.status === "ok" ? projected.relations : null;
      },
      getEdges: () => core.getModule()?.graph?.edges ?? [],
      hasNode: (nodeId) =>
        core.getModule()?.graph?.nodes?.some((n) => n.id === nodeId) ?? false,
    };
    const inspectLineageCtx: InspectLineageContext = {
      getLineage: () => readLineageEntries(core),
    };
    const inspectConversationCtx: InspectConversationContext = {
      getMessages: () => conversationToAgentMessages(conversationRef.current),
    };
    const inspectAvailabilityCtx: InspectAvailabilityContext = {
      listActionNames: () => listActionNames(core),
      isActionAvailable: (name) => core.isActionAvailable(name),
      describeAction: (name) => {
        const projected = projectAction(
          name,
          buildManifestoProjectionInput(core, uiSnapshotRef.current),
        );
        if (projected.status !== "ok" || projected.action === null) {
          return null;
        }
        return {
          paramNames: projected.action.params,
          paramHints: projected.action.paramHints,
          inputHint: projected.action.inputHint,
          hasDispatchableGate: projected.action.hasDispatchableGate,
          description: projected.action.description ?? undefined,
        };
      },
    };
    const simulateIntentCtx: SimulateIntentContext = {
      createIntent: (action, ...args) => core.createIntent(action, ...args),
      explainIntent: (intent) =>
        core.explainIntent(
          intent as Parameters<typeof core.explainIntent>[0],
        ) as never,
      simulate: (intent) =>
        core.simulate(intent as Parameters<typeof core.simulate>[0]) as never,
      listActionNames: () => listActionNames(core),
    };
    const generateMockCtx: GenerateMockContext = {
      getModule: () => core.getModule(),
    };
    const seedMockCtx: SeedMockContext = {
      getModule: () => core.getModule(),
      createIntent: (action, ...args) => core.createIntent(action, ...args),
      dispatchAsync: (intent) =>
        core.dispatchAsync(
          intent as Parameters<typeof core.dispatchAsync>[0],
        ) as unknown as Promise<SeedMockDispatchResult>,
    };

    const tools: ToolImplementation[] = [
      {
        tool: bindTool(createInspectToolAffordancesTool(), {
          getTools: () => tools,
          getRuntime: () => buildToolAdmissionRuntime(uiRef.current.core),
          getDomainActionNames: () => listActionNames(core),
        }),
        admissionAction: "admitInspectToolAffordances",
      },
      {
        tool: bindTool(createInspectFocusTool(), inspectFocusCtx),
        admissionAction: "admitInspectFocus",
      },
      {
        tool: bindTool(createInspectSchemaTool(), inspectSchemaCtx),
        admissionAction: "admitInspectSchema",
      },
      {
        tool: bindTool(
          createStudioDispatchTool(),
          ui.core !== null ? buildStudioToolContext(ui.core) : nullStudioContext(),
        ),
        admissionAction: "admitStudioDispatch",
      },
      {
        tool: bindTool(createInspectSnapshotTool(), inspectSnapshotCtx),
        admissionAction: "admitInspectSnapshot",
      },
      {
        tool: bindTool(createInspectAvailabilityTool(), inspectAvailabilityCtx),
        admissionAction: "admitInspectAvailability",
      },
      {
        tool: bindTool(createInspectNeighborsTool(), inspectNeighborsCtx),
        admissionAction: "admitInspectNeighbors",
      },
      {
        tool: bindTool(createInspectLineageTool(), inspectLineageCtx),
        admissionAction: "admitInspectLineage",
      },
      {
        tool: bindTool(createInspectConversationTool(), inspectConversationCtx),
        admissionAction: "admitInspectConversation",
      },
      {
        tool: bindTool(createLegalityTool(), userCtx),
        admissionAction: "admitExplainLegality",
      },
      {
        tool: bindTool(createSimulateIntentTool(), simulateIntentCtx),
        admissionAction: "admitSimulateIntent",
      },
      {
        tool: bindTool(createGenerateMockTool(), generateMockCtx),
        admissionAction: "admitGenerateMock",
      },
      {
        tool: bindTool(createSeedMockTool(), seedMockCtx),
        admissionAction: "admitSeedMock",
      },
      {
        tool: bindTool(createDispatchTool(), userCtx),
        admissionAction: "admitDispatch",
      },
    ];
    return tools;
  }, [core, ui.core]);

  // Transport built once and reused across model invocations.
  // prepareSendMessagesRequest still owns body composition (system
  // prompt, tools schema, transport message trimming) — same logic
  // as before, but it now reads recent turns from the AgentSession
  // projection rather than a useChat-managed message ref.
  const transportRef = useRef<DefaultChatTransport<UIMessage> | null>(null);
  if (transportRef.current === null) {
    transportRef.current = new DefaultChatTransport<UIMessage>({
      api: "/api/agent/chat",
      prepareSendMessagesRequest: async ({ messages, id }) => {
        const fullMessages = messages as UIMessage[];
        const snap = uiSnapshotRef.current;
        await syncAgentToolContext({
          core,
          uiCore: uiRef.current.core,
          uiSnapshot: snap,
        });
        const admissionRuntime = buildToolAdmissionRuntime(uiRef.current.core);
        const availableRegistry = createAdmittedToolRegistry(
          toolImplementations,
          admissionRuntime,
        );
        const transportMessages = buildActiveTurnMessages(fullMessages);
        const agentMessages = conversationToAgentMessages(
          conversationRef.current,
        );
        const agentContext = readStudioAgentContext({
          studioMelDigest: readStudioMelDigest(uiRef.current.core),
          recentTurns: buildRecentTurnsFromMessages(agentMessages),
          runtimeSignals: {
            selectedNodeChanged: !snap.agentFocusFresh,
            currentFocusedNodeId: snap.focusedNodeId,
            currentFocusedNodeKind: snap.focusedNodeKind,
          },
          turnStartSnapshot: isInitialUserTurnRequest(transportMessages)
            ? readTurnStartSnapshot(core, snap)
            : null,
        });
        const baseSystem = buildAgentSystemPrompt(agentContext);
        // Inject the latest anchor summary if present. The anchor is
        // a compressed memory of older turns produced by the anchor
        // effect — older settled turns aren't re-sent in messages, so
        // this is how they survive in the agent's working context.
        const anchor = readAgentSessionSnapshot(
          agentSessionRef.current.core,
        ).lastAnchorSummary;
        const system =
          anchor !== null && anchor.trim() !== ""
            ? `${baseSystem}\n\n## Past session summary\n\nOlder turns have been compressed into the following summary. Treat it as authoritative context for anything not in the recent-turn tail:\n\n${anchor.trim()}`
            : baseSystem;
        return {
          body: {
            id,
            messages: transportMessages,
            system,
            tools: buildToolSchemaMap(availableRegistry),
            maxSteps: 10,
            temperature: 0.2,
          },
        };
      },
    });
  }

  // Separate transport for anchor summarization. Same /api/agent/chat
  // endpoint, but the body excludes tool schemas and uses a
  // summarization-focused system prompt — the anchor effect wants a
  // one-shot text completion, not an agent turn.
  const anchorTransportRef = useRef<DefaultChatTransport<UIMessage> | null>(
    null,
  );
  if (anchorTransportRef.current === null) {
    anchorTransportRef.current = new DefaultChatTransport<UIMessage>({
      api: "/api/agent/chat",
      prepareSendMessagesRequest: async ({ messages, id }) => ({
        body: {
          id,
          messages,
          system: ANCHOR_SUMMARIZATION_SYSTEM_PROMPT,
          tools: {},
          temperature: 0.3,
        },
      }),
    });
  }

  // Mount the AgentSessionDriver. It subscribes to phase transitions
  // on the AgentSession runtime: `awaitingModel` triggers a model
  // call via the AI SDK transport; `awaitingTool` runs the
  // executor. The driver dispatches recordToolCall /
  // recordToolResult / recordAssistantSettled /
  // recordModelInvocationFailed through the shadow so the
  // conversation projection updates atomically with MEL state.
  useEffect(() => {
    if (!agentSession.ready || agentSession.core === null) return;
    const transport = transportRef.current;
    if (transport === null) return;

    const modelAdapter = createAiSdkModelAdapter({
      transport,
      buildMessages: () => buildUiMessagesForTransport(conversationRef.current),
    });

    const toolExecutor = createDefaultToolExecutor({
      toolImplementations,
      buildAdmissionRuntime: () => buildToolAdmissionRuntime(uiRef.current.core),
      listDomainActionNames: () => listActionNames(core),
      syncContext: () =>
        syncAgentToolContext({
          core,
          uiCore: uiRef.current.core,
          uiSnapshot: uiSnapshotRef.current,
        }),
      markObserved: async (toolName, output) => {
        if (
          toolName === "inspectSchema" ||
          toolName === "explainLegality"
        ) {
          await markAgentSchemaObserved(uiRef.current.core, output);
        } else if (toolName === "inspectFocus") {
          await markAgentFocusObserved(uiRef.current.core, output);
        }
      },
    });

    const driver = createAgentSessionDriver({
      runtime: {
        get ready() {
          return agentSessionRef.current.ready;
        },
        // Direct core read — listener callbacks fire synchronously
        // after MEL state settles, before React re-renders, so we
        // can't trust the React-state-mediated snapshot.
        get snapshot() {
          return readAgentSessionSnapshot(agentSessionRef.current.core);
        },
        createIntent: (action, ...args) =>
          agentSessionRef.current.createIntent(action, ...args),
        dispatchAsync: (intent) =>
          agentSessionRef.current.dispatchAsync(intent),
        subscribeAfterDispatch: (listener) => {
          const sessionCore = agentSessionRef.current.core;
          if (sessionCore === null) return () => {};
          return sessionCore.subscribeAfterDispatch(listener);
        },
      },
      dispatcher: {
        recordModelInvocation: (tier) => shadow.onModelInvocation(tier),
        recordToolCall: (callId, toolName, input) =>
          shadow.onToolCall(callId, toolName, input),
        recordToolResult: (callId, outcome, output) =>
          shadow.onToolResult(callId, outcome, output),
        recordAssistantSettled: (text) => shadow.onAssistantSettled(text),
        recordModelInvocationFailed: (reason) =>
          shadow.onModelInvocationFailed(reason),
        recordBudget: (deltaMc) => shadow.recordBudget(deltaMc),
        getToolInput: (callId) => shadow.getToolInput(callId),
      },
      modelAdapter,
      toolExecutor,
      handlers: {
        onTextDelta: (delta) => setStreamingText((prev) => prev + delta),
        onInvocationStart: () => setStreamingText(""),
        onUnexpectedError: (err) => {
          console.error("[AgentLens] driver error:", err);
        },
      },
    });

    // Anchor effect: every N settled turns, summarize the window
    // through the small-model effect handler and dispatch
    // anchorWindow. The dispatched summary lands in MEL state and
    // gets injected into subsequent agent system prompts.
    const anchorTransport = anchorTransportRef.current;
    let anchorEffect: ReturnType<typeof createAgentSessionAnchorEffect> | null = null;
    if (anchorTransport !== null) {
      const summarizer = createAiSdkAnchorSummarizer({
        transport: anchorTransport,
      });
      anchorEffect = createAgentSessionAnchorEffect({
        runtime: {
          get ready() {
            return agentSessionRef.current.ready;
          },
          get snapshot() {
            return readAgentSessionSnapshot(agentSessionRef.current.core);
          },
          createIntent: (action, ...args) =>
            agentSessionRef.current.createIntent(action, ...args),
          dispatchAsync: (intent) =>
            agentSessionRef.current.dispatchAsync(intent),
          subscribeAfterDispatch: (listener) => {
            const sessionCore = agentSessionRef.current.core;
            if (sessionCore === null) return () => {};
            return sessionCore.subscribeAfterDispatch(listener);
          },
        },
        conversation: () => shadow.getConversation(),
        getLatestWorldId: () => {
          const sessionCore = agentSessionRef.current.core;
          if (sessionCore === null) return null;
          const head = sessionCore.getLineage().head;
          return head !== null ? String(head.worldId) : null;
        },
        dispatcher: {
          anchorWindow: async (fromWorldId, toWorldId, summary) => {
            try {
              const intent = agentSessionRef.current.createIntent(
                "anchorWindow",
                fromWorldId,
                toWorldId,
                summary,
              );
              const result =
                await agentSessionRef.current.dispatchAsync(intent);
              return result.kind === "completed";
            } catch (err) {
              console.warn("[AgentLens] anchorWindow dispatch threw:", err);
              return false;
            }
          },
          recordBudget: (deltaMc) => shadow.recordBudget(deltaMc),
        },
        summarizer,
        policy: { turnsBetweenAnchors: 5, costMc: 20 },
        handlers: {
          onAnchorFailed: (err) => {
            console.warn("[AgentLens] anchor summarization failed:", err);
          },
        },
      });
    }

    return () => {
      driver.stop();
      anchorEffect?.stop();
    };
  }, [agentSession.ready, agentSession.core, core, shadow, toolImplementations]);

  const sending = agentSession.snapshot.isProcessing;

  const onSend = useCallback(() => {
    const prompt = draft.trim();
    if (prompt === "") return;
    if (ui.core === null) {
      setNotice("Studio runtime is still starting. Try again shortly.");
      return;
    }
    if (!agentSession.ready) {
      setNotice("Agent runtime is still starting. Try again shortly.");
      return;
    }
    setNotice(null);
    setDraft("");
    setStreamingText("");
    void (async () => {
      try {
        await syncAgentToolContext({
          core,
          uiCore: ui.core,
          uiSnapshot: uiSnapshotRef.current,
        });
        // The driver subscribes to phase transitions; once
        // recordUserTurn lands, AgentSession is in awaitingModel and
        // the driver picks up automatically.
        const turnId = await shadow.onUserTurn(prompt);
        if (turnId === null) {
          setDraft(prompt);
          setNotice(
            "Could not start a turn — runtime is still busy with the previous one.",
          );
        }
      } catch (err) {
        setDraft(prompt);
        setNotice(
          `Could not send message: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    })();
  }, [agentSession.ready, core, draft, shadow, ui.core]);

  const onStop = useCallback(() => {
    void shadow.onSessionStop();
  }, [shadow]);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const handleSelectStarter = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (el === null) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }, []);

  const agentState = sending ? "streaming" : "ready";

  return (
    <div
      className="relative flex flex-col flex-1 min-h-0 overflow-hidden"
      data-agent-state={agentState}
    >
      <div className="agent-ambient" aria-hidden="true" />
      <div className="relative z-10 flex flex-col flex-1 min-h-0">
        <StatusBar
          phase={agentSession.snapshot.phase}
          lastModelError={agentSession.snapshot.lastModelError}
          canClear={conversation.turns.length > 0 && !sending}
          onClear={() => shadow.clearConversation()}
        />
        <AnimatePresence initial={false}>
          {notice !== null ? <Notice key="notice" message={notice} /> : null}
        </AnimatePresence>
        <MessageList
          conversation={conversation}
          streamingText={streamingText}
          onSelectStarter={handleSelectStarter}
        />
        <Composer
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onSend={onSend}
          onStop={onStop}
          inputRef={composerRef}
        />
      </div>
    </div>
  );
}

function StatusBar({
  phase,
  lastModelError,
  canClear,
  onClear,
}: {
  readonly phase: AgentSessionSnapshot["phase"];
  readonly lastModelError: string | null;
  readonly canClear: boolean;
  readonly onClear: () => void;
}): JSX.Element {
  const label =
    lastModelError !== null
      ? `error: ${lastModelError}`
      : phase === "streaming"
        ? "streaming"
        : phase === "awaitingTool"
          ? "tool"
          : phase === "awaitingModel"
            ? "thinking"
            : phase === "stopped"
              ? "stopped"
              : "ready";
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-rule)] text-[10.5px] font-mono">
      <span className="text-[var(--color-ink-dim)]">agent</span>
      <span className="text-[var(--color-ink-mute)] truncate">/ {label}</span>
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        className="ml-auto text-[var(--color-ink-mute)] hover:text-[var(--color-ink)] disabled:opacity-30"
      >
        clear
      </button>
    </div>
  );
}

function Notice({ message }: { readonly message: string }): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: -4, height: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="mx-4 mt-3 overflow-hidden rounded-[8px] border border-[var(--color-rule)] px-3 py-2 text-[11.5px] text-[var(--color-ink-dim)]"
    >
      {message}
    </motion.div>
  );
}

function MessageList({
  conversation,
  streamingText,
  onSelectStarter,
}: {
  readonly conversation: ConversationProjection;
  /**
   * Live assistant text from the model adapter's text-delta events for the in-flight turn.
   * Empty string when nothing is streaming. The projection's
   * settledText replaces this once recordAssistantSettled fires.
   */
  readonly streamingText: string;
  readonly onSelectStarter: (text: string) => void;
}): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [conversation, streamingText]);

  const turns = conversation.turns;
  return (
    <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-5">
      {turns.length === 0 ? (
        <EmptyState onSelectStarter={onSelectStarter} />
      ) : (
        <ol className="flex flex-col gap-4">
          <AnimatePresence initial={false} mode="popLayout">
            {turns.map((turn, i) => {
              const isLast = i === turns.length - 1;
              const finalText =
                turn.settledText ?? (isLast ? streamingText : "");
              return (
                <motion.li
                  key={turn.turnId}
                  layout="position"
                  initial={{ opacity: 0, y: 8, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.99 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="list-none flex flex-col gap-3"
                >
                  <UserMessage text={turn.userText} />
                  <AssistantTurn
                    turn={turn}
                    finalText={finalText}
                  />
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </div>
  );
}

function UserMessage({ text }: { readonly text: string }): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="flex justify-end"
    >
      <div className="max-w-[78%] rounded-[8px] px-3 py-2 text-[13px] bg-[var(--color-violet-hot)] text-[var(--color-void)] whitespace-pre-wrap break-words">
        {text}
      </div>
    </motion.div>
  );
}

function AssistantTurn({
  turn,
  finalText,
}: {
  readonly turn: TurnEntry;
  readonly finalText: string;
}): JSX.Element | null {
  const toolSteps = turn.steps.filter(
    (step): step is Extract<TurnStep, { kind: "tool-call" }> =>
      step.kind === "tool-call",
  );
  const hasContent = toolSteps.length > 0 || finalText !== "" || turn.stopped;
  if (!hasContent) return null;
  return (
    <div className="flex gap-3">
      <motion.div
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-[2px] self-stretch rounded-full bg-[var(--color-violet-hot)] origin-top"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {toolSteps.map((step) => (
          <ToolActivityRow
            key={step.callId}
            toolName={step.toolName}
            input={step.input}
            output={step.output}
            outcome={step.outcome}
          />
        ))}
        {finalText !== "" ? (
          <div className="text-[13px] leading-relaxed text-[var(--color-ink)] break-words">
            <MarkdownBody>{finalText}</MarkdownBody>
          </div>
        ) : null}
        {turn.stopped ? (
          <div className="text-[10.5px] uppercase tracking-wider text-[var(--color-sig-effect)]">
            stopped
          </div>
        ) : null}
      </div>
    </div>
  );
}


function Composer({
  draft,
  setDraft,
  sending,
  onSend,
  onStop,
  inputRef,
}: {
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly inputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}): JSX.Element {
  const disabled = !sending && draft.trim() === "";
  return (
    <div className="px-4 pt-2 pb-3 border-t border-[var(--color-rule)]">
      <motion.div
        layout
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex items-end gap-2 rounded-[8px] border border-[var(--color-rule)] bg-[color-mix(in_oklch,var(--color-void)_70%,transparent)] px-3 py-2"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder="Ask the runtime..."
          className="flex-1 resize-none bg-transparent text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-mute)] focus:outline-none"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (sending) onStop();
              else if (draft.trim() !== "") onSend();
            }
          }}
        />
        <motion.button
          type="button"
          onClick={sending ? onStop : onSend}
          disabled={disabled}
          whileHover={disabled ? undefined : { scale: 1.04 }}
          whileTap={disabled ? undefined : { scale: 0.96 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className="h-8 min-w-14 rounded-[6px] px-3 text-[12px] font-mono bg-[var(--color-violet-hot)] text-[var(--color-void)] disabled:bg-transparent disabled:text-[var(--color-ink-mute)]"
        >
          {sending ? "stop" : "send"}
        </motion.button>
      </motion.div>
    </div>
  );
}

type StarterTone = "state" | "computed" | "action";

type Starter = {
  readonly label: string;
  readonly text: string;
  readonly tone: StarterTone;
};

const STARTERS: readonly Starter[] = [
  {
    label: "what can I do?",
    text: "What actions can I take right now?",
    tone: "state",
  },
  {
    label: "explain focus",
    text: "What is currently focused, and what does it do?",
    tone: "state",
  },
  {
    label: "why blocked?",
    text: "Why isn't the focused action dispatchable?",
    tone: "computed",
  },
  {
    label: "seed mock data",
    text: "Seed 5 mock entries for the focused action.",
    tone: "action",
  },
];

const STARTER_FG: Record<StarterTone, string> = {
  state: "var(--color-sig-state)",
  computed: "var(--color-sig-computed)",
  action: "var(--color-sig-action)",
};

function EmptyState({
  onSelectStarter,
}: {
  readonly onSelectStarter: (text: string) => void;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="h-full min-h-[220px] flex items-center"
    >
      <div className="flex gap-3 max-w-[420px]">
        <motion.div
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-[2px] self-stretch rounded-full bg-[var(--color-violet-hot)] origin-top"
          style={{
            boxShadow:
              "0 0 8px color-mix(in oklch, var(--color-violet-hot) 60%, transparent)",
          }}
          aria-hidden="true"
        />
        <div className="flex flex-col gap-3 py-1 min-w-0">
          <motion.div
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: 0.15, ease: "easeOut" }}
            className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-ink-mute)]"
          >
            <motion.span
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{
                duration: 2.6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="h-1.5 w-1.5 rounded-full bg-[var(--color-violet-hot)]"
              style={{ boxShadow: "0 0 6px var(--color-violet-hot)" }}
            />
            agent · ready
          </motion.div>
          <motion.p
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: 0.22, ease: "easeOut" }}
            className="text-[13.5px] text-[var(--color-ink-dim)] leading-relaxed"
          >
            Ask the runtime what it sees,
            <br />
            or what it can do next.
          </motion.p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {STARTERS.map((starter, i) => (
              <StarterChip
                key={starter.label}
                tone={starter.tone}
                delay={0.32 + i * 0.06}
                onClick={() => onSelectStarter(starter.text)}
              >
                {starter.label}
              </StarterChip>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function StarterChip({
  tone,
  delay,
  onClick,
  children,
}: {
  readonly tone: StarterTone;
  readonly delay: number;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  const fg = STARTER_FG[tone];
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: "easeOut" }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className="rounded-[var(--radius-chip)] px-2.5 py-1 font-mono text-[11.5px] cursor-pointer transition-[background] duration-150"
      style={{
        color: fg,
        background: `color-mix(in oklch, ${fg} 10%, transparent)`,
        border: `1px solid color-mix(in oklch, ${fg} 26%, transparent)`,
      }}
    >
      {children}
    </motion.button>
  );
}

export function extractUserText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

type SyncAgentToolContextInput = {
  readonly core: StudioCore;
  readonly uiCore: StudioCore | null;
  readonly uiSnapshot: StudioUiSnapshot;
};

async function syncAgentToolContext({
  core,
  uiCore,
  uiSnapshot,
}: SyncAgentToolContextInput): Promise<void> {
  if (uiCore === null) return;
  const userModuleReady = safeHasModule(core);
  const schemaHash = readCurrentSchemaHash(core);
  if (
    uiSnapshot.agentUserModuleReady === userModuleReady &&
    uiSnapshot.agentCurrentSchemaHash === schemaHash
  ) {
    return;
  }
  try {
    await uiCore.dispatchAsync(
      uiCore.createIntent("syncAgentToolContext", userModuleReady, schemaHash),
    );
  } catch (err) {
    console.error("[AgentLens] syncAgentToolContext failed:", err);
  }
}

function safeHasModule(core: StudioCore): boolean {
  try {
    return core.getModule() !== null;
  } catch {
    return false;
  }
}

function readCurrentSchemaHash(core: StudioCore): string | null {
  try {
    const hash = core.getModule()?.schema.hash;
    return typeof hash === "string" && hash.trim() !== "" ? hash : null;
  } catch {
    return null;
  }
}

function isInitialUserTurnRequest(
  messages: readonly UIMessage[],
): boolean {
  return messages.length === 1 && messages[0]?.role === "user";
}

function readTurnStartSnapshot(
  core: StudioCore,
  studio: StudioUiSnapshot,
): TurnStartSnapshot {
  const snapshot = safeRead(() => core.getSnapshot(), null);
  const digest = digestSnapshot(snapshot);
  const head = asRecord(safeRead(() => core.getLineage().head, null));
  return {
    worldId: stringifyId(head?.worldId),
    schemaHash: readCurrentSchemaHash(core),
    focus: {
      nodeId: studio.focusedNodeId,
      kind: studio.focusedNodeKind,
    },
    viewMode: studio.viewMode,
    data: digest.data,
    computed: digest.computed,
  };
}

function readStudioMelDigest(uiCore: StudioCore | null): string | null {
  if (uiCore === null) return null;
  const module = safeRead(() => uiCore.getModule(), null);
  if (module === null) return null;
  return formatSchemaDigestMarkdown(digestSchema(module));
}

function stringifyId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

async function markAgentSchemaObserved(
  uiCore: StudioCore | null,
  output: unknown,
): Promise<void> {
  if (uiCore === null) return;
  const schemaHash = asRecord(output)?.schemaHash;
  if (typeof schemaHash !== "string" || schemaHash.trim() === "") return;
  try {
    await uiCore.dispatchAsync(
      uiCore.createIntent("markAgentSchemaObserved", schemaHash),
    );
  } catch (err) {
    console.error("[AgentLens] markAgentSchemaObserved failed:", err);
  }
}

async function markAgentFocusObserved(
  uiCore: StudioCore | null,
  output: unknown,
): Promise<void> {
  if (uiCore === null) return;
  const focus = asRecord(asRecord(output)?.focus);
  const nodeId = focus?.nodeId;
  if (typeof nodeId !== "string" || nodeId.trim() === "") return;
  try {
    await uiCore.dispatchAsync(
      uiCore.createIntent("markAgentFocusObserved", nodeId),
    );
  } catch (err) {
    console.error("[AgentLens] markAgentFocusObserved failed:", err);
  }
}

export function buildUserToolContext(
  core: StudioCore,
): LegalityContext & DispatchContext {
  type CoreExplain = (intent: unknown) => ReturnType<
    LegalityContext["explainIntent"]
  >;
  type CoreWhyNot = (intent: unknown) => ReturnType<LegalityContext["whyNot"]>;
  return {
    isActionAvailable: (name) => core.isActionAvailable(name),
    createIntent: (action, ...args) => core.createIntent(action, ...args),
    explainIntent: core.explainIntent as unknown as CoreExplain,
    whyNot: core.whyNot as unknown as CoreWhyNot,
    getSchemaHash: () => readCurrentSchemaHash(core),
    listActionNames: () => listActionNames(core),
    dispatchAsync: (intent) =>
      core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      ) as unknown as Promise<DispatchResultLike>,
  };
}

export function buildStudioToolContext(core: StudioCore): StudioDispatchContext {
  return {
    isActionAvailable: (name) => core.isActionAvailable(name),
    createIntent: (action, ...args) => core.createIntent(action, ...args),
    dispatchAsync: (intent) =>
      core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      ) as unknown as Promise<DispatchResultLike>,
    listActionNames: () => listActionNames(core),
  };
}

function buildToolAdmissionRuntime(
  core: StudioCore | null,
): ToolAdmissionRuntime | null {
  if (core === null) return null;
  type CoreExplain = NonNullable<ToolAdmissionRuntime["explainIntent"]>;
  type CoreWhyNot = NonNullable<ToolAdmissionRuntime["whyNot"]>;
  return {
    isActionAvailable: (name) => core.isActionAvailable(name),
    createIntent: (action, ...args) => core.createIntent(action, ...args),
    dispatchAsync: (intent) =>
      core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      ) as unknown as Promise<DispatchResultLike>,
    explainIntent: core.explainIntent as unknown as CoreExplain,
    whyNot: core.whyNot as unknown as CoreWhyNot,
  };
}

function buildManifestoProjectionInput(
  core: StudioCore,
  studio: StudioUiSnapshot,
): ManifestoProjectionInput {
  return {
    studio,
    module: safeRead(() => core.getModule(), null),
    snapshot: safeRead(() => core.getSnapshot(), null),
    lineage: safeRead(() => core.getLineage(), null),
    diagnostics: safeRead(() => core.getDiagnostics(), []),
    activeProjectName: studio.activeProjectName,
    isActionAvailable: (name) => core.isActionAvailable(name),
  };
}

function nullStudioContext(): StudioDispatchContext {
  return {
    isActionAvailable: () => false,
    createIntent: () => {
      throw new Error("Studio UI runtime is not ready.");
    },
    dispatchAsync: async () => ({ kind: "failed" }),
    listActionNames: () => [],
  };
}

function safeRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function listActionNames(core: StudioCore): readonly string[] {
  const actions = core.getModule()?.schema.actions;
  return actions !== undefined ? Object.keys(actions) : [];
}

function readLineageEntries(core: StudioCore): readonly FullLineageEntry[] {
  return core.getLineage().worlds.slice().reverse().map((world) => ({
    worldId: String(world.id),
    origin:
      world.origin.kind === "dispatch"
        ? {
            kind: "dispatch",
            intentType:
              typeof world.origin.intentType === "string"
                ? world.origin.intentType
                : "(unknown)",
          }
        : {
            kind: "build",
            ...(typeof world.origin.buildId === "string"
              ? { buildId: world.origin.buildId }
              : {}),
          },
    parentWorldId: world.parentId === null ? null : String(world.parentId),
    schemaHash: world.schemaHash,
    changedPaths: world.changedPaths,
    createdAt: new Date(world.recordedAt).toISOString(),
  }));
}
