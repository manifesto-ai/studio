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
  type RecentTurn,
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
    // Project TranscriptStore entries into the tool's narrow
    // FullConversationTurn shape. Done at tool-call time (via the
    // ref) so the agent always sees the live transcript, not a
    // frozen copy captured when the registry was memoized.
    const inspectConversationCtx: InspectConversationContext = {
      getTurns: () => {
        const entries = transcript.getSnapshot();
        const turns = groupByTurn(entries);
        // Newest-first for pagination symmetry with inspectLineage.
        return [...turns].reverse().map<FullConversationTurn>((t) => {
          const toolCalls: {
            name: string;
            argumentsJson: string;
            ok: boolean;
          }[] = [];
          let assistantText = "";
          let reasoning = "";
          for (const step of t.steps) {
            if (step.kind === "tool") {
              toolCalls.push({
                name: step.toolCall.name,
                argumentsJson: step.toolCall.argumentsJson,
                ok: parseToolOk(step.resultJson),
              });
              continue;
            }
            if (step.kind === "llm") {
              const c = step.message.content;
              if (typeof c === "string" && c.length > 0) assistantText = c;
              if (typeof step.reasoning === "string") reasoning = step.reasoning;
              continue;
            }
            if (step.kind === "llm-pending") {
              // Partial still in flight — attribute to this turn so
              // the tool can report `hasAssistantText` correctly even
              // mid-stream, without blocking the response.
              if (assistantText === "" && step.content.length > 0) {
                assistantText = step.content;
              }
              if (reasoning === "" && step.reasoning.length > 0) {
                reasoning = step.reasoning;
              }
            }
          }
          return {
            turnId: t.turnId,
            userPrompt: t.userPrompt,
            assistantText,
            reasoning,
            toolCalls,
            endedAt: t.end !== null ? t.end.at : null,
            stoppedAtCap: t.end !== null ? t.end.stoppedAtCap : false,
          };
        });
      },
    };

    const inspectLineageCtx: InspectLineageContext = {
      // Project StudioCore's WorldLineage into the tool's own
      // FullLineageEntry shape exactly once. The tool itself then
      // filters, paginates, and projects fields — we return the full
      // shape here and let the tool decide what reaches the model.
      // Newest-first: core stores the chain head-last, so we reverse.
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
            // Core stores `recordedAt` as epoch ms; normalize to ISO
            // for the agent's consumption (matches the rest of the
            // tool-output conventions — ISO timestamps everywhere).
            createdAt:
              typeof w.recordedAt === "number"
                ? new Date(w.recordedAt).toISOString()
                : new Date().toISOString(),
          };
        });
      },
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
      // Pull the last few turns out of the transcript and inject them
      // into the system prompt for short-horizon continuity. Deeper
      // history is left to `inspectConversation` on demand.
      const recentTurns = buildRecentTurnsForPrompt(
        groupByTurn(transcript.getSnapshot()),
      );
      const ctx = readStudioAgentContext(
        core,
        readMelSource(),
        recentTurns,
      );
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
      // Commit the turn into studio.mel as a single-entry memory +
      // a lineage advance. The agent's next inspectFocus call will
      // see the new lastUserPrompt/lastAgentAnswer, and
      // inspectLineage can walk through past turns via the studio
      // runtime's world chain.
      const finalText =
        result.finalMessage.content ?? summarizeToolOnlyTurn(result);
      ui.recordAgentTurn(prompt, finalText);
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

  // Manifesto-flavored prompts: each one targets a Studio construct
  // (guard, snapshot, action, node) using its native vocabulary.
  const examplePrompts = useMemo<readonly string[]>(
    () => [
      "What guards this action?",
      "Describe the current snapshot.",
      "List actions I can dispatch.",
      "Seed 5 rows for this action.",
    ],
    [],
  );
  const pickExample = useCallback((text: string) => {
    setDraft(text);
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ProbeStatus probe={probe} onClear={() => transcript.clear()}
        canClear={entries.length > 0 && !sending} />
      <Messages turns={turns} sending={sending} />
      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        onStop={onStop}
        sending={sending}
        disabled={probe.kind !== "ready"}
        examples={turns.length === 0 ? examplePrompts : undefined}
        onPickExample={pickExample}
      />
    </div>
  );
}

/**
 * Hairline status strip — mirrors the Studio TopBar's dot-plus-text
 * idiom so the agent's connection state reads as part of the same
 * system, not a third-party chat widget. A red dot means offline, a
 * state-green one means connected. Model tag + an optional "clear"
 * ghost link sit on the right.
 */
function ProbeStatus({
  probe,
  onClear,
  canClear,
}: {
  readonly probe: ProbeState;
  readonly onClear: () => void;
  readonly canClear: boolean;
}): JSX.Element {
  const { tone, label, detail } = resolveProbe(probe);
  const dotColor =
    tone === "ok"
      ? "var(--color-sig-state)"
      : tone === "warn"
        ? "var(--color-sig-effect)"
        : "var(--color-ink-mute)";
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
      <span className="text-[var(--color-ink-dim)] truncate">{label}</span>
      {detail !== undefined ? (
        <span className="text-[var(--color-ink-mute)] truncate">
          · {detail}
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

function resolveProbe(
  probe: ProbeState,
): { tone: "info" | "ok" | "warn"; label: string; detail?: string } {
  if (probe.kind === "loading") {
    return { tone: "info", label: "probing runtime…" };
  }
  if (probe.kind === "error") {
    return {
      tone: "warn",
      label: "offline",
      detail: probe.message,
    };
  }
  const { config, models } = probe;
  if (!models.includes(config.model)) {
    return {
      tone: "warn",
      label: config.model,
      detail: "model not listed by endpoint",
    };
  }
  return { tone: "ok", label: config.model };
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
      // No border / box — messages flow directly in the panel so the
      // agent reads as "continuation of the Studio," not a nested
      // widget. Padding keeps content off the chrome but stays airy.
      className="flex-1 min-h-0 overflow-y-auto px-4 py-5"
    >
      {turns.length === 0 ? (
        <EmptyState sending={sending} />
      ) : (
        <ol className="flex flex-col gap-5">
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
    <div className="flex flex-col items-start justify-center h-full min-h-[240px] gap-2 select-none">
      {/* Two hairlines + a violet accent — echoes the schema-graph
       * edge idiom elsewhere in Studio. No logo, no emoji. */}
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-px w-5 bg-[var(--color-violet-hot)]"
        />
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-ink-mute)]">
          manifesto · agent
        </span>
      </div>
      <div className="text-[14px] font-sans leading-snug text-[var(--color-ink)] max-w-[420px]">
        {sending
          ? "Preparing the runtime session…"
          : "Ask the runtime about itself — why an action is blocked, what the snapshot looks like, what to dispatch next."}
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
          max-w-[78%] rounded-[10px]
          px-3 py-[7px] text-[13px] font-sans leading-relaxed
          bg-[color-mix(in_oklch,var(--color-violet-hot)_92%,transparent)]
          text-[var(--color-void)]
          break-words
        "
      >
        {/* User input is plaintext intent — we don't render markdown
         * here so a user who types '*hello*' sees asterisks. */}
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
    // Left-side 2px accent bar (violet-hot), no bubble background.
    // This mirrors SnapshotTree's highlight motif and the Studio's
    // schema-graph "edge into node" visual — the agent's voice
    // literally enters from the runtime's side.
    <div className="flex gap-3">
      <div
        aria-hidden
        className="
          w-[2px] self-stretch rounded-full
          bg-[color-mix(in_oklch,var(--color-violet-hot)_75%,transparent)]
        "
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {reasoning !== "" ? <ReasoningPane text={reasoning} /> : null}
        {content !== "" || isPending ? (
          <div className="text-[13px] font-sans leading-relaxed text-[var(--color-ink)] break-words">
            {/* react-markdown handles partial fragments gracefully
             * during streaming (unclosed fence, lone `**`, etc.). */}
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
          <div className="text-[11px] font-mono text-[var(--color-ink-mute)] italic">
            {/* Assistant turn emitted tool call(s) only — the result
             * rows above already speak for the turn. */}
            observed the runtime.
          </div>
        ) : null}
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
      // No border, no fill — reasoning reads as a muted pre-script,
      // visibly subordinate to the answer below it.
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

function ToolCard({
  step,
}: {
  readonly step: Extract<TranscriptEntry, { kind: "tool" }>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const result = parseToolResult(step.resultJson);
  const ok = result.ok;
  const channel = resolveToolChannel(step.toolCall.name);
  return (
    // One-line, graph-edge-esque row: `▸ toolName(args) → verdict`.
    // Channel color on the tool name nods to state/action/computed/
    // effect channel tokens used elsewhere in Studio.
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
        <span style={{ color: channel }}>{step.toolCall.name}</span>
        <span className="text-[var(--color-ink-mute)] truncate">
          {formatArgsInline(step.toolCall.argumentsJson)}
        </span>
        <span className="text-[var(--color-ink-mute)] shrink-0">→</span>
        <span
          className={
            ok
              ? "text-[var(--color-ink-dim)] shrink-0"
              : "text-[var(--color-sig-effect)] shrink-0"
          }
        >
          {ok ? "ok" : "error"}
        </span>
      </summary>
      <pre
        className="
          mt-1.5 ml-5 px-2.5 py-2
          text-[10.5px] font-mono whitespace-pre-wrap
          text-[var(--color-ink-dim)] leading-relaxed
          border-l border-[var(--color-rule)]
        "
      >
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
    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-ink-mute)] pl-5">
      {end.toolUses === 0
        ? "no tool calls"
        : `${end.toolUses} tool call${end.toolUses === 1 ? "" : "s"}`}
      {end.stoppedAtCap ? " · capped" : ""}
    </div>
  );
}

/**
 * Map tool names to Studio's signal-channel palette so the transcript
 * reads as a runtime op log, not a generic function call trace. Writes
 * (dispatch / seed) = action. Reads (inspect*) = computed. Explainers
 * = effect (warn-ish orange). Generators = computed.
 */
function resolveToolChannel(name: string): string {
  if (name === "dispatch" || name === "studioDispatch" || name === "seedMock") {
    return "var(--color-sig-action)";
  }
  if (name.startsWith("inspect") || name === "generateMock") {
    // inspectLineage, inspectSnapshot, inspectFocus, etc. are all reads.
    return "var(--color-sig-computed)";
  }
  if (name === "explainLegality") {
    return "var(--color-sig-effect)";
  }
  return "var(--color-ink)";
}

/**
 * Inline-safe pretty-print of a tool-call arguments JSON. Drops
 * redundant quotes around short JSON so the transcript line reads
 * more like an edge label than a stringified blob. Long args get
 * truncated — the expand view has the full payload.
 */
function formatArgsInline(raw: string): string {
  if (raw === "" || raw === "{}") return "{}";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) return "{}";
      const rendered = entries
        .map(([k, v]) => `${k}: ${formatInlineValue(v)}`)
        .join(", ");
      return `{ ${truncate(rendered, 56)} }`;
    }
    return truncate(JSON.stringify(parsed), 56);
  } catch {
    return truncate(raw, 56);
  }
}

function formatInlineValue(v: unknown): string {
  if (typeof v === "string") return `"${truncate(v, 20)}"`;
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return "{…}";
  return String(v);
}

function Composer({
  draft,
  setDraft,
  onSend,
  onStop,
  sending,
  disabled,
  examples,
  onPickExample,
}: {
  readonly draft: string;
  readonly setDraft: (s: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly sending: boolean;
  readonly disabled: boolean;
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
          disabled={disabled}
          placeholder={
            disabled
              ? "Runtime offline — waiting for Ollama"
              : "Speak with the runtime…"
          }
          rows={1}
          className="
            flex-1 resize-none bg-transparent
            text-[13px] font-sans leading-[1.45]
            text-[var(--color-ink)]
            placeholder:text-[var(--color-ink-mute)]
            focus:outline-none
            disabled:opacity-50
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
              disabled={draft.trim() === "" || disabled}
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

/**
 * Summarize a tool-call-only turn (one with no assistant text but
 * N tool invocations) so the lineage entry we commit has something
 * human-legible. The agent itself can introspect the full trace via
 * the React transcript; this is just the "headline" persisted into
 * studio.mel.
 */
const RECENT_TURN_LIMIT = 5;
const RECENT_TURN_EXCERPT_CAP = 280;

/**
 * Project the transcript's most-recent completed turns into the
 * compact `RecentTurn` shape the system prompt expects. Newest-
 * first (matches the "Recent conversation" header's ordering).
 *
 * Only finalized turns are included — we skip in-flight `llm-
 * pending` entries because their content is mid-stream and the
 * excerpt would be a jagged fragment. The current user prompt
 * (this very turn) isn't in the transcript yet when this runs, so
 * we don't have to filter it out explicitly.
 *
 * Assistant excerpts are trimmed + capped so a single long answer
 * can't swell the tail; the agent can always pull the full text
 * via `inspectConversation({fields:["assistantText"]})`.
 */
function buildRecentTurnsForPrompt(
  turns: readonly TranscriptTurn[],
): readonly RecentTurn[] {
  if (turns.length === 0) return [];
  const reversed = [...turns].reverse();
  const recent = reversed.slice(0, RECENT_TURN_LIMIT);
  return recent.map<RecentTurn>((t) => {
    let assistantText = "";
    let toolCount = 0;
    for (const step of t.steps) {
      if (step.kind === "tool") {
        toolCount += 1;
        continue;
      }
      if (step.kind === "llm") {
        const c = step.message.content;
        if (typeof c === "string" && c.length > 0) assistantText = c;
      }
      // llm-pending intentionally ignored — content is partial.
    }
    return {
      turnId: t.turnId,
      userPrompt: t.userPrompt,
      assistantExcerpt: capRecentExcerpt(assistantText),
      toolCount,
    };
  });
}

function capRecentExcerpt(s: string): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  if (collapsed.length <= RECENT_TURN_EXCERPT_CAP) return collapsed;
  return collapsed.slice(0, RECENT_TURN_EXCERPT_CAP - 1) + "…";
}

function summarizeToolOnlyTurn(result: {
  readonly trace: readonly { readonly kind: string }[];
  readonly toolUses: number;
}): string {
  return `(tool-only turn · ${result.toolUses} call${
    result.toolUses === 1 ? "" : "s"
  })`;
}

/** Narrower form for places that only care about success/failure. */
function parseToolOk(raw: string): boolean {
  return parseToolResult(raw).ok;
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
