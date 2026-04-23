/**
 * AgentLens — post-Vercel-AI-SDK-migration.
 *
 * Transport: browser ⇄ `/api/agent/chat` ⇄ Vercel AI Gateway. The
 * server handler streams `toUIMessageStreamResponse()` back; `useChat`
 * consumes it and manages the message list.
 *
 * Tool execution: client-side. `onToolCall` dispatches the model's
 * tool calls against our local `ToolRegistry` (which wraps the live
 * Manifesto runtime) and resolves with the result. AI SDK then
 * auto-resubmits via `sendAutomaticallyWhen` so the model can
 * observe the tool result and continue reasoning.
 *
 * Message shape: each `UIMessage.parts[]` entry is either:
 *   - `{type: "text", text}` — assistant/user prose
 *   - `{type: "tool-<name>", state, input, output?}` — tool invocation
 *   - `{type: "reasoning", text}` — thinking tokens (for capable models)
 *
 * The UI walks these parts in order so a single assistant turn can
 * interleave "think → call → explain → call → conclude" naturally.
 *
 * Styling stays true to the earlier Manifesto-flavored pass:
 *   - Hairline status strip (model name, clear button).
 *   - User bubbles right-aligned in violet-hot.
 *   - Assistant blocks prefixed by a 2px violet accent bar.
 *   - Tool rows as `▸ toolName { args } → ok/error`, channel-colored.
 *   - Reasoning as muted italic monospace, collapsible.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "@manifesto-ai/studio-react";
import type { EditorAdapter, StudioCore } from "@manifesto-ai/studio-core";
import { useStudioUi } from "@/domain/StudioUiRuntime";
import {
  useChat,
  type UseChatHelpers,
} from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
  type UIMessagePart,
  type UIDataTypes,
  type UITools,
} from "ai";
import {
  bindTool,
  createToolRegistry,
  type ToolRegistry,
} from "../tools/types.js";
import {
  createLegalityTool,
  type LegalityContext,
} from "../tools/legality.js";
import {
  createDispatchTool,
  type DispatchContext,
  type DispatchResultLike,
} from "../tools/dispatch.js";
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
  buildAgentSystemPrompt,
  readStudioAgentContext,
  type RecentTurn,
} from "../session/agent-context.js";
import {
  buildToolSchemaMap,
  executeToolLocally,
} from "../adapters/ai-sdk-tools.js";
import { MarkdownBody } from "./MarkdownBody.js";

const MODEL_LABEL_FALLBACK = "google/gemma-4-26b-a4b-it";
const RECENT_TURN_LIMIT = 5;
const RECENT_TURN_EXCERPT_CAP = 280;

export function AgentLens(): JSX.Element {
  const { core, adapter } = useStudio();
  const ui = useStudioUi();

  // Tool contexts — same pattern as before. Each tool sees only the
  // narrow slice it declares. Refs let closures read live values
  // without busting the useMemo cache every render.
  const uiSnapshotRef = useRef(ui.snapshot);
  uiSnapshotRef.current = ui.snapshot;

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
    // inspectConversation reads the live useChat messages — see
    // conversationTurnsRef below. Context is captured at tool-run
    // time, not tool-bind time.
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
    const tools = [
      bindTool(createDispatchTool(), userCtx),
      bindTool(createLegalityTool(), userCtx),
      bindTool(createInspectFocusTool(), inspectFocusCtx),
      bindTool(createInspectSnapshotTool(), inspectSnapshotCtx),
      bindTool(createInspectNeighborsTool(), inspectNeighborsCtx),
      bindTool(createInspectAvailabilityTool(), inspectAvailabilityCtx),
      bindTool(createInspectLineageTool(), inspectLineageCtx),
      bindTool(createInspectConversationTool(), inspectConversationCtx),
      bindTool(createGenerateMockTool(), generateMockCtx),
      bindTool(createSeedMockTool(), seedMockCtx),
    ];
    if (ui.core !== null) {
      tools.push(
        bindTool(createStudioDispatchTool(), buildStudioToolContext(ui.core)),
      );
    }
    return createToolRegistry(tools);
  }, [core, ui.core]);

  // Reading MEL source can't go through useMemo — adapter.getSource()
  // reads live editor content, which isn't a value React tracks. We
  // call it at send time (see prepareSendMessagesRequest below).
  const readMelSource = useCallback(
    (): string => (adapter !== null ? safeGetSource(adapter) : ""),
    [adapter],
  );

  // useChat transport + handlers. prepareSendMessagesRequest injects
  // the system prompt + tool schemas fresh per turn so the server
  // sees the current MEL + tool set without the client having to
  // re-create the Chat instance.
  const conversationTurnsRef = useRef<readonly FullConversationTurn[]>([]);
  const toolSchemas = useMemo(() => buildToolSchemaMap(registry), [registry]);

  const chat: UseChatHelpers<UIMessage> = useChat({
    id: "manifesto-agent",
    transport: new DefaultChatTransport({
      api: "/api/agent/chat",
      // Stream the body per request. Prepare function reads the
      // latest studio state every time so focus / source / recent
      // turns reflect what's on screen at send-time, not at mount.
      prepareSendMessagesRequest: ({ messages, id }) => {
        const ctx = readStudioAgentContext(
          core,
          readMelSource(),
          buildRecentTurnsFromMessages(messages as UIMessage[]),
        );
        const system = buildAgentSystemPrompt(ctx);
        return {
          body: {
            id,
            messages,
            system,
            tools: toolSchemas,
            // Server caps the loop; 10 steps is plenty for
            // inspect → explain → dispatch chains.
            maxSteps: 10,
            temperature: 0.2,
          },
        };
      },
    }),
    // Client-side tool execution — dispatches against our local
    // Manifesto runtime and resolves with a JSON result.
    onToolCall: async ({ toolCall }) => {
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
    },
    // Auto-continue after a tool call lands a result — that's the
    // multi-step agent loop. Without this, each tool would require
    // a manual re-send from the client.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish: ({ message }) => {
      // Commit this turn into studio.mel so it joins the runtime's
      // lineage (see studio.mel recordAgentTurn). We only do this on
      // assistant turns that finished naturally; aborts / errors are
      // out of scope.
      const prompt = findMostRecentUserText(chat.messages);
      const answer = extractAssistantText(message);
      if (prompt !== null) {
        ui.recordAgentTurn(prompt, answer === "" ? "(tool-only turn)" : answer);
      }
    },
  });

  // Keep conversation-turns ref in sync for inspectConversation tool.
  useEffect(() => {
    conversationTurnsRef.current = messagesToConversationTurns(chat.messages);
  }, [chat.messages]);

  const [draft, setDraft] = useState("");

  const onSend = useCallback(() => {
    const prompt = draft.trim();
    if (prompt === "") return;
    setDraft("");
    void chat.sendMessage({ text: prompt });
  }, [chat, draft]);

  const onStop = useCallback(() => {
    void chat.stop();
  }, [chat]);

  const onClear = useCallback(() => {
    chat.setMessages([]);
  }, [chat]);

  const sending = chat.status === "streaming" || chat.status === "submitted";
  const modelLabel =
    (import.meta.env?.VITE_AGENT_MODEL as string | undefined)?.trim() ??
    MODEL_LABEL_FALLBACK;

  const examplePrompts = useMemo<readonly string[]>(
    () => [
      "What guards this action?",
      "Describe the current snapshot.",
      "List actions I can dispatch.",
      "Seed 5 rows for this action.",
    ],
    [],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StatusStrip
        modelLabel={modelLabel}
        status={chat.status}
        error={chat.error}
        onClear={onClear}
        canClear={chat.messages.length > 0 && !sending}
      />
      <Messages messages={chat.messages} />
      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        onStop={onStop}
        sending={sending}
        examples={chat.messages.length === 0 ? examplePrompts : undefined}
        onPickExample={(text) => setDraft(text)}
      />
    </div>
  );
}

// --------------------------------------------------------------------
// Status strip
// --------------------------------------------------------------------

function StatusStrip({
  modelLabel,
  status,
  error,
  onClear,
  canClear,
}: {
  readonly modelLabel: string;
  readonly status: UseChatHelpers<UIMessage>["status"];
  readonly error: Error | undefined;
  readonly onClear: () => void;
  readonly canClear: boolean;
}): JSX.Element {
  const tone: "ok" | "warn" | "info" =
    error !== undefined
      ? "warn"
      : status === "streaming" || status === "submitted"
        ? "info"
        : "ok";
  const dotColor =
    tone === "ok"
      ? "var(--color-sig-state)"
      : tone === "warn"
        ? "var(--color-sig-effect)"
        : "var(--color-violet-hot)";
  const label =
    error !== undefined
      ? "error"
      : status === "streaming"
        ? "streaming…"
        : status === "submitted"
          ? "thinking…"
          : "ready";
  return (
    <div
      className="
        flex items-center gap-2
        px-3 py-1.5
        border-b border-[var(--color-rule)]
        text-[10.5px] font-mono
      "
      aria-label="Agent connection status"
    >
      <span
        aria-hidden
        className="h-[6px] w-[6px] rounded-full shrink-0"
        style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
      />
      <span className="text-[var(--color-ink-dim)] truncate">{modelLabel}</span>
      <span className="text-[var(--color-ink-mute)] truncate">· {label}</span>
      {error !== undefined ? (
        <span
          className="text-[var(--color-sig-effect)] truncate"
          title={error.message}
        >
          · {error.message}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        className="
          ml-auto shrink-0 text-[var(--color-ink-mute)]
          hover:text-[var(--color-ink-dim)]
          disabled:opacity-30 disabled:hover:text-[var(--color-ink-mute)]
          disabled:cursor-not-allowed
        "
        title="Clear conversation"
      >
        clear
      </button>
    </div>
  );
}

// --------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------

function Messages({
  messages,
}: {
  readonly messages: readonly UIMessage[];
}): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);
  const onScroll = useCallback((): void => {
    const el = scrollerRef.current;
    if (el === null) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = dist < 40;
  }, []);

  // Re-scroll on any content change (new messages or streaming
  // parts). Joining part ids + lengths gives a cheap signature.
  const signature = messages
    .map((m) =>
      m.parts
        .map((p) => {
          if ("text" in p && typeof p.text === "string") {
            return `${m.id}:${p.type}:${p.text.length}`;
          }
          if (isToolPart(p)) return `${m.id}:${p.type}:${p.state}`;
          return `${m.id}:${p.type}`;
        })
        .join("|"),
    )
    .join("||");

  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    if (!stickyRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [signature]);

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="flex-1 min-h-0 overflow-y-auto px-4 py-5"
    >
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <ol className="flex flex-col gap-5">
          {messages.map((m) => (
            <li key={m.id} className="list-none">
              {m.role === "user" ? (
                <UserBubble text={extractUserText(m)} />
              ) : m.role === "assistant" ? (
                <AssistantBlock message={m} />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-start justify-center h-full min-h-[240px] gap-2 select-none">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-px w-5 bg-[var(--color-violet-hot)]" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-ink-mute)]">
          manifesto · agent
        </span>
      </div>
      <div className="text-[14px] font-sans leading-snug text-[var(--color-ink)] max-w-[420px]">
        Ask the runtime about itself — why an action is blocked, what the
        snapshot looks like, what to dispatch next.
      </div>
    </div>
  );
}

function UserBubble({ text }: { readonly text: string }): JSX.Element {
  return (
    <div className="flex justify-end">
      <div
        className="
          max-w-[78%] rounded-[10px]
          px-3 py-[7px] text-[13px] font-sans leading-relaxed
          bg-[color-mix(in_oklch,var(--color-violet-hot)_92%,transparent)]
          text-[var(--color-void)]
          break-words
        "
      >
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    </div>
  );
}

function AssistantBlock({
  message,
}: {
  readonly message: UIMessage;
}): JSX.Element {
  return (
    <div className="flex gap-3">
      <div
        aria-hidden
        className="
          w-[2px] self-stretch rounded-full
          bg-[color-mix(in_oklch,var(--color-violet-hot)_75%,transparent)]
        "
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {message.parts.map((part, idx) => {
          if (part.type === "text") {
            return (
              <div
                key={idx}
                className="text-[13px] font-sans leading-relaxed text-[var(--color-ink)] break-words"
              >
                <MarkdownBody>{part.text}</MarkdownBody>
              </div>
            );
          }
          if (part.type === "reasoning") {
            return <ReasoningPane key={idx} text={part.text} />;
          }
          if (isToolPart(part)) {
            return <ToolRow key={idx} part={part} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ReasoningPane({ text }: { readonly text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="-ml-[2px]"
    >
      <summary
        className="
          cursor-pointer list-none
          text-[10.5px] font-mono uppercase tracking-wider
          text-[var(--color-ink-mute)]
          hover:text-[var(--color-ink-dim)]
          select-none
        "
      >
        reasoning · {text.length}c {open ? "▾" : "▸"}
      </summary>
      <pre className="mt-1.5 text-[11px] font-mono whitespace-pre-wrap text-[var(--color-ink-dim)] leading-relaxed italic">
        {text}
      </pre>
    </details>
  );
}

type ToolPart = Extract<
  UIMessagePart<UIDataTypes, UITools>,
  { readonly type: `tool-${string}` }
>;

function isToolPart(
  p: UIMessagePart<UIDataTypes, UITools>,
): p is ToolPart {
  return typeof p.type === "string" && p.type.startsWith("tool-");
}

function ToolRow({ part }: { readonly part: ToolPart }): JSX.Element {
  const [open, setOpen] = useState(false);
  const toolName = part.type.slice("tool-".length);
  const state = (part as { state: string }).state;
  const isDone =
    state === "output-available" || state === "output-error";
  const ok = state === "output-available";
  const channel = resolveToolChannel(toolName);
  const input = (part as { input?: unknown }).input;
  const output = (part as { output?: unknown }).output;
  const errorText = (part as { errorText?: string }).errorText;
  const statusLabel = !isDone
    ? state === "input-streaming"
      ? "…"
      : "running"
    : ok
      ? "ok"
      : "error";
  const statusColor = !isDone
    ? "text-[var(--color-ink-mute)]"
    : ok
      ? "text-[var(--color-ink-dim)]"
      : "text-[var(--color-sig-effect)]";
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="pl-5 -ml-5"
    >
      <summary
        className="
          cursor-pointer list-none
          flex items-baseline gap-2
          text-[11.5px] font-mono leading-relaxed
          select-none
        "
      >
        <span className="text-[var(--color-ink-mute)] shrink-0">
          {open ? "▾" : "▸"}
        </span>
        <span style={{ color: channel }}>{toolName}</span>
        <span className="text-[var(--color-ink-mute)] truncate">
          {formatInputInline(input)}
        </span>
        <span className="text-[var(--color-ink-mute)] shrink-0">→</span>
        <span className={`${statusColor} shrink-0`}>{statusLabel}</span>
      </summary>
      <pre
        className="
          mt-1.5 ml-5 px-2.5 py-2
          text-[10.5px] font-mono whitespace-pre-wrap
          text-[var(--color-ink-dim)] leading-relaxed
          border-l border-[var(--color-rule)]
        "
      >
        {formatToolDisplay(input, output, errorText)}
      </pre>
    </details>
  );
}

// --------------------------------------------------------------------
// Composer
// --------------------------------------------------------------------

function Composer({
  draft,
  setDraft,
  onSend,
  onStop,
  sending,
  examples,
  onPickExample,
}: {
  readonly draft: string;
  readonly setDraft: (s: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly sending: boolean;
  readonly examples?: readonly string[];
  readonly onPickExample: (text: string) => void;
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "0px";
    const max = 8 * 18 + 16;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [draft]);

  return (
    <div className="flex flex-col gap-2 px-4 pt-2 pb-3 border-t border-[var(--color-rule)]">
      {examples !== undefined && examples.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onPickExample(ex)}
              className="
                px-2.5 py-[5px] rounded-full
                text-[11px] font-sans
                border border-[var(--color-rule)]
                bg-transparent
                text-[var(--color-ink-mute)]
                hover:text-[var(--color-ink)]
                hover:border-[color-mix(in_oklch,var(--color-violet-hot)_60%,var(--color-rule))]
                transition-colors
              "
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="
          flex items-end gap-2
          rounded-[10px]
          border border-[var(--color-rule)]
          bg-[color-mix(in_oklch,var(--color-void)_70%,transparent)]
          pl-3 pr-1.5 py-1.5
          focus-within:border-[color-mix(in_oklch,var(--color-violet-hot)_80%,var(--color-rule))]
          transition-colors
        "
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Speak with the runtime…"
          rows={1}
          className="
            flex-1 resize-none bg-transparent
            text-[13px] font-sans leading-[1.45]
            text-[var(--color-ink)]
            placeholder:text-[var(--color-ink-mute)]
            focus:outline-none
            min-h-[22px] max-h-[160px]
            py-[3px]
          "
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (sending) onStop();
              else if (draft.trim() !== "") onSend();
            }
          }}
        />
        <div className="flex items-center self-end">
          {sending ? (
            <button
              type="button"
              onClick={onStop}
              className="
                w-7 h-7 rounded-full flex items-center justify-center
                bg-[var(--color-sig-effect)] text-[var(--color-void)]
                hover:brightness-110
              "
              aria-label="Stop"
              title="Stop generating"
            >
              <span className="block w-[9px] h-[9px] rounded-[1px] bg-[var(--color-void)]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={draft.trim() === ""}
              className="
                w-7 h-7 rounded-full flex items-center justify-center
                bg-[var(--color-violet-hot)] text-[var(--color-void)]
                disabled:bg-transparent
                disabled:text-[var(--color-ink-mute)]
                disabled:cursor-not-allowed
                hover:brightness-110
              "
              aria-label="Send"
              title="Send · ⏎"
            >
              <span className="text-[14px] leading-none font-bold">↑</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------
// Helpers: tool rendering
// --------------------------------------------------------------------

/**
 * Map tool names to Studio's signal-channel palette so the transcript
 * reads as a runtime op log, not a generic function call trace.
 */
function resolveToolChannel(name: string): string {
  if (name === "dispatch" || name === "studioDispatch" || name === "seedMock") {
    return "var(--color-sig-action)";
  }
  if (name.startsWith("inspect") || name === "generateMock") {
    return "var(--color-sig-computed)";
  }
  if (name === "explainLegality") {
    return "var(--color-sig-effect)";
  }
  return "var(--color-ink)";
}

function formatInputInline(input: unknown): string {
  if (input === undefined || input === null) return "{}";
  if (typeof input !== "object") return truncate(String(input), 56);
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const rendered = entries
    .map(([k, v]) => `${k}: ${formatInlineValue(v)}`)
    .join(", ");
  return `{ ${truncate(rendered, 56)} }`;
}

function formatInlineValue(v: unknown): string {
  if (typeof v === "string") return `"${truncate(v, 20)}"`;
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return "{…}";
  return String(v);
}

function formatToolDisplay(
  input: unknown,
  output: unknown,
  errorText: string | undefined,
): string {
  const parts: string[] = [];
  if (input !== undefined && Object.keys(input as object ?? {}).length > 0) {
    parts.push("// input\n" + stringifySafe(input));
  }
  if (errorText !== undefined && errorText !== "") {
    parts.push("// error\n" + errorText);
  } else if (output !== undefined) {
    parts.push("// output\n" + stringifySafe(output));
  }
  return parts.join("\n\n") || "(no data)";
}

function stringifySafe(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// --------------------------------------------------------------------
// Helpers: message → derived data
// --------------------------------------------------------------------

function extractUserText(m: UIMessage): string {
  return m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

function extractAssistantText(m: UIMessage): string {
  return m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

function findMostRecentUserText(
  messages: readonly UIMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") {
      const txt = extractUserText(m);
      return txt === "" ? null : txt;
    }
  }
  return null;
}

function buildRecentTurnsFromMessages(
  messages: readonly UIMessage[],
): readonly RecentTurn[] {
  // Pair user → next assistant into turns, newest-first, capped at 5.
  const turns: RecentTurn[] = [];
  for (let i = 0; i < messages.length && turns.length < RECENT_TURN_LIMIT; i++) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const userText = extractUserText(m);
    const next = messages[i + 1];
    if (next === undefined || next.role !== "assistant") continue;
    const answer = extractAssistantText(next);
    const toolCount = next.parts.filter(isToolPart).length;
    turns.push({
      turnId: m.id,
      userPrompt: userText,
      assistantExcerpt: capExcerpt(answer),
      toolCount,
    });
  }
  // Reverse to newest-first for the system-prompt tail.
  return turns.reverse();
}

function messagesToConversationTurns(
  messages: readonly UIMessage[],
): readonly FullConversationTurn[] {
  const turns: FullConversationTurn[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    // Find the preceding user message for this turn.
    let userText = "";
    let userId: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const u = messages[j]!;
      if (u.role === "user") {
        userText = extractUserText(u);
        userId = u.id;
        break;
      }
    }
    if (userId === null) continue;
    const toolCalls = m.parts.filter(isToolPart).map((p) => {
      const name = p.type.slice("tool-".length);
      const input = (p as { input?: unknown }).input;
      const state = (p as { state: string }).state;
      return {
        name,
        argumentsJson: stringifySafe(input),
        ok: state === "output-available",
      };
    });
    let assistantText = "";
    let reasoning = "";
    for (const part of m.parts) {
      if (part.type === "text") assistantText += part.text;
      if (part.type === "reasoning") reasoning += part.text;
    }
    turns.push({
      turnId: userId,
      userPrompt: userText,
      assistantText,
      reasoning,
      toolCalls,
      endedAt: null,
      stoppedAtCap: false,
    });
  }
  return turns;
}

function capExcerpt(s: string): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  if (collapsed.length <= RECENT_TURN_EXCERPT_CAP) return collapsed;
  return collapsed.slice(0, RECENT_TURN_EXCERPT_CAP - 1) + "…";
}

// --------------------------------------------------------------------
// Tool contexts — user + studio domain
// --------------------------------------------------------------------

function buildUserToolContext(
  core: StudioCore,
): LegalityContext & DispatchContext {
  type CoreExplain = (intent: unknown) => ReturnType<
    LegalityContext["explainIntent"]
  >;
  type CoreWhyNot = (intent: unknown) => ReturnType<LegalityContext["whyNot"]>;
  const listActionNames = (): readonly string[] => {
    const mod = core.getModule();
    const actions = mod?.schema.actions;
    return actions !== undefined ? Object.keys(actions) : [];
  };
  return {
    isActionAvailable: (name) => core.isActionAvailable(name),
    createIntent: (action, ...args) => core.createIntent(action, ...args),
    explainIntent: core.explainIntent as unknown as CoreExplain,
    whyNot: core.whyNot as unknown as CoreWhyNot,
    listActionNames,
    dispatchAsync: (intent) =>
      core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      ) as unknown as Promise<DispatchResultLike>,
  };
}

function buildStudioToolContext(core: StudioCore): StudioDispatchContext {
  return {
    isActionAvailable: (name) => core.isActionAvailable(name),
    createIntent: (action, ...args) => core.createIntent(action, ...args),
    dispatchAsync: (intent) =>
      core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      ) as unknown as Promise<DispatchResultLike>,
    listActionNames: () => {
      const mod = core.getModule();
      const actions = mod?.schema.actions;
      return actions !== undefined ? Object.keys(actions) : [];
    },
  };
}

function safeGetSource(adapter: EditorAdapter): string {
  try {
    return adapter.getSource();
  } catch {
    return "";
  }
}

