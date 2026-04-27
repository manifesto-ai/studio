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
import { ToolActivityRow, isToolPart } from "./ToolActivity.js";
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
      if (
        (toolCall.toolName === "inspectSchema" ||
          toolCall.toolName === "explainLegality") &&
        result.ok
      ) {
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
          status={chat.status}
          error={chat.error}
          canClear={chat.messages.length > 0 && !sending}
          onClear={() => chat.setMessages([])}
        />
        <AnimatePresence initial={false}>
          {notice !== null ? <Notice key="notice" message={notice} /> : null}
        </AnimatePresence>
        <MessageList
          messages={chat.messages}
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
  onSelectStarter,
}: {
  readonly messages: readonly UIMessage[];
  readonly onSelectStarter: (text: string) => void;
}): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-5">
      {messages.length === 0 ? (
        <EmptyState onSelectStarter={onSelectStarter} />
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
