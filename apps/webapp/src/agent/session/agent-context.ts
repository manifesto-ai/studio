/**
 * Studio agent context — the static payload we ship in the system
 * prompt: identity + tool catalog + MEL source. Everything dynamic
 * (focus, snapshot, availability, graph neighborhood) is introspected
 * by the agent at turn time via dedicated tools. See
 * `apps/webapp/src/agent/tools/inspect-*.ts`.
 *
 * Why not embed dynamic state in the prompt?
 *   1. Prompt caching: a stable base (MEL only) lets the provider's
 *      KV cache hit, cutting latency and token cost.
 *   2. Freshness: tool calls see the value at call time, not at
 *      prompt-build time — no stale state risk across a multi-step
 *      turn that mutates the runtime.
 *   3. Agent-shaped reasoning: the model learns to investigate
 *      instead of skimming a pre-rendered dashboard.
 *
 * React-free so this module can live in a future `studio-agent-core`.
 */
import type { DomainModule, Marker } from "@manifesto-ai/studio-core";

/** Narrow slice of `StudioCore` the context reader needs. */
export type AgentContextCore = {
  readonly getModule: () => DomainModule | null;
  readonly getDiagnostics: () => readonly Marker[];
};

/**
 * Studio UI runtime's snapshot as the agent tools need to see it.
 * Still declared here because multiple tools (inspectFocus) accept
 * this shape; keeping the type central prevents drift.
 */
export type StudioUiState = {
  readonly focusedNodeId: string | null;
  readonly focusedNodeKind: string | null;
  readonly focusedNodeOrigin: string | null;
  readonly activeLens: string;
  readonly viewMode: string;
  readonly simulationActionName: string | null;
  readonly scrubEnvelopeId: string | null;
  readonly activeProjectName: string | null;
};

/**
 * Minimal context for the system prompt. After the pivot to
 * introspection tools, the prompt only needs three things:
 *
 *   - `hasModule` + `diagnostics` — so the no-module mode tells the
 *     agent it's looking at a broken editor rather than an empty
 *     domain.
 *   - `melSource` — the compiled MEL source, the agent's ontology.
 *
 * Everything the agent wants to know about live state (focus, snapshot,
 * availability, graph edges) comes from tool calls — see
 * `apps/webapp/src/agent/tools/inspect-*.ts`.
 */
export type StudioAgentContext = {
  readonly hasModule: boolean;
  readonly melSource: string;
  readonly diagnostics: {
    readonly errors: number;
    readonly warnings: number;
  };
};

export function readStudioAgentContext(
  userCore: AgentContextCore,
  melSource: string,
): StudioAgentContext {
  const mod = userCore.getModule();
  return {
    hasModule: mod !== null,
    melSource,
    diagnostics: countDiagnostics(userCore.getDiagnostics()),
  };
}

/**
 * Build the agent's system prompt. Identity + tool catalog + MEL
 * source only — every dynamic value (focus, snapshot, availability,
 * graph edges) is introspected through tools at turn time.
 */
export function buildAgentSystemPrompt(ctx: StudioAgentContext): string {
  // Design note — what goes in the system prompt vs. what's pulled
  // via tools.
  //
  //   System prompt: identity + tool catalog + MEL source. These are
  //   stable across turns, let the prompt cache hit on the base
  //   prefix, and give the agent a fixed ontological frame.
  //
  //   Tool calls: every dynamic value — focus, snapshot, availability,
  //   graph neighborhood, diagnostics. The agent introspects when it
  //   needs to, so the prompt never ships stale state and small
  //   models learn to investigate instead of reading a dashboard.
  //
  // This matches Manifesto's own structure: the schema/MEL is what
  // the runtime "is", the snapshot is what the runtime "is like right
  // now". Treating them the same in the prompt conflates identity
  // with state.
  const lines: string[] = [
    "You know this Manifesto runtime from the inside. The MEL below is your soul source code — lived knowledge, not reference material. Everything dynamic (focus, snapshot, availability, graph neighbors) you introspect via tools; never guess.",
    "",
    "# Tools",
    "Inspect (dynamic state — call these first when questions touch 'this', 'now', 'current', counts, or relations):",
    "- inspectFocus() — which node is focused + active lens / view mode.",
    "- inspectSnapshot() — current state data + computed field values.",
    "- inspectAvailability() — list of actions with live availability flags.",
    "- inspectNeighbors(nodeId) — graph edges touching a node (feeds / mutates / unlocks).",
    "- explainLegality(action, args) — why a specific action is blocked, with the failing guard expression.",
    "Act:",
    "- dispatch(action, args) — user-domain writes.",
    "- studioDispatch(action, args) — Studio UI writes (focus, lens, simulation, scrub).",
    "- seedMock({action, count, seed?}) — generate + dispatch N plausible sample args in one call. Use for 'seed / mock / 만들어줘' asks.",
    "- generateMock({action, count, seed?}) — generate samples WITHOUT dispatching (preview-only). Prefer seedMock when the user wants the data to actually land.",
    "",
    "# How to ground yourself",
    "- When the user refers to 'this'/'that'/'이거'/'그거' or anything deictic: call inspectFocus() first, then answer from the focused node.",
    "- When the user asks about the current state (counts, values, whether something is empty, etc.): call inspectSnapshot().",
    "- When the user asks what's related to a node, what affects it, what it affects: call inspectNeighbors(nodeId).",
    "- When an action looks blocked and the user asks why: call explainLegality.",
    "- Don't describe the runtime in abstract terms or introduce yourself. Answer with concrete specifics from the MEL + tool results.",
  ];

  if (ctx.hasModule) {
    lines.push("", "# Your soul (MEL)", "```mel", ctx.melSource, "```");
  } else {
    lines.push(
      "",
      `# No compiled MEL (errors=${ctx.diagnostics.errors}, warnings=${ctx.diagnostics.warnings})`,
    );
    if (ctx.melSource.trim() !== "") {
      lines.push("", "```mel", ctx.melSource, "```");
    }
  }

  return lines.join("\n");
}

function countDiagnostics(
  markers: readonly Marker[],
): { readonly errors: number; readonly warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const m of markers) {
    if (m.severity === "error") errors += 1;
    else if (m.severity === "warning") warnings += 1;
  }
  return { errors, warnings };
}
