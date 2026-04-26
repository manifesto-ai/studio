/**
 * AgentLens - minimal live Manifesto tool loop.
 *
 * This lens is intentionally thin:
 *   1. Begin a live agent turn in studio.mel.
 *   2. Build a static identity prompt.
 *   3. Expose only currently-available runtime tools.
 *   4. Execute model-selected tools after the same guard recheck.
 *   5. Keep looping until the model calls endTurn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type UIDataTypes,
  type UIMessage,
  type UIMessagePart,
  type UITools,
} from "ai";
import { AnimatePresence, motion } from "motion/react";
import { useStudio } from "@manifesto-ai/studio-react";
import type { EditorAdapter, StudioCore } from "@manifesto-ai/studio-core";
import {
  useStudioUi,
  type StudioUiSnapshot,
} from "@/domain/StudioUiRuntime";
import {
  bindTool,
  createToolRegistry,
  type ToolRunResult,
} from "../tools/types.js";
import {
  admitToolCall,
  createAdmittedToolRegistry,
  createInspectToolAffordancesTool,
  rejectUnavailableTool,
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
  createEndTurnTool,
  type EndTurnContext,
} from "../tools/end-turn.js";
import { readStudioAgentContext } from "../session/agent-context.js";
import { buildRecentTurnsFromMessages } from "../session/recent-turns.js";
import {
  buildLiveAgentSystemPrompt,
  newAgentTurnId,
  readLiveAgentTurnMode,
  readLiveAgentTurnStatus,
  type AgentTurnProjection,
} from "../session/agent-turn-state.js";
import {
  buildToolSchemaMap,
  executeToolLocally,
} from "../adapters/ai-sdk-tools.js";
import { MarkdownBody } from "./MarkdownBody.js";
import { summarizeActionInput } from "../session/action-input-summary.js";

export function AgentLens(): JSX.Element {
  const { core, adapter } = useStudio();
  const ui = useStudioUi();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const uiSnapshotRef = useRef(ui.snapshot);
  uiSnapshotRef.current = ui.snapshot;

  const uiRef = useRef(ui);
  uiRef.current = ui;

  const optimisticTurnRunningRef = useRef(false);
  useEffect(() => {
    optimisticTurnRunningRef.current = ui.snapshot.agentTurnStatus === "running";
  }, [ui.snapshot.agentTurnStatus]);

  const readMelSource = useCallback(
    (): string => (adapter !== null ? safeGetSource(adapter) : ""),
    [adapter],
  );

  const toolImplementations = useMemo<readonly ToolImplementation[]>(() => {
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
          agentLastToolResultName: s.agentLastToolResultName,
          agentLastToolFailureKey: s.agentLastToolFailureKey,
          agentLastToolFailureReason: s.agentLastToolFailureReason,
          agentToolFailureRepeatCount: s.agentToolFailureRepeatCount,
          agentLastToolSuccessKey: s.agentLastToolSuccessKey,
          agentToolSuccessRepeatCount: s.agentToolSuccessRepeatCount,
          agentToolLoopBlocked: s.agentToolLoopBlocked,
          agentToolLoopBlockReason: s.agentToolLoopBlockReason,
          agentLastModelFinishKey: s.agentLastModelFinishKey,
          agentModelFinishRepeatCount: s.agentModelFinishRepeatCount,
          agentUserModuleReady: s.agentUserModuleReady,
          agentMelSourceNonEmpty: s.agentMelSourceNonEmpty,
          agentFocusedActionName: s.agentFocusedActionName,
          agentFocusedActionAvailable: s.agentFocusedActionAvailable,
          agentLastAdmittedToolName: s.agentLastAdmittedToolName,
        };
      },
    };
    const inspectSnapshotCtx: InspectSnapshotContext = {
      getSnapshot: () => core.getSnapshot(),
    };
    const inspectNeighborsCtx: InspectNeighborsContext = {
      getEdges: () => core.getModule()?.graph?.edges ?? [],
      hasNode: (nodeId) =>
        core.getModule()?.graph?.nodes?.some((n) => n.id === nodeId) ?? false,
    };
    const inspectAvailabilityCtx: InspectAvailabilityContext = {
      listActionNames: () => listActionNames(core),
      isActionAvailable: (name) => core.isActionAvailable(name),
      describeAction: (name) => {
        const module = core.getModule();
        const spec = module?.schema.actions?.[name] as
          | {
              readonly description?: string;
              readonly params?: readonly string[];
              readonly dispatchable?: unknown;
            }
          | undefined;
        if (spec === undefined) return null;
        const input = summarizeActionInput(spec, module?.schema);
        return {
          paramNames: spec.params ?? [],
          paramHints: input.paramHints,
          inputHint: input.inputHint,
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
      listActionNames: () => listActionNames(core),
    };
    const endTurnCtx: EndTurnContext = {
      isTurnRunning: () =>
        readLiveAgentTurnStatus(uiRef.current.core) === "running",
      concludeAgentTurn: async (summary) => {
        const currentUi = uiRef.current;
        if (currentUi.core === null) return;
        const intent = currentUi.createIntent("concludeAgentTurn", summary);
        await currentUi.dispatchAsync(intent);
      },
    };

    const tools: ToolImplementation[] = [
      {
        tool: bindTool(createInspectToolAffordancesTool(), {
          getTools: () => tools,
          getRuntime: () => buildToolAdmissionRuntime(uiRef.current.core),
          getDomainActionNames: () => listActionNames(core),
        }),
        admissionAction: "requestTool",
        admissionArgs: ["inspectToolAffordances"],
      },
      {
        tool: bindTool(createInspectFocusTool(), inspectFocusCtx),
        admissionAction: "requestTool",
        admissionArgs: ["inspectFocus"],
      },
      {
        tool: bindTool(
          createStudioDispatchTool(),
          ui.core !== null ? buildStudioToolContext(ui.core) : nullStudioContext(),
        ),
        admissionAction: "requestTool",
        admissionArgs: ["studioDispatch"],
      },
      {
        tool: bindTool(createInspectSnapshotTool(), inspectSnapshotCtx),
        admissionAction: "requestTool",
        admissionArgs: ["inspectSnapshot"],
      },
      {
        tool: bindTool(createInspectAvailabilityTool(), inspectAvailabilityCtx),
        admissionAction: "requestTool",
        admissionArgs: ["inspectAvailability"],
      },
      {
        tool: bindTool(createInspectNeighborsTool(), inspectNeighborsCtx),
        admissionAction: "requestTool",
        admissionArgs: ["inspectNeighbors"],
      },
      {
        tool: bindTool(createLegalityTool(), userCtx),
        admissionAction: "requestTool",
        admissionArgs: ["explainLegality"],
      },
      {
        tool: bindTool(createSimulateIntentTool(), simulateIntentCtx),
        admissionAction: "requestTool",
        admissionArgs: ["simulateIntent"],
      },
      {
        tool: bindTool(createDispatchTool(), userCtx),
        admissionAction: "requestTool",
        admissionArgs: ["dispatch"],
      },
      {
        tool: bindTool(createEndTurnTool(), endTurnCtx),
        admissionAction: "requestTool",
        admissionArgs: ["endTurn"],
      },
    ];
    return tools;
  }, [core, ui.core]);

  const chat = useChat({
    id: "manifesto-agent",
    transport: new DefaultChatTransport({
      api: "/api/agent/chat",
      prepareSendMessagesRequest: async ({ messages, id }) => {
        const melSource = readMelSource();
        const snap = uiSnapshotRef.current;
        await syncAgentToolContext({
          core,
          uiCore: uiRef.current.core,
          uiSnapshot: snap,
          melSource,
        });
        const turn = readAgentTurnProjection(uiRef.current.core, snap);
        const admissionRuntime = buildToolAdmissionRuntime(uiRef.current.core);
        const availableRegistry = createAdmittedToolRegistry(
          toolImplementations,
          admissionRuntime,
        );
        const agentContext = readStudioAgentContext(
          core,
          melSource,
          buildRecentTurnsFromMessages(messages as UIMessage[]),
        );
        const system = buildLiveAgentSystemPrompt({
          agentContext,
          turn,
        });
        return {
          body: {
            id,
            messages,
            system,
            tools: buildToolSchemaMap(availableRegistry),
            maxSteps: 10,
            temperature: 0.2,
          },
        };
      },
    }),
    onToolCall: async ({ toolCall }) => {
      setNotice(null);
      await syncAgentToolContext({
        core,
        uiCore: uiRef.current.core,
        uiSnapshot: uiSnapshotRef.current,
        melSource: readMelSource(),
      });
      const admissionRuntime = buildToolAdmissionRuntime(uiRef.current.core);
      const toolImplementation = toolImplementations.find(
        (entry) => entry.tool.name === toolCall.toolName,
      );
      const admissionResult =
        toolImplementation === undefined
            ? rejectUnavailableTool(
                toolImplementations,
                toolCall.toolName,
                admissionRuntime,
                { domainActionNames: listActionNames(core) },
              )
          : await admitToolCall(
              toolImplementation,
              admissionRuntime,
              toolCall.input,
            );
      const result =
        !admissionResult.ok || toolImplementation === undefined
          ? admissionResult
          : await executeToolLocally(
              createToolRegistry([toolImplementation.tool]),
              toolCall.toolName,
              toolCall.input,
            );
      await recordAgentToolResult(
        uiRef.current.core,
        toolCall.toolName,
        toolCall.input,
        result,
      );
      const blockReason = readAgentToolLoopBlockReason(uiRef.current.core);
      if (blockReason !== null) {
        optimisticTurnRunningRef.current = false;
        setNotice(blockReason);
      }
      chat.addToolResult({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result as never,
      });
    },
    sendAutomaticallyWhen: () =>
      optimisticTurnRunningRef.current &&
      readLiveAgentTurnStatus(uiRef.current.core) === "running" &&
      readLiveAgentTurnMode(uiRef.current.core) === "live",
    onFinish: ({ message }) => {
      const finish = readModelFinish(message, uiSnapshotRef.current);
      if (finish.endsTurnWithoutEndTurn) {
        optimisticTurnRunningRef.current = false;
      }
      void recordAgentModelFinish(uiRef.current.core, finish).then(() => {
        const blockReason = readAgentToolLoopBlockReason(uiRef.current.core);
        if (blockReason !== null) {
          optimisticTurnRunningRef.current = false;
          setNotice(blockReason);
          return;
        }
        setNotice(
          finish.reasoningOnly
            ? "The model returned reasoning only. Retrying inside the active turn."
            : null,
        );
      });

      const prompt = findMostRecentUserText(chat.messages);
      if (prompt !== null) {
        const answer = extractAssistantText(message);
        ui.recordAgentTurn(prompt, answer === "" ? "(tool-only turn)" : answer);
      }
    },
  });

  const sending = chat.status === "streaming" || chat.status === "submitted";

  const onSend = useCallback(() => {
    const prompt = draft.trim();
    if (prompt === "") return;
    const uiCore = ui.core;
    if (uiCore === null) {
      setNotice("Studio runtime is still starting. Try again shortly.");
      return;
    }
    if (
      uiSnapshotRef.current.agentTurnStatus === "running" ||
      readLiveAgentTurnStatus(uiCore) === "running"
    ) {
      setNotice("An agent turn is already running.");
      return;
    }
    setNotice(null);
    setDraft("");
    optimisticTurnRunningRef.current = true;
    const turnId = newAgentTurnId("live");
    void (async () => {
      let turnStarted = false;
      try {
        const result = await uiCore.dispatchAsync(
          uiCore.createIntent("beginAgentTurn", turnId, "live", prompt),
        );
        if (result.kind !== "completed") {
          optimisticTurnRunningRef.current = false;
          setDraft(prompt);
          setNotice(
            `Could not start agent turn: ${readDispatchFailureMessage(result)}`,
          );
          return;
        }
        turnStarted = true;
        await syncAgentToolContext({
          core,
          uiCore,
          uiSnapshot: uiSnapshotRef.current,
          melSource: readMelSource(),
        });
        await chat.sendMessage({ text: prompt });
      } catch (err) {
        optimisticTurnRunningRef.current = false;
        if (turnStarted) {
          await cancelAgentTurnAfterSendFailure(uiCore);
        }
        setDraft(prompt);
        setNotice(
          `Could not start agent turn: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    })();
  }, [chat, core, draft, readMelSource, ui.core]);

  const onStop = useCallback(() => {
    void chat.stop();
    if (
      uiSnapshotRef.current.agentTurnStatus === "running" &&
      uiSnapshotRef.current.agentTurnMode === "live"
    ) {
      optimisticTurnRunningRef.current = false;
      ui.cancelAgentTurn("Live agent turn stopped by user.");
    }
  }, [chat, ui]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StatusBar
        status={chat.status}
        error={chat.error}
        canClear={chat.messages.length > 0 && !sending}
        onClear={() => chat.setMessages([])}
      />
      <AnimatePresence initial={false}>
        {notice !== null ? <Notice key="notice" message={notice} /> : null}
      </AnimatePresence>
      <MessageList messages={chat.messages} />
      <Composer
        draft={draft}
        setDraft={setDraft}
        sending={sending}
        onSend={onSend}
        onStop={onStop}
      />
    </div>
  );
}

function StatusBar({
  status,
  error,
  canClear,
  onClear,
}: {
  readonly status: string;
  readonly error: Error | undefined;
  readonly canClear: boolean;
  readonly onClear: () => void;
}): JSX.Element {
  const label =
    error !== undefined
      ? `error: ${error.message}`
      : status === "streaming"
        ? "streaming"
        : status === "submitted"
          ? "thinking"
          : "ready";
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-rule)] text-[10.5px] font-mono">
      <span className="text-[var(--color-ink-dim)]">agent loop</span>
      <span className="text-[var(--color-ink-mute)]">/ {label}</span>
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
  messages,
}: {
  readonly messages: readonly UIMessage[];
}): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-5">
      {messages.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="h-full min-h-[220px] flex items-center text-[13px] text-[var(--color-ink-mute)]"
        >
          Ask the runtime what it sees or what it can do next.
        </motion.div>
      ) : (
        <ol className="flex flex-col gap-4">
          <AnimatePresence initial={false} mode="popLayout">
            {messages.map((message) => {
              const rendered =
                message.role === "user" ? (
                  <UserMessage text={extractUserText(message)} />
                ) : message.role === "assistant" ? (
                  <AssistantMessage message={message} />
                ) : null;
              return rendered === null ? null : (
                <motion.li
                  key={message.id}
                  layout="position"
                  initial={{ opacity: 0, y: 8, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.99 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="list-none"
                >
                  {rendered}
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

function AssistantMessage({
  message,
}: {
  readonly message: UIMessage;
}): JSX.Element | null {
  const renderedParts = message.parts
    .map((part, index) => {
      if (part.type === "text") {
        return (
          <div
            key={index}
            className="text-[13px] leading-relaxed text-[var(--color-ink)] break-words"
          >
            <MarkdownBody>{part.text}</MarkdownBody>
          </div>
        );
      }
      if (part.type === "reasoning") return null;
      if (isToolPart(part)) {
        return <ToolActivityRow key={index} part={part} />;
      }
      return null;
    })
    .filter((part): part is JSX.Element => part !== null);
  if (renderedParts.length === 0) return null;
  return (
    <div className="flex gap-3">
      <motion.div
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-[2px] self-stretch rounded-full bg-[var(--color-violet-hot)] origin-top"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {renderedParts}
      </div>
    </div>
  );
}

type ToolPart = Extract<
  UIMessagePart<UIDataTypes, UITools>,
  { readonly type: `tool-${string}` }
>;

function isToolPart(
  part: UIMessagePart<UIDataTypes, UITools>,
): part is ToolPart {
  return typeof part.type === "string" && part.type.startsWith("tool-");
}

function ToolActivityRow({
  part,
}: {
  readonly part: ToolPart;
}): JSX.Element | null {
  const toolName = part.type.slice("tool-".length);
  if (toolName === "endTurn") return null;
  const state = (part as { readonly state: string }).state;
  const input = (part as { readonly input?: unknown }).input;
  const output = (part as { readonly output?: unknown }).output;
  const errorText = (part as { readonly errorText?: string }).errorText;
  const failed = state === "output-error" || isToolOutputFailure(output);
  const done = state === "output-available" || state === "output-error";
  const status = !done ? "running" : failed ? "error" : "ok";
  const activity = describeToolActivity(toolName, input, output, errorText);
  return (
    <motion.details
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="pl-1 text-[11.5px] font-mono group"
    >
      <summary className="cursor-pointer list-none flex items-center gap-2 rounded-[6px] px-1.5 py-1 hover:bg-[color-mix(in_oklch,var(--color-rule)_35%,transparent)]">
        <motion.span
          animate={
            !done && !failed
              ? { opacity: [0.45, 1, 0.45], scale: [0.9, 1.35, 0.9] }
              : { opacity: 1, scale: 1 }
          }
          transition={
            !done && !failed
              ? { duration: 1.05, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.14, ease: "easeOut" }
          }
          className={
            failed
              ? "h-1.5 w-1.5 rounded-full bg-[var(--color-sig-effect)]"
              : !done
                ? "h-1.5 w-1.5 rounded-full bg-[var(--color-violet-hot)]"
                : "h-1.5 w-1.5 rounded-full bg-[var(--color-sig-computed)]"
          }
        />
        <span className="text-[var(--color-ink-dim)]">
          {activity.label}
        </span>
        {activity.target !== null ? (
          <span className="truncate text-[var(--color-ink-mute)]">
            {activity.target}
          </span>
        ) : null}
        {failed && activity.message !== null ? (
          <span className="min-w-0 truncate text-[var(--color-sig-effect)]">
            {truncate(activity.message, 96)}
          </span>
        ) : null}
        <span
          className={
            failed
              ? "ml-auto text-[var(--color-sig-effect)]"
              : "ml-auto text-[var(--color-ink-mute)]"
          }
        >
          {status}
        </span>
      </summary>
      {activity.message !== null ? (
        <div className="ml-5 mt-1 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          {activity.message}
        </div>
      ) : null}
      <pre className="mt-1.5 ml-5 px-2 py-2 border-l border-[var(--color-rule)] text-[10.5px] text-[var(--color-ink-dim)] whitespace-pre-wrap">
        {formatToolData(input, output, errorText)}
      </pre>
    </motion.details>
  );
}

type ToolActivity = {
  readonly label: string;
  readonly target: string | null;
  readonly message: string | null;
};

async function recordAgentToolResult(
  uiCore: StudioCore | null,
  toolName: string,
  input: unknown,
  result: ToolRunResult<unknown>,
): Promise<void> {
  if (uiCore === null) return;
  const failureMessage = readToolResultFailureMessage(result);
  const ok = failureMessage === null;
  const reason = ok
    ? `Stopped repeated successful tool call: ${toolName}`
    : `Stopped repeated tool failure: ${toolName} - ${failureMessage}`;
  const resultKey = truncate(
    ok
      ? `${toolName}:ok:${stringifySafe(input)}`
      : `${toolName}:error:${failureMessage}:${stringifySafe(input)}`,
    512,
  );
  try {
    await uiCore.dispatchAsync(
      uiCore.createIntent(
        "recordAgentToolResult",
        toolName,
        resultKey,
        ok,
        reason,
      ),
    );
  } catch (err) {
    console.error("[AgentLens] recordAgentToolResult failed:", err);
  }
}

type ModelFinishRecord = {
  readonly finishKey: string;
  readonly hasText: boolean;
  readonly hasToolCalls: boolean;
  readonly hasEndTurn: boolean;
  readonly reasoningOnly: boolean;
  readonly endsTurnWithoutEndTurn: boolean;
  readonly reason: string;
};

async function recordAgentModelFinish(
  uiCore: StudioCore | null,
  finish: ModelFinishRecord,
): Promise<void> {
  if (
    uiCore === null ||
    finish.hasEndTurn ||
    readLiveAgentTurnStatus(uiCore) !== "running"
  ) {
    return;
  }
  try {
    await uiCore.dispatchAsync(
      uiCore.createIntent(
        "recordAgentModelFinish",
        finish.finishKey,
        finish.hasText,
        finish.hasToolCalls,
        finish.reason,
      ),
    );
  } catch (err) {
    console.error("[AgentLens] recordAgentModelFinish failed:", err);
  }
}

function readModelFinish(
  message: UIMessage,
  snapshot: StudioUiSnapshot,
): ModelFinishRecord {
  const text = extractAssistantText(message);
  const toolNames = readToolNames(message);
  const hasText = text !== "";
  const hasToolCalls = toolNames.length > 0;
  const hasEndTurn = toolNames.includes("endTurn");
  const finishKey = hasToolCalls
    ? `tools:${toolNames.join(",")}`
    : hasText
      ? `text:${truncate(text, 160)}`
      : "reasoning-only";
  const reasoningOnly = isReasoningOnlyAssistantTurn(message);
  const repeatedReasoningOnly =
    reasoningOnly &&
    snapshot.agentLastModelFinishKey === finishKey &&
    snapshot.agentModelFinishRepeatCount >= 1;
  return {
    finishKey,
    hasText,
    hasToolCalls,
    hasEndTurn,
    reasoningOnly,
    endsTurnWithoutEndTurn:
      !hasEndTurn && ((hasText && !hasToolCalls) || repeatedReasoningOnly),
    reason:
      hasText && !hasToolCalls
        ? "Ended after assistant text without endTurn."
        : "Stopped repeated non-terminal assistant finish.",
  };
}

function readToolNames(message: UIMessage): readonly string[] {
  return message.parts
    .filter(isToolPart)
    .map((part) => part.type.slice("tool-".length));
}

function readToolResultFailureMessage(
  result: ToolRunResult<unknown>,
): string | null {
  if (!result.ok) return result.message;
  const output = asRecord(result.output);
  if (output === null) return null;
  const status = output.status;
  if (
    status === "unavailable" ||
    status === "rejected" ||
    status === "failed" ||
    status === "blocked"
  ) {
    if (typeof output.summary === "string" && output.summary.trim() !== "") {
      return output.summary;
    }
    if (typeof output.error === "string" && output.error.trim() !== "") {
      return output.error;
    }
    return `tool returned status "${status}"`;
  }
  return null;
}

function readAgentToolLoopBlockReason(core: StudioCore | null): string | null {
  if (core === null) return null;
  const snap = asRecord(core.getSnapshot());
  const data = asRecord(snap?.data);
  const reason = data?.agentToolLoopBlockReason;
  return typeof reason === "string" && reason.trim() !== "" ? reason : null;
}

function describeToolActivity(
  toolName: string,
  input: unknown,
  output: unknown,
  errorText: string | undefined,
): ToolActivity {
  const message = readToolMessage(output, errorText);
  if (isToolOutputFailure(output)) {
    return {
      label: "Tool blocked",
      target: toolName,
      message,
    };
  }
  const actionName = readActionName(input, output);
  const focusTarget = readFocusTarget(output);
  const nodeTarget = readNodeTarget(input, output);
  switch (toolName) {
    case "inspectToolAffordances":
      return {
        label: "Checked tool guards",
        target: readToolCatalogSummary(output),
        message,
      };
    case "inspectFocus":
      return {
        label: "Checked UI focus",
        target: focusTarget,
        message,
      };
    case "studioDispatch":
      return {
        label: "Updated Studio view",
        target: actionName,
        message,
      };
    case "inspectSnapshot":
      return {
        label: "Read current state",
        target: null,
        message,
      };
    case "inspectAvailability":
      return {
        label: "Checked available actions",
        target: readAvailabilitySummary(output),
        message,
      };
    case "inspectNeighbors":
      return {
        label: "Checked graph links",
        target: nodeTarget,
        message,
      };
    case "explainLegality":
      return {
        label: "Checked action guard",
        target: actionName,
        message,
      };
    case "simulateIntent":
      return {
        label: "Previewed action",
        target: actionName,
        message,
      };
    case "dispatch":
      return {
        label: "Updated runtime state",
        target: actionName,
        message,
      };
    default:
      return {
        label: `Ran ${toolName}`,
        target: formatInlineInput(input),
        message,
      };
  }
}

function readToolMessage(
  output: unknown,
  errorText: string | undefined,
): string | null {
  if (errorText !== undefined && errorText.trim() !== "") return errorText;
  const raw = asRecord(output);
  if (typeof raw?.message === "string" && raw.message.trim() !== "") {
    return raw.message;
  }
  const body = asRecord(unwrapToolOutput(output));
  if (typeof body?.summary === "string" && body.summary.trim() !== "") {
    return body.summary;
  }
  if (typeof body?.error === "string" && body.error.trim() !== "") {
    return body.error;
  }
  return null;
}

function readActionName(input: unknown, output: unknown): string | null {
  const inputAction = asRecord(input)?.action;
  if (typeof inputAction === "string" && inputAction.trim() !== "") {
    return inputAction;
  }
  const outputAction = asRecord(unwrapToolOutput(output))?.action;
  if (typeof outputAction === "string" && outputAction.trim() !== "") {
    return outputAction;
  }
  return null;
}

function readFocusTarget(output: unknown): string | null {
  const focus = asRecord(unwrapToolOutput(output))?.focusedNodeId;
  return typeof focus === "string" && focus.trim() !== "" ? focus : null;
}

function readNodeTarget(input: unknown, output: unknown): string | null {
  const inputNode = asRecord(input)?.nodeId;
  if (typeof inputNode === "string" && inputNode.trim() !== "") {
    return inputNode;
  }
  const outputNode = asRecord(unwrapToolOutput(output))?.nodeId;
  return typeof outputNode === "string" && outputNode.trim() !== ""
    ? outputNode
    : null;
}

function readAvailabilitySummary(output: unknown): string | null {
  const actions = asRecord(unwrapToolOutput(output))?.actions;
  if (!Array.isArray(actions)) return null;
  const total = actions.length;
  const available = actions.filter(
    (entry) => asRecord(entry)?.available === true,
  ).length;
  return `${available}/${total} available`;
}

function readToolCatalogSummary(output: unknown): string | null {
  const body = asRecord(unwrapToolOutput(output));
  const availableTools = body?.availableTools;
  const blocked = body?.unavailableToolCount;
  if (!Array.isArray(availableTools)) return null;
  return `${availableTools.length} available${
    typeof blocked === "number" ? `, ${blocked} blocked` : ""
  }`;
}

function unwrapToolOutput(output: unknown): unknown {
  const record = asRecord(output);
  return record !== null && "output" in record ? record.output : output;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function Composer({
  draft,
  setDraft,
  sending,
  onSend,
  onStop,
}: {
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly onStop: () => void;
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

export function extractUserText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export function extractAssistantText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

function findMostRecentUserText(messages: readonly UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    const text = extractUserText(message);
    return text === "" ? null : text;
  }
  return null;
}

function isReasoningOnlyAssistantTurn(message: UIMessage): boolean {
  return (
    extractAssistantText(message) === "" &&
    message.parts.some((part) => part.type === "reasoning") &&
    !message.parts.some(isToolPart)
  );
}

function formatInlineInput(input: unknown): string {
  if (input === null || input === undefined) return "{}";
  if (typeof input !== "object") return truncate(String(input), 48);
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return truncate(
    `{ ${entries.map(([key, value]) => `${key}: ${formatScalar(value)}`).join(", ")} }`,
    64,
  );
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") return `"${truncate(value, 18)}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{...}";
  return String(value);
}

function formatToolData(
  input: unknown,
  output: unknown,
  errorText: string | undefined,
): string {
  const chunks: string[] = [];
  if (input !== undefined) chunks.push(`input\n${stringifySafe(input)}`);
  if (errorText !== undefined && errorText !== "") {
    chunks.push(`error\n${errorText}`);
  } else if (output !== undefined) {
    chunks.push(`output\n${stringifySafe(output)}`);
  }
  return chunks.join("\n\n") || "(no data)";
}

function isToolOutputFailure(output: unknown): boolean {
  const top = asRecord(output);
  if (top?.ok === false) return true;
  const body = asRecord(unwrapToolOutput(output));
  const status = body?.status;
  return (
    status === "unavailable" ||
    status === "rejected" ||
    status === "failed" ||
    status === "blocked"
  );
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

type SyncAgentToolContextInput = {
  readonly core: StudioCore;
  readonly uiCore: StudioCore | null;
  readonly uiSnapshot: StudioUiSnapshot;
  readonly melSource: string;
};

async function syncAgentToolContext({
  core,
  uiCore,
  uiSnapshot,
  melSource,
}: SyncAgentToolContextInput): Promise<void> {
  if (uiCore === null) return;
  const focusedActionName = readFocusedActionName(uiSnapshot);
  const userModuleReady = safeHasModule(core);
  const melSourceNonEmpty = melSource.trim() !== "";
  const focusedActionAvailable =
    focusedActionName !== null && safeIsActionAvailable(core, focusedActionName);
  if (
    uiSnapshot.agentUserModuleReady === userModuleReady &&
    uiSnapshot.agentMelSourceNonEmpty === melSourceNonEmpty &&
    uiSnapshot.agentFocusedActionName === focusedActionName &&
    uiSnapshot.agentFocusedActionAvailable === focusedActionAvailable
  ) {
    return;
  }
  try {
    await uiCore.dispatchAsync(
      uiCore.createIntent(
        "syncAgentToolContext",
        userModuleReady,
        melSourceNonEmpty,
        focusedActionName,
        focusedActionAvailable,
      ),
    );
  } catch (err) {
    console.error("[AgentLens] syncAgentToolContext failed:", err);
  }
}

async function cancelAgentTurnAfterSendFailure(uiCore: StudioCore): Promise<void> {
  try {
    await uiCore.dispatchAsync(
      uiCore.createIntent(
        "cancelAgentTurn",
        "Live agent turn failed before the request was sent.",
      ),
    );
  } catch (err) {
    console.error("[AgentLens] cancelAgentTurn after send failure failed:", err);
  }
}

function readAgentTurnProjection(
  uiCore: StudioCore | null,
  fallback: StudioUiSnapshot,
): AgentTurnProjection {
  const data = readCoreSnapshotData(uiCore);
  const mode = data?.agentTurnMode;
  const status = data?.agentTurnStatus;
  return {
    id: readNullableString(data?.agentTurnId) ?? fallback.agentTurnId,
    mode: mode === "live" ? mode : fallback.agentTurnMode,
    status:
      status === "running" || status === "ended"
        ? status
        : fallback.agentTurnStatus,
    prompt: readNullableString(data?.agentTurnPrompt) ?? fallback.agentTurnPrompt,
    conclusion:
      readNullableString(data?.agentTurnConclusion) ??
      fallback.agentTurnConclusion,
    resendCount:
      typeof data?.agentTurnResendCount === "number"
        ? data.agentTurnResendCount
        : fallback.agentTurnResendCount,
  };
}

function readCoreSnapshotData(
  core: StudioCore | null,
): Record<string, unknown> | null {
  if (core === null) return null;
  try {
    return asRecord(asRecord(core.getSnapshot())?.data);
  } catch {
    return null;
  }
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readDispatchFailureMessage(result: DispatchResultLike): string {
  return (
    result.rejection?.reason ??
    result.error?.message ??
    result.kind ??
    "unknown runtime rejection"
  );
}

function readFocusedActionName(snapshot: StudioUiSnapshot): string | null {
  if (
    snapshot.focusedNodeKind !== "action" ||
    snapshot.focusedNodeId === null ||
    snapshot.focusedNodeId.trim() === ""
  ) {
    return null;
  }
  const prefix = "action:";
  return snapshot.focusedNodeId.startsWith(prefix)
    ? snapshot.focusedNodeId.slice(prefix.length)
    : snapshot.focusedNodeId;
}

function safeHasModule(core: StudioCore): boolean {
  try {
    return core.getModule() !== null;
  } catch {
    return false;
  }
}

function safeIsActionAvailable(core: StudioCore, actionName: string): boolean {
  try {
    return core.isActionAvailable(actionName);
  } catch {
    return false;
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

function listActionNames(core: StudioCore): readonly string[] {
  const actions = core.getModule()?.schema.actions;
  return actions !== undefined ? Object.keys(actions) : [];
}

export function safeGetSource(adapter: EditorAdapter): string {
  try {
    return adapter.getSource();
  } catch {
    return "";
  }
}
