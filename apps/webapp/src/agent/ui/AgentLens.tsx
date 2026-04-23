/**
 * AgentLens — the 6th LensPane tab. Phase α agent surface, rebuilt
 * around the taskflow pattern (see `docs/studio-agent-roadmap.md`
 * and `taskflow/docs/ARCHITECTURE.md`):
 *
 *   - A fat, Manifesto-native context is rebuilt every turn: MEL
 *     source + snapshot + availability list go straight into the
 *     system prompt. The model does not discover the domain through
 *     tool calls.
 *   - Writes go through one generic `dispatch` tool — the runtime's
 *     own legality gates remain authoritative, so we don't need per-
 *     action tools or a cached "allowed list" in the prompt.
 *   - `explainLegality` stays as an explain-only aux tool for "why
 *     is X blocked?" questions.
 *
 * Import discipline: this file is allowed to use React + webapp
 * aliases. Everything under `../agents/`, `../tools/`, `../session/`
 * remains React-free (see `../__tests__/import-boundaries.test.ts`).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useStudio } from "@manifesto-ai/studio-react";
import type { EditorAdapter, StudioCore } from "@manifesto-ai/studio-core";
import { useStudioUi } from "@/domain/StudioUiRuntime";
import {
  createOllamaProvider,
  probeOllama,
  readOllamaConfigFromEnv,
  type OllamaConfig,
} from "../provider/ollama.js";
import { LlmProviderError, type LlmProvider } from "../provider/types.js";
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
import { runOrchestrator } from "../agents/orchestrator.js";
import {
  buildAgentSystemPrompt,
  readStudioAgentContext,
} from "../session/agent-context.js";
import {
  createTranscriptStore,
  groupByTurn,
  type TranscriptEntry,
  type TranscriptStore,
  type TranscriptTurn,
} from "../session/transcript.js";
import { MarkdownBody } from "./MarkdownBody.js";

type ProbeState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly config: OllamaConfig;
      readonly models: readonly string[];
    }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly config?: OllamaConfig;
    };

export function AgentLens(): JSX.Element {
  const { core, adapter } = useStudio();
  const ui = useStudioUi();

  const [probe, setProbe] = useState<ProbeState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    let config: OllamaConfig;
    try {
      config = readOllamaConfigFromEnv();
    } catch (err) {
      const message =
        err instanceof LlmProviderError || err instanceof Error
          ? err.message
          : String(err);
      setProbe({ kind: "error", message });
      return;
    }
    void probeOllama(config).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setProbe({ kind: "ready", config, models: result.models });
      } else {
        setProbe({
          kind: "error",
          message: result.error,
          config,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Provider persists across the lens' lifetime; registry + contexts
  // are rebuilt whenever either core's identity changes (e.g. project
  // switch rebuilds the user core) so the bound tools always point at
  // the live runtime.
  const providerRef = useRef<LlmProvider | null>(null);
  const transcript = useMemo<TranscriptStore>(
    () => createTranscriptStore(),
    [],
  );

  useEffect(() => {
    if (probe.kind !== "ready") {
      providerRef.current = null;
      return;
    }
    providerRef.current = createOllamaProvider(probe.config);
  }, [probe]);

  // `useSyncExternalStore` for the transcript. Single subscription,
  // single getSnapshot — React handles bail-out on equal refs.
  const entries = useSyncExternalStore(
    transcript.subscribe,
    transcript.getSnapshot,
    transcript.getSnapshot,
  );
  const turns = useMemo(() => groupByTurn(entries), [entries]);

  // Tools read live values via refs, not closed-over snapshots, so
  // the registry stays stable across focus/dispatch changes and the
  // tool context always sees current state at call time. This is the
  // introspection contract: agent calls `inspectFocus()` and gets the
  // value as it is *now*, not as it was when the prompt was built.
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
    // seedMock reuses the user-domain write seam: same createIntent
    // and dispatchAsync the `dispatch` tool is bound to. The tool
    // internally runs a sequential generate → dispatch loop and
    // returns a tally, so the agent can seed in one call instead
    // of fanning N dispatches itself.
    const seedMockCtx: SeedMockContext = {
      getModule: () => core.getModule(),
      createIntent: (action, ...args) => core.createIntent(action, ...args),
      dispatchAsync: (intent) =>
        core.dispatchAsync(
          intent as Parameters<typeof core.dispatchAsync>[0],
        ) as unknown as Promise<{ kind: string }>,
    };
    const tools = [
      bindTool(createDispatchTool(), userCtx),
      bindTool(createLegalityTool(), userCtx),
      bindTool(createInspectFocusTool(), inspectFocusCtx),
      bindTool(createInspectSnapshotTool(), inspectSnapshotCtx),
      bindTool(createInspectNeighborsTool(), inspectNeighborsCtx),
      bindTool(createInspectAvailabilityTool(), inspectAvailabilityCtx),
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
  // reads live editor content, which isn't a value React tracks.
  // We call it at send time (see onSend below). The adapter may still
  // be null if the editor host hasn't mounted yet; fall back to "".
  const readMelSource = useCallback(
    (): string => (adapter !== null ? safeGetSource(adapter) : ""),
    [adapter],
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const onStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onSend = useCallback(async () => {
    const prompt = draft.trim();
    const provider = providerRef.current;
    if (prompt === "" || provider === null || sending) return;
    setSending(true);
    setDraft("");
    const controller = new AbortController();
    abortRef.current = controller;
    const turnId = transcript.beginTurn(prompt);
    try {
      // System prompt only needs identity + tool catalog + MEL. All
      // dynamic values (focus, snapshot, availability, edges) are
      // pulled via inspect* tools at turn time.
      const ctx = readStudioAgentContext(core, readMelSource());
      const system = buildAgentSystemPrompt(ctx);
      const result = await runOrchestrator({
        userPrompt: prompt,
        system,
        provider,
        registry,
        // Model default is 1.0 for gemma4 and similar families — too
        // hot for tool-use routing, where we want the model to commit
        // to a specific tool/arg choice given the grounded context.
        // 0.2 still leaves some slack for the clarifying-question
        // branch when the request really is ambiguous.
        temperature: 0.2,
        signal: controller.signal,
        onStep: (step) => transcript.appendStep(turnId, step),
        onStream: (event, meta) => {
          if (event.kind === "content") {
            transcript.appendStreamDelta(turnId, meta.stepIndex, {
              content: event.delta,
            });
          } else if (event.kind === "reasoning") {
            transcript.appendStreamDelta(turnId, meta.stepIndex, {
              reasoning: event.delta,
            });
          }
          // tool_call events arrive only after the full payload is
          // assembled — they flow through onStep as regular tool-step
          // entries, no pending UI needed.
        },
      });
      transcript.endTurn(turnId, {
        stoppedAtCap: result.stoppedAtCap,
        toolUses: result.toolUses,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "agent call failed";
      transcript.appendStep(turnId, {
        kind: "llm",
        message: {
          role: "assistant",
          content: controller.signal.aborted
            ? "[stopped by user]"
            : `[agent error] ${message}`,
        },
      });
      transcript.endTurn(turnId, { stoppedAtCap: false, toolUses: 0 });
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }, [core, draft, readMelSource, registry, sending, transcript, ui]);

  const examplePrompts = useMemo<readonly string[]>(
    () => [
      "지금 왜 이게 막혀있어?",
      "available한 액션들 알려줘",
      "이것에 대해 설명해줘",
    ],
    [],
  );
  const pickExample = useCallback((text: string) => {
    setDraft(text);
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 p-3 gap-3">
      <ProbeBanner probe={probe} />
      <Messages turns={turns} sending={sending} />
      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        onStop={onStop}
        onClear={() => transcript.clear()}
        sending={sending}
        disabled={probe.kind !== "ready"}
        hasEntries={entries.length > 0}
        examples={turns.length === 0 ? examplePrompts : undefined}
        onPickExample={pickExample}
      />
    </div>
  );
}

function ProbeBanner({ probe }: { readonly probe: ProbeState }): JSX.Element {
  if (probe.kind === "loading") {
    return (
      <Banner tone="info">
        Probing Ollama endpoint…
      </Banner>
    );
  }
  if (probe.kind === "error") {
    return (
      <Banner tone="warn">
        Agent offline — {probe.message}.{" "}
        {probe.config !== undefined ? (
          <>
            Endpoint: <code>{probe.config.baseUrl}</code>.
          </>
        ) : null}
      </Banner>
    );
  }
  const { config, models } = probe;
  const known = models.includes(config.model);
  if (!known) {
    return (
      <Banner tone="warn">
        Model <code>{config.model}</code> not listed by{" "}
        <code>{config.baseUrl}</code>. Known: {models.slice(0, 4).join(", ")}
        {models.length > 4 ? "…" : ""}
      </Banner>
    );
  }
  return (
    <Banner tone="ok">
      Connected to <code>{config.baseUrl}</code> — model{" "}
      <code>{config.model}</code>.
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  readonly tone: "info" | "ok" | "warn";
  readonly children: ReactNode;
}): JSX.Element {
  const bg =
    tone === "ok"
      ? "bg-[color-mix(in_oklch,var(--color-sig-state)_20%,transparent)]"
      : tone === "warn"
      ? "bg-[color-mix(in_oklch,var(--color-sig-effect)_20%,transparent)]"
      : "bg-[var(--color-glass)]";
  return (
    <div
      className={`rounded-md border border-[var(--color-rule)] px-2 py-1 text-[11px] font-mono ${bg}`}
    >
      {children}
    </div>
  );
}

/**
 * Messages list. Auto-scrolls to bottom on new entries unless the
 * user has scrolled up (sticky-bottom pattern). Renders user
 * prompts, assistant bubbles (streaming-aware), tool-call cards,
 * and reasoning panes.
 */
function Messages({
  turns,
  sending,
}: {
  readonly turns: readonly TranscriptTurn[];
  readonly sending: boolean;
}): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);

  // Track whether the user is near the bottom. If so, future content
  // auto-scrolls; if they've scrolled up to read, we don't yank them.
  const onScroll = useCallback((): void => {
    const el = scrollerRef.current;
    if (el === null) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = dist < 40;
  }, []);

  // Signature that invalidates on every content change so the effect
  // runs exactly when there's something new to scroll to.
  const signature = turns.reduce((acc, t) => {
    const last = t.steps[t.steps.length - 1];
    const sig =
      last === undefined
        ? ""
        : last.kind === "llm-pending"
          ? `${last.stepIndex}:${last.content.length}:${last.reasoning.length}`
          : String(last.seq);
    return `${acc}|${t.turnId}:${sig}`;
  }, "");

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
      className="
        flex-1 min-h-0 overflow-y-auto
        rounded-md border border-[var(--color-rule)]
        bg-[color-mix(in_oklch,var(--color-void)_50%,transparent)]
        px-3 py-4
      "
    >
      {turns.length === 0 ? (
        <EmptyState sending={sending} />
      ) : (
        <ol className="flex flex-col gap-4">
          {turns.map((turn) => (
            <TurnBlock key={turn.turnId} turn={turn} />
          ))}
        </ol>
      )}
    </div>
  );
}

function EmptyState({ sending }: { readonly sending: boolean }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[240px] gap-3 text-center select-none">
      <div className="w-9 h-9 rounded-full border border-[var(--color-rule)] bg-[var(--color-glass)] flex items-center justify-center">
        <span className="text-[var(--color-violet-hot)] text-[16px]">✦</span>
      </div>
      <div className="text-[13px] font-sans text-[var(--color-ink)]">
        Manifesto Agent
      </div>
      <div className="text-[11px] font-sans text-[var(--color-ink-mute)] max-w-[320px]">
        {sending
          ? "Preparing your session…"
          : "Ask about the focused node, why an action is blocked, or what to dispatch next."}
      </div>
    </div>
  );
}

function TurnBlock({ turn }: { readonly turn: TranscriptTurn }): JSX.Element {
  return (
    <li className="flex flex-col gap-3 list-none">
      <UserBubble text={turn.userPrompt} />
      {turn.steps.map((step) => {
        if (step.kind === "tool") return <ToolCard key={step.seq} step={step} />;
        if (step.kind === "llm-pending") {
          return <AssistantBubble key={step.seq} pending step={step} />;
        }
        if (step.kind === "llm") {
          return <AssistantBubble key={step.seq} step={step} />;
        }
        return null;
      })}
      {turn.end !== null ? <TurnFooter end={turn.end} /> : null}
    </li>
  );
}

function UserBubble({ text }: { readonly text: string }): JSX.Element {
  return (
    <div className="flex justify-end">
      <div
        className="
          max-w-[85%] rounded-2xl rounded-br-sm
          px-3 py-2 text-[12.5px] font-sans leading-relaxed
          bg-[var(--color-violet-hot)] text-[var(--color-void)]
          break-words
          shadow-[0_1px_2px_rgba(0,0,0,0.25)]
        "
      >
        {/* User input is plaintext intent — we don't render markdown
         * here. Preserve newlines via pre-wrap but otherwise render as
         * literal text so a user who types '*hello*' sees asterisks. */}
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    </div>
  );
}

type AssistantBubbleProps =
  | {
      readonly pending: true;
      readonly step: Extract<TranscriptEntry, { kind: "llm-pending" }>;
    }
  | {
      readonly pending?: false;
      readonly step: Extract<TranscriptEntry, { kind: "llm" }>;
    };

function AssistantBubble(props: AssistantBubbleProps): JSX.Element {
  const isPending = props.pending === true;
  const content = isPending
    ? props.step.content
    : props.step.message.content ?? "";
  const reasoning = isPending
    ? props.step.reasoning
    : props.step.reasoning ?? "";
  const toolCallsOnly =
    !isPending &&
    content === "" &&
    props.step.message.toolCalls !== undefined &&
    props.step.message.toolCalls.length > 0;
  return (
    <div className="flex flex-col items-start gap-1 max-w-[92%]">
      <div className="flex items-center gap-1.5 text-[10px] font-sans text-[var(--color-ink-mute)] px-1">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-[var(--color-violet-hot)]"
        />
        <span>agent</span>
        {isPending ? <span className="opacity-70">· streaming…</span> : null}
      </div>
      {reasoning !== "" ? <ReasoningPane text={reasoning} /> : null}
      {content !== "" || isPending ? (
        <div
          className="
            rounded-2xl rounded-tl-sm
            px-3 py-2 text-[12.5px] font-sans leading-relaxed
            bg-[color-mix(in_oklch,var(--color-glass)_85%,transparent)]
            border border-[var(--color-rule)]
            text-[var(--color-ink)]
            break-words
          "
        >
          {/* During streaming the content may be a partial markdown
           * fragment (unclosed code fence, lone `**`, etc.). react-
           * markdown tolerates this — it renders what it can and leaves
           * the rest as text until the next delta completes the token. */}
          <MarkdownBody>{content}</MarkdownBody>
          {isPending ? (
            <span
              className="
                inline-block w-[6px] h-[14px] ml-[2px] align-[-2px]
                bg-[var(--color-violet-hot)]
                animate-[mf-cursor_1s_steps(2)_infinite]
              "
              aria-hidden
            />
          ) : null}
        </div>
      ) : toolCallsOnly ? (
        <div className="text-[10.5px] font-sans text-[var(--color-ink-mute)] px-1 italic">
          (tool call only — see above)
        </div>
      ) : null}
    </div>
  );
}

function ReasoningPane({ text }: { readonly text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="
        w-full rounded-md border border-[var(--color-rule)]
        bg-[color-mix(in_oklch,var(--color-void)_55%,transparent)]
        px-2 py-1
      "
    >
      <summary className="cursor-pointer text-[10px] font-sans text-[var(--color-ink-mute)] list-none">
        <span className="opacity-70">💭 thinking</span>
        <span className="ml-1 opacity-50">({text.length} chars)</span>
      </summary>
      <pre className="mt-1.5 text-[10.5px] font-mono whitespace-pre-wrap text-[var(--color-ink-dim)] leading-snug">
        {text}
      </pre>
    </details>
  );
}

function ToolCard({
  step,
}: {
  readonly step: Extract<TranscriptEntry, { kind: "tool" }>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const result = parseToolResult(step.resultJson);
  const ok = result.ok;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="
        self-start max-w-[92%] w-fit
        rounded-md border border-[var(--color-rule)]
        bg-[color-mix(in_oklch,var(--color-glass)_70%,transparent)]
        px-2 py-1
      "
    >
      <summary className="cursor-pointer text-[11px] font-mono flex items-center gap-1.5 list-none">
        <span
          aria-hidden
          className={`w-1.5 h-1.5 rounded-full ${
            ok
              ? "bg-[var(--color-sig-state)]"
              : "bg-[var(--color-sig-effect)]"
          }`}
        />
        <span className="text-[var(--color-sig-action)]">
          {step.toolCall.name}
        </span>
        <span className="text-[var(--color-ink-mute)]">
          ({truncate(step.toolCall.argumentsJson, 48)})
        </span>
        <span
          className={`ml-auto text-[10px] ${
            ok ? "text-[var(--color-ink-mute)]" : "text-[var(--color-sig-effect)]"
          }`}
        >
          {ok ? "✓" : "✗"}
        </span>
      </summary>
      <pre className="mt-1 text-[10.5px] font-mono whitespace-pre-wrap text-[var(--color-ink-dim)]">
        {formatResult(step.resultJson)}
      </pre>
    </details>
  );
}

function TurnFooter({
  end,
}: {
  readonly end: Extract<TranscriptEntry, { kind: "turn-end" }>;
}): JSX.Element {
  return (
    <div className="text-[10px] font-mono text-[var(--color-ink-mute)] pl-1">
      {end.toolUses} tool call{end.toolUses === 1 ? "" : "s"}
      {end.stoppedAtCap ? " · stopped at cap" : ""}
    </div>
  );
}

function Composer({
  draft,
  setDraft,
  onSend,
  onStop,
  onClear,
  sending,
  disabled,
  hasEntries,
  examples,
  onPickExample,
}: {
  readonly draft: string;
  readonly setDraft: (s: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly onClear: () => void;
  readonly sending: boolean;
  readonly disabled: boolean;
  readonly hasEntries: boolean;
  readonly examples?: readonly string[];
  readonly onPickExample: (text: string) => void;
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow textarea up to 8 lines tall. Resetting height first is
  // required because scrollHeight won't shrink on deletion otherwise.
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "0px";
    const max = 8 * 18 + 16; // 8 lines × line-height + padding
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [draft]);

  return (
    <div className="flex flex-col gap-2">
      {examples !== undefined && examples.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onPickExample(ex)}
              className="
                px-2 py-1 rounded-full text-[11px] font-sans
                border border-[var(--color-rule)]
                bg-[var(--color-glass)]
                text-[var(--color-ink-dim)]
                hover:text-[var(--color-ink)]
                hover:border-[var(--color-glass-edge-hot)]
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
          rounded-xl border border-[var(--color-rule)]
          bg-[color-mix(in_oklch,var(--color-void)_60%,transparent)]
          px-2 py-2
          focus-within:border-[var(--color-glass-edge-hot)]
          transition-colors
        "
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          placeholder={
            disabled
              ? "Agent offline — waiting for Ollama"
              : "Message the agent — Shift+Enter for newline"
          }
          rows={1}
          className="
            flex-1 resize-none bg-transparent
            text-[12.5px] font-sans leading-[1.4]
            text-[var(--color-ink)]
            placeholder:text-[var(--color-ink-mute)]
            focus:outline-none
            disabled:opacity-50
            min-h-[22px] max-h-[160px]
          "
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (sending) onStop();
              else if (draft.trim() !== "") onSend();
            }
          }}
        />
        <div className="flex items-center gap-1 self-end">
          {sending ? (
            <button
              type="button"
              onClick={onStop}
              className="
                w-7 h-7 rounded-md flex items-center justify-center
                bg-[var(--color-sig-effect)] text-[var(--color-void)]
                hover:brightness-110
              "
              aria-label="Stop"
              title="Stop (Enter)"
            >
              <span className="block w-2.5 h-2.5 rounded-[1px] bg-[var(--color-void)]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={draft.trim() === "" || disabled}
              className="
                w-7 h-7 rounded-md flex items-center justify-center
                bg-[var(--color-violet-hot)] text-[var(--color-void)]
                disabled:bg-[var(--color-glass)]
                disabled:text-[var(--color-ink-mute)]
                disabled:cursor-not-allowed
                hover:brightness-110
              "
              aria-label="Send"
              title="Send (Enter)"
            >
              <span className="text-[14px] leading-none">↑</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-sans text-[var(--color-ink-mute)] px-1">
        <span>Enter to send · Shift+Enter for newline</span>
        <button
          type="button"
          onClick={onClear}
          disabled={!hasEntries || sending}
          className="
            hover:text-[var(--color-ink-dim)]
            disabled:opacity-40 disabled:hover:text-[var(--color-ink-mute)]
          "
        >
          Clear conversation
        </button>
      </div>
    </div>
  );
}

function parseToolResult(raw: string): { readonly ok: boolean } {
  try {
    const parsed = JSON.parse(raw) as { readonly ok?: unknown };
    return { ok: parsed.ok === true };
  } catch {
    return { ok: false };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatResult(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Glue between the real user-domain StudioCore and the tool-context
 * slices for `dispatch` and `explainLegality`. Each tool reads only
 * the fields its own `*Context` shape declares; the builder returns
 * the union so both tools can bind against the same context value.
 *
 * Casts are narrow — LegalityContext / DispatchContext deliberately
 * treat the Intent + DispatchReport as `unknown` so they don't pull
 * the SDK's generic parameters. The real `core.*` methods take the
 * concrete typed versions; since we pipe through our own
 * `createIntent`, identity is preserved at runtime even though TS
 * doesn't see it.
 */
/**
 * User-domain tool context. Both `dispatch` and `explainLegality`
 * read the narrow `*Context` slices they declare from the same
 * StudioCore. React freshness is handled at the core-subscription
 * level (see `StudioProvider` → `core.subscribeAfterDispatch`), so
 * this builder can hit `core.dispatchAsync` directly without
 * plumbing a React-aware dispatch helper through.
 */
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

/**
 * studio.mel tool context. Same shape as the user context but
 * targeting the studio UI runtime. StudioUiRuntime subscribes to its
 * core's `subscribeAfterDispatch`, so writing here auto-bumps the
 * UI's version without extra plumbing.
 */
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
