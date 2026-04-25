/**
 * SagaLens — AgentLens v2 with durable, interruption-resilient turns.
 *
 * A "saga" is an agent turn whose status lives in the StudioUi
 * Manifesto runtime (see `domain/studio.mel` agentTurn*). It does
 * NOT end when the stream finishes, when the model runs out of
 * tokens, or when the model emits text without a tool call. A saga
 * ends ONLY when the model calls `answerAndTurnEnd({ answer })`.
 *
 * Consequences:
 *   - Model rambles ("I will call createProposal...") without actually
 *     calling it → saga still running → harness re-invokes → model
 *     gets another shot.
 *   - Browser refresh mid-saga → status persists in StudioUi runtime
 *     (via Manifesto lineage) → resume banner on mount.
 *   - LLM stream drops → saga still running → auto-retry.
 *
 * Safety valve: `DURABLE_TURN_RESEND_HARD_CAP` - after N resends without
 * conclude, the shell force-concludes to prevent runaway cost.
 *
 * This is a parallel v2 to AgentLens; AgentLens itself is untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "@manifesto-ai/studio-react";
import { useStudioUi } from "@/domain/StudioUiRuntime";
import {
  useChat,
  type UseChatHelpers,
} from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type UIMessage,
} from "ai";
import {
  bindTool,
  createToolRegistry,
  type ToolRegistry,
} from "../tools/types.js";
import {
  createLegalityTool,
} from "../tools/legality.js";
import {
  createDispatchTool,
} from "../tools/dispatch.js";
import {
  createStudioDispatchTool,
} from "../tools/studio-dispatch.js";
import {
  createInspectFocusTool,
  type InspectFocusContext,
  type InspectFocusOutput,
} from "../tools/inspect-focus.js";
import {
  createInspectSnapshotTool,
  type InspectSnapshotContext,
} from "../tools/inspect-snapshot.js";
import {
  createInspectNeighborsTool,
  type InspectNeighborsContext,
} from "../tools/inspect-neighbors.js";
import {
  createInspectAvailabilityTool,
  type InspectAvailabilityContext,
} from "../tools/inspect-availability.js";
import {
  createSimulateIntentTool,
  type SimulateIntentContext,
} from "../tools/simulate-intent.js";
import {
  createSourceMapTool,
  type SourceMapContext,
} from "../tools/source-map.js";
import {
  createGenerateMockTool,
  type GenerateMockContext,
} from "../tools/generate-mock.js";
import {
  createSeedMockTool,
  type SeedMockContext,
} from "../tools/seed-mock.js";
import {
  createInspectLineageTool,
  type FullLineageEntry,
  type InspectLineageContext,
  type WorldOriginLike,
} from "../tools/inspect-lineage.js";
import {
  createInspectConversationTool,
  type FullConversationTurn,
  type InspectConversationContext,
} from "../tools/inspect-conversation.js";
import {
  createCreateProposalTool,
  type CreateProposalContext,
} from "../tools/create-proposal.js";
import {
  createInspectSourceOutlineTool,
  type InspectSourceOutlineContext,
} from "../tools/inspect-source-outline.js";
import {
  createReadDeclarationTool,
  type ReadDeclarationContext,
} from "../tools/read-declaration.js";
import {
  createFindInSourceTool,
  type FindInSourceContext,
} from "../tools/find-in-source.js";
import {
  createAnswerAndTurnEndTool,
  type AnswerAndTurnEndContext,
} from "../tools/answer-and-turn-end.js";
import { readStudioAgentContext } from "../session/agent-context.js";
import { buildRecentTurnsFromMessages } from "../session/recent-turns.js";
import {
  buildDurableAgentSystemPrompt,
  DURABLE_TURN_RESEND_HARD_CAP,
  newAgentTurnId,
  readLiveAgentTurnMode,
  readLiveAgentTurnStatus,
} from "../session/agent-turn-state.js";
import {
  verifyMelProposal,
} from "../session/proposal-verifier.js";
import type { AgentProposal } from "../session/proposal-buffer.js";
import {
  buildToolSchemaMap,
  executeToolLocally,
} from "../adapters/ai-sdk-tools.js";
import { ProposalPreview } from "./ProposalPreview.js";
import {
  AgentNotice,
  Composer,
  Messages,
  StatusStrip,
  buildStudioToolContext,
  buildUserToolContext,
  demoteAnswerAndTurnEndText,
  extractAssistantText,
  findMostRecentUserText,
  messageHasToolCall,
  messagesToConversationTurns,
  readLastMessageUserText,
  safeGetSource,
} from "./AgentLens.js";

const MODEL_LABEL_FALLBACK = "server-selected model";

type AgentModelConfigResponse = {
  readonly label?: unknown;
  readonly status?: unknown;
};

export function SagaLens(): JSX.Element {
  const { core, adapter } = useStudio();
  const ui = useStudioUi();
  const [proposal, setProposal] = useState<AgentProposal | null>(null);

  const uiSnapshotRef = useRef(ui.snapshot);
  uiSnapshotRef.current = ui.snapshot;

  const readMelSource = useCallback(
    (): string => (adapter !== null ? safeGetSource(adapter) : ""),
    [adapter],
  );

  // Stable refs for saga helpers — tools capture these so the tool
  // closures don't need to re-bind every render.
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const registry = useMemo<ToolRegistry>(() => {
    const userCtx = buildUserToolContext(core);
    const inspectFocusCtx: InspectFocusContext = {
      getFocus: (): InspectFocusOutput => {
        const s = uiSnapshotRef.current;
        return {
          focusedNodeId: s.focusedNodeId,
          focusedNodeKind: s.focusedNodeKind,
          focusedNodeOrigin: s.focusedNodeOrigin,
          activeLens: s.activeLens,
          viewMode: s.viewMode,
          simulationActionName: s.simulationActionName,
          scrubEnvelopeId: s.scrubEnvelopeId,
          activeProjectName: s.activeProjectName,
          lastUserPrompt: s.lastUserPrompt,
          lastAgentAnswer: s.lastAgentAnswer,
          agentTurnCount: s.agentTurnCount,
        };
      },
    };
    const inspectSnapshotCtx: InspectSnapshotContext = {
      getSnapshot: () => core.getSnapshot(),
    };
    const inspectNeighborsCtx: InspectNeighborsContext = {
      getEdges: () => {
        const mod = core.getModule();
        return mod?.graph?.edges ?? [];
      },
      hasNode: (nodeId) => {
        const mod = core.getModule();
        const nodes = mod?.graph?.nodes;
        return nodes?.some((n) => n.id === nodeId) ?? false;
      },
    };
    const inspectAvailabilityCtx: InspectAvailabilityContext = {
      listActionNames: () => {
        const mod = core.getModule();
        const actions = mod?.schema.actions;
        return actions !== undefined ? Object.keys(actions) : [];
      },
      isActionAvailable: (name) => core.isActionAvailable(name),
      describeAction: (name) => {
        const mod = core.getModule();
        const spec = mod?.schema.actions?.[name] as
          | {
              readonly description?: string;
              readonly params?: readonly string[];
              readonly dispatchable?: unknown;
            }
          | undefined;
        if (spec === undefined) return null;
        return {
          paramNames: spec.params ?? [],
          hasDispatchableGate: spec.dispatchable !== undefined,
          description: spec.description,
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
      listActionNames: () => {
        const mod = core.getModule();
        const actions = mod?.schema.actions;
        return actions !== undefined ? Object.keys(actions) : [];
      },
    };
    const sourceMapCtx: SourceMapContext = {
      getModule: () => core.getModule(),
      getSource: readMelSource,
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
        ) as unknown as Promise<{ kind: string }>,
    };
    const inspectConversationCtx: InspectConversationContext = {
      getTurns: () => conversationTurnsRef.current,
    };
    const inspectLineageCtx: InspectLineageContext = {
      getLineage: () => {
        const lineage = core.getLineage();
        const worlds = lineage.worlds ?? [];
        return [...worlds].reverse().map<FullLineageEntry>((w) => {
          const origin = w.origin as {
            readonly kind: "build" | "dispatch";
            readonly intentType?: string;
            readonly buildId?: string;
          };
          const projected: WorldOriginLike =
            origin.kind === "dispatch"
              ? { kind: "dispatch", intentType: origin.intentType ?? "(unknown)" }
              : { kind: "build", buildId: origin.buildId };
          return {
            worldId: String(w.id ?? ""),
            parentWorldId:
              w.parentId === undefined || w.parentId === null
                ? null
                : String(w.parentId),
            schemaHash: String(w.schemaHash ?? ""),
            origin: projected,
            changedPaths: Array.isArray(w.changedPaths) ? w.changedPaths : [],
            createdAt:
              typeof w.recordedAt === "number"
                ? new Date(w.recordedAt).toISOString()
                : new Date().toISOString(),
          };
        });
      },
    };
    const createProposalCtx: CreateProposalContext = {
      getOriginalSource: readMelSource,
      verify: verifyMelProposal,
      setProposal,
    };
    const inspectSourceOutlineCtx: InspectSourceOutlineContext = {
      getModule: () => core.getModule(),
      getSource: readMelSource,
    };
    const readDeclarationCtx: ReadDeclarationContext = {
      getModule: () => core.getModule(),
      getSource: readMelSource,
    };
    const findInSourceCtx: FindInSourceContext = {
      getSource: readMelSource,
    };
    const answerAndTurnEndCtx: AnswerAndTurnEndContext = {
      isTurnRunning: () =>
        readLiveAgentTurnStatus(uiRef.current.core) === "running",
      concludeAgentTurn: async (answer) => {
        // Awaitable dispatch: await settles so the runtime's
        // snapshot is definitively "ended" by the time this returns,
        // which in turn means sendAutomaticallyWhen (reading live
        // core state) will see "ended" and not trigger another
        // resend. Fire-and-forget would race.
        const ui = uiRef.current;
        if (ui.core === null) return;
        const intent = ui.createIntent("concludeAgentTurn", answer);
        await ui.dispatchAsync(intent);
      },
    };
    const tools = [
      bindTool(createDispatchTool(), userCtx),
      bindTool(createLegalityTool(), userCtx),
      bindTool(createInspectFocusTool(), inspectFocusCtx),
      bindTool(createInspectSnapshotTool(), inspectSnapshotCtx),
      bindTool(createInspectNeighborsTool(), inspectNeighborsCtx),
      bindTool(createInspectAvailabilityTool(), inspectAvailabilityCtx),
      bindTool(createSimulateIntentTool(), simulateIntentCtx),
      bindTool(createSourceMapTool(), sourceMapCtx),
      bindTool(createInspectLineageTool(), inspectLineageCtx),
      bindTool(createInspectConversationTool(), inspectConversationCtx),
      bindTool(createGenerateMockTool(), generateMockCtx),
      bindTool(createSeedMockTool(), seedMockCtx),
      bindTool(createInspectSourceOutlineTool(), inspectSourceOutlineCtx),
      bindTool(createReadDeclarationTool(), readDeclarationCtx),
      bindTool(createFindInSourceTool(), findInSourceCtx),
      bindTool(createCreateProposalTool(), createProposalCtx),
      bindTool(createAnswerAndTurnEndTool(), answerAndTurnEndCtx),
    ];
    if (ui.core !== null) {
      tools.push(
        bindTool(createStudioDispatchTool(), buildStudioToolContext(ui.core)),
      );
    }
    return createToolRegistry(tools);
    // `ui.core` participates so studioDispatch gets re-bound if the
    // studio runtime remounts. readMelSource is stable.
  }, [core, readMelSource, ui.core]);

  const conversationTurnsRef = useRef<readonly FullConversationTurn[]>([]);
  const toolSchemas = useMemo(() => buildToolSchemaMap(registry), [registry]);
  const [agentNotice, setAgentNotice] = useState<string | null>(null);
  // Count of consecutive invocations that ended with zero tool calls.
  // Providers like Ollama honor `toolChoice: "required"` loosely for
  // smaller models (gemma4 happily emits text-only turns). When we
  // detect a zero-tool streak we escalate the NEXT invocation's
  // toolChoice from `"required"` to a specific tool name — providers
  // implement that stricter form as a literal response schema and
  // comply far more reliably.
  const zeroToolStreakRef = useRef(0);

  const chat: UseChatHelpers<UIMessage> = useChat({
    id: "manifesto-saga",
    transport: new DefaultChatTransport({
      api: "/api/agent/chat",
      prepareSendMessagesRequest: ({ messages, id }) => {
        const melSource = readMelSource();
        const agentCtx = readStudioAgentContext(
          core,
          melSource,
          buildRecentTurnsFromMessages(messages as UIMessage[]),
        );
        const snap = uiSnapshotRef.current;
        const system = buildDurableAgentSystemPrompt({
          agentContext: agentCtx,
          turn: {
            id: snap.agentTurnId,
            mode: snap.agentTurnMode,
            status: snap.agentTurnStatus,
            prompt: snap.agentTurnPrompt,
            conclusion: snap.agentTurnConclusion,
            resendCount: snap.agentTurnResendCount,
          },
        });
        // If the previous invocation emitted zero tool calls, the
        // model is in prose-only mode despite `toolChoice:"required"`
        // (Ollama/gemma4 honors this loosely). Escalate to a specific
        // tool — `answerAndTurnEnd` is the safest escape: it forces
        // termination with whatever partial answer the model has,
        // rather than another lap of drafting without committing.
        const stuck = zeroToolStreakRef.current >= 1;
        return {
          body: {
            id,
            messages,
            system,
            tools: toolSchemas,
            toolChoice: stuck
              ? { type: "tool", toolName: "answerAndTurnEnd" }
              : "required",
            maxSteps: 12,
            temperature: 0.2,
          },
        };
      },
    }),
    onToolCall: async ({ toolCall }) => {
      setAgentNotice(null);
      const result = await executeToolLocally(
        registry,
        toolCall.toolName,
        toolCall.input,
      );
      chat.addToolResult({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result as never,
      });
      // answerAndTurnEnd's user-visible rendering is handled by
      // `demoteAnswerAndTurnEndText` — it converts the tool part
      // (which already carries `input.answer` as a progressively-
      // streaming string) into a text part in-place, so the answer
      // flows into the transcript character-by-character, no
      // synthetic after-the-fact injection needed.
    },
    // Saga loop: auto-continue while the saga status is "running".
    // This is the core of the v2 behavior — we don't care whether
    // the last assistant message had a tool call or was text-only,
    // we only care whether the model has dispatched concludeAgentTurn
    // through answerAndTurnEnd.
    //
    // We read the Manifesto core snapshot directly (not the React-
    // tracked ref) because AI SDK evaluates this check synchronously
    // right after onToolCall resolves, before React has flushed the
    // re-render that would update uiSnapshotRef. Reading core is
    // always current regardless of React batching.
    sendAutomaticallyWhen: () =>
      readLiveAgentTurnStatus(uiRef.current.core) === "running" &&
      readLiveAgentTurnMode(uiRef.current.core) === "durable",
    onFinish: ({ message }) => {
      // Track zero-tool-call streak: if the just-finished assistant
      // message has any tool part, the model complied with the
      // `toolChoice:"required"` contract; reset. Otherwise increment
      // so the next prepareSendMessagesRequest can escalate.
      const hadToolCall = messageHasToolCall(message);
      zeroToolStreakRef.current = hadToolCall
        ? 0
        : zeroToolStreakRef.current + 1;

      // Each completed LLM invocation within the saga increments
      // the resend counter. When we cross the hard cap, force-end
      // the saga to bound cost.
      const snap = uiSnapshotRef.current;
      if (
        snap.agentTurnStatus === "running" &&
        snap.agentTurnMode === "durable"
      ) {
        uiRef.current.incrementAgentTurnResend();
        if (snap.agentTurnResendCount + 1 >= DURABLE_TURN_RESEND_HARD_CAP) {
          uiRef.current.cancelAgentTurn(
            `Saga force-ended at resend cap (${DURABLE_TURN_RESEND_HARD_CAP}). The agent never called answerAndTurnEnd.`,
          );
          setAgentNotice(
            `The agent did not call answerAndTurnEnd within ${DURABLE_TURN_RESEND_HARD_CAP} turns; saga force-ended.`,
          );
        }
      }

      const prompt = findMostRecentUserText(chat.messages);
      const answer = extractAssistantText(message);
      if (prompt !== null) {
        ui.recordAgentTurn(prompt, answer === "" ? "(tool-only turn)" : answer);
      }
    },
  });

  useEffect(() => {
    conversationTurnsRef.current = messagesToConversationTurns(chat.messages);
  }, [chat.messages]);

  const [draft, setDraft] = useState("");
  const [serverModelLabel, setServerModelLabel] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/agent/config", {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AgentModelConfigResponse;
      })
      .then((config) => {
        if (config === null) return;
        if (typeof config.label !== "string" || config.label.trim() === "") {
          return;
        }
        const suffix =
          config.status === "misconfigured" ? " (misconfigured)" : "";
        setServerModelLabel(`${config.label.trim()}${suffix}`);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });

    return () => controller.abort();
  }, []);

  const onSend = useCallback(() => {
    const prompt = draft.trim();
    if (prompt === "") return;
    if (ui.core === null) {
      setAgentNotice("Studio runtime is still starting. Try again shortly.");
      return;
    }
    if (uiSnapshotRef.current.agentTurnStatus === "running") {
      setAgentNotice(
        "A saga is already running. Wait for it to conclude before starting another.",
      );
      return;
    }
    setAgentNotice(null);
    setDraft("");
    // Begin the saga BEFORE dispatching to the LLM so the
    // sendAutomaticallyWhen check sees status:"running" as soon as
    // the first invocation finishes.
    const sagaId = newAgentTurnId("durable");
    ui.beginAgentTurn(sagaId, "durable", prompt);
    // Fresh prompt gets a fresh structural-escalation budget.
    zeroToolStreakRef.current = 0;
    void chat.sendMessage({ text: prompt });
  }, [chat, draft, ui]);

  const onStop = useCallback(() => {
    void chat.stop();
  }, [chat]);

  const onForceEnd = useCallback(() => {
    if (uiSnapshotRef.current.agentTurnStatus !== "running") return;
    ui.cancelAgentTurn("Saga ended manually by user.");
    setAgentNotice("Saga ended manually.");
  }, [ui]);

  const onClear = useCallback(() => {
    chat.setMessages([]);
  }, [chat]);

  const onAcceptProposal = useCallback(() => {
    if (proposal === null || proposal.status !== "verified") return;
    if (adapter === null) return;
    adapter.setSource(proposal.proposedSource);
    adapter.requestBuild();
    setProposal(null);
  }, [adapter, proposal]);

  const onRejectProposal = useCallback(() => {
    setProposal(null);
  }, []);

  // Resume banner. If a saga was running when the browser refreshed,
  // StudioUi restores status from lineage and we surface a prompt to
  // resume or force-end. Note: auto-resume is intentionally NOT
  // wired — the user should explicitly decide whether to continue
  // an orphaned saga so runaway spend is impossible.
  const sagaIsRunning =
    ui.snapshot.agentTurnStatus === "running" &&
    ui.snapshot.agentTurnMode === "durable";
  const messagesEmpty = chat.messages.length === 0;
  const orphanedSaga = sagaIsRunning && messagesEmpty;

  const sending = chat.status === "streaming" || chat.status === "submitted";
  const configuredModelLabel = (
    import.meta.env?.VITE_AGENT_MODEL as string | undefined
  )?.trim();
  const modelLabel =
    serverModelLabel ??
    (configuredModelLabel !== undefined && configuredModelLabel !== ""
      ? configuredModelLabel
      : MODEL_LABEL_FALLBACK);
  const sagaLabel = sagaIsRunning
    ? ` · saga running (${ui.snapshot.agentTurnResendCount}/${DURABLE_TURN_RESEND_HARD_CAP})`
    : "";

  const examplePrompts = useMemo<readonly string[]>(
    () => [
      "Add a priority field to the task state.",
      "Refactor toggleDone to use an inline patch expression.",
      "Describe the current domain in three bullets, then conclude.",
      "Seed 5 rows for the main action and summarize.",
    ],
    [],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StatusStrip
        modelLabel={`${modelLabel}${sagaLabel}`}
        status={chat.status}
        error={chat.error}
        onClear={onClear}
        canClear={chat.messages.length > 0 && !sending}
      />
      {agentNotice !== null ? <AgentNotice message={agentNotice} /> : null}
      {orphanedSaga ? (
        <OrphanedSagaBanner
          prompt={ui.snapshot.agentTurnPrompt}
          onForceEnd={onForceEnd}
        />
      ) : null}
      {proposal !== null ? (
        <ProposalPreview
          proposal={proposal}
          onAccept={onAcceptProposal}
          onReject={onRejectProposal}
        />
      ) : null}
      <Messages messages={demoteAnswerAndTurnEndText(chat.messages)} />
      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        onStop={onStop}
        sending={sending}
        examples={chat.messages.length === 0 ? examplePrompts : undefined}
        onPickExample={(text) => setDraft(text)}
      />
      {sagaIsRunning && !sending ? (
        <ForceEndStrip onForceEnd={onForceEnd} />
      ) : null}
    </div>
  );
}

function OrphanedSagaBanner({
  prompt,
  onForceEnd,
}: {
  readonly prompt: string | null;
  readonly onForceEnd: () => void;
}): JSX.Element {
  return (
    <div
      className="px-3 py-2 text-[11px] font-mono border-b"
      style={{
        borderColor: "var(--color-ink-muted)",
        background: "var(--color-surface-tint)",
        color: "var(--color-ink)",
      }}
    >
      <div className="font-bold">Orphaned saga detected.</div>
      <div className="mt-1 opacity-80">
        A saga was still running when this session started. Original prompt:{" "}
        <span className="font-semibold">
          {prompt !== null && prompt !== "" ? prompt : "(unknown)"}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onForceEnd}
          className="px-2 py-1 border text-[11px] hover:bg-[var(--color-surface)]"
          style={{ borderColor: "var(--color-ink-muted)" }}
        >
          Force-end saga
        </button>
      </div>
    </div>
  );
}

function ForceEndStrip({
  onForceEnd,
}: {
  readonly onForceEnd: () => void;
}): JSX.Element {
  return (
    <div
      className="px-3 py-1 text-[10px] font-mono border-t flex items-center justify-between"
      style={{
        borderColor: "var(--color-ink-muted)",
        color: "var(--color-ink-muted)",
      }}
    >
      <span>
        Saga in flight. Harness will keep resuming until answerAndTurnEnd.
      </span>
      <button
        type="button"
        onClick={onForceEnd}
        className="px-2 py-0.5 border text-[10px] hover:bg-[var(--color-surface)]"
        style={{ borderColor: "var(--color-ink-muted)" }}
      >
        Force-end
      </button>
    </div>
  );
}
