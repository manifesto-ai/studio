/**
 * AgentLens - live Manifesto agent surface.
 *
 * This lens is intentionally thin:
 *   1. Build a static identity prompt.
 *   2. Expose only currently-admitted runtime tools.
 *   3. Execute model-selected tools after the same guard recheck.
 *   4. Let the AI SDK handle tool-result continuation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIDataTypes,
  type UIMessage,
  type UIMessagePart,
  type UITools,
} from "ai";
import { AnimatePresence, motion } from "motion/react";
import { useStudio } from "@manifesto-ai/studio-react";
import type { StudioCore } from "@manifesto-ai/studio-core";
import {
  useStudioUi,
  type StudioUiSnapshot,
} from "@/domain/StudioUiRuntime";
import {
  bindTool,
  createToolRegistry,
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
import {
  buildToolSchemaMap,
  executeToolLocally,
} from "../adapters/ai-sdk-tools.js";
import { MarkdownBody } from "./MarkdownBody.js";
import {
  projectAction,
  projectEntity,
  projectFocus,
  type ManifestoProjectionInput,
} from "@/projections/manifesto-projections";

export function AgentLens(): JSX.Element {
  const { core } = useStudio();
  const ui = useStudioUi();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const uiSnapshotRef = useRef(ui.snapshot);
  uiSnapshotRef.current = ui.snapshot;

  const uiRef = useRef(ui);
  uiRef.current = ui;

  const messagesRef = useRef<readonly UIMessage[]>([]);

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
      getMessages: () => messagesRef.current,
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

  const chat = useChat({
    id: "manifesto-agent",
    transport: new DefaultChatTransport({
      api: "/api/agent/chat",
      prepareSendMessagesRequest: async ({ messages, id }) => {
        const fullMessages = messages as UIMessage[];
        messagesRef.current = fullMessages;
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
        const agentContext = readStudioAgentContext({
          studioMelDigest: readStudioMelDigest(uiRef.current.core),
          recentTurns: buildRecentTurnsFromMessages(fullMessages),
          runtimeSignals: {
            selectedNodeChanged: !snap.agentFocusFresh,
            currentFocusedNodeId: snap.focusedNodeId,
            currentFocusedNodeKind: snap.focusedNodeKind,
          },
          turnStartSnapshot: isInitialUserTurnRequest(transportMessages)
            ? readTurnStartSnapshot(core, snap)
            : null,
        });
        const system = buildAgentSystemPrompt(agentContext);
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
    }),
    onToolCall: async ({ toolCall }) => {
      setNotice(null);
      await syncAgentToolContext({
        core,
        uiCore: uiRef.current.core,
        uiSnapshot: uiSnapshotRef.current,
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
      if (toolCall.toolName === "inspectSchema" && result.ok) {
        await markAgentSchemaObserved(uiRef.current.core, result.output);
      }
      if (toolCall.toolName === "inspectFocus" && result.ok) {
        await markAgentFocusObserved(uiRef.current.core, result.output);
      }
      chat.addToolResult({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result as never,
      });
    },
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithToolCalls({ messages }),
  });
  messagesRef.current = chat.messages;

  const sending = chat.status === "streaming" || chat.status === "submitted";

  const onSend = useCallback(() => {
    const prompt = draft.trim();
    if (prompt === "") return;
    if (ui.core === null) {
      setNotice("Studio runtime is still starting. Try again shortly.");
      return;
    }
    setNotice(null);
    setDraft("");
    void (async () => {
      try {
        await syncAgentToolContext({
          core,
          uiCore: ui.core,
          uiSnapshot: uiSnapshotRef.current,
        });
        await chat.sendMessage({ text: prompt });
      } catch (err) {
        setDraft(prompt);
        setNotice(
          `Could not send message: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    })();
  }, [chat, core, draft, ui.core]);

  const onStop = useCallback(() => {
    void chat.stop();
  }, [chat]);

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
      <span className="text-[var(--color-ink-dim)]">agent</span>
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
    case "inspectSchema":
      return {
        label: "Read schema",
        target: readSchemaSummary(output),
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
    case "inspectLineage":
      return {
        label: "Checked world lineage",
        target: readLineageSummary(output),
        message,
      };
    case "inspectConversation":
      return {
        label: "Checked conversation",
        target: readConversationSummary(output),
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
    case "generateMock":
      return {
        label: "Generated mock args",
        target: actionName,
        message,
      };
    case "seedMock":
      return {
        label: "Seeded mock data",
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
  const body = asRecord(unwrapToolOutput(output));
  const label = asRecord(body?.entity)?.label;
  if (typeof label === "string" && label.trim() !== "") return label;
  const nodeId = asRecord(body?.focus)?.nodeId;
  return typeof nodeId === "string" && nodeId.trim() !== "" ? nodeId : null;
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

function readSchemaSummary(output: unknown): string | null {
  const body = asRecord(unwrapToolOutput(output));
  const schemaHash = body?.schemaHash;
  const actions = body?.actions;
  const actionCount = Array.isArray(actions) ? actions.length : null;
  if (typeof schemaHash !== "string") return null;
  return `${schemaHash.slice(0, 8)}${actionCount === null ? "" : ` · ${actionCount} actions`}`;
}

function readLineageSummary(output: unknown): string | null {
  const body = asRecord(unwrapToolOutput(output));
  const entries = body?.entries;
  const totalWorlds = body?.totalWorlds;
  if (!Array.isArray(entries)) return null;
  return `${entries.length}/${typeof totalWorlds === "number" ? totalWorlds : "?"} worlds`;
}

function readConversationSummary(output: unknown): string | null {
  const body = asRecord(unwrapToolOutput(output));
  const turns = body?.turns;
  const totalTurns = body?.totalTurns;
  if (!Array.isArray(turns)) return null;
  return `${turns.length}/${typeof totalTurns === "number" ? totalTurns : "?"} turns`;
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
