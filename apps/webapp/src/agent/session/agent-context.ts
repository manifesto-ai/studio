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
  /** Last finalized user/agent turn. Single-entry memory so the
   *  agent can recall what it just said without a transcript store. */
  readonly lastUserPrompt: string | null;
  readonly lastAgentAnswer: string | null;
  readonly agentTurnCount: number;
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
/**
 * Compact projection of a past turn for the "Recent conversation"
 * tail of the system prompt. `assistantExcerpt` is length-capped so
 * sticking the last 5 turns into every request doesn't blow the
 * token budget. Full history is still available to the agent via
 * the `inspectConversation` tool.
 */
export type RecentTurn = {
  readonly turnId: string;
  readonly userPrompt: string;
  readonly assistantExcerpt: string;
  readonly toolCount: number;
};

export type StudioAgentContext = {
  readonly hasModule: boolean;
  readonly melSource: string;
  readonly diagnostics: {
    readonly errors: number;
    readonly warnings: number;
  };
  /**
   * Last few agent turns, newest-first. Empty on a fresh session
   * (no turns yet). Capped length keeps the system prompt bounded.
   */
  readonly recentTurns: readonly RecentTurn[];
};

export function readStudioAgentContext(
  userCore: AgentContextCore,
  melSource: string,
  recentTurns: readonly RecentTurn[] = [],
): StudioAgentContext {
  const mod = userCore.getModule();
  return {
    hasModule: mod !== null,
    melSource,
    diagnostics: countDiagnostics(userCore.getDiagnostics()),
    recentTurns,
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
    "- simulateIntent(action, args) — deterministic dry-run preview without dispatching; use before recommending a write.",
    "- locateSource(target) — source span + preview for action/computed/state citations.",
    "- inspectLineage({limit?, beforeWorldId?, fields?, intentType?}) — runtime dispatch history. DEFAULT is compact (worldId + intent only); opt into `changedPaths` / `parent` / `schemaHash` / `createdAt` via `fields` when needed.",
    "- inspectConversation({limit?, beforeTurnId?, fields?}) — this agent's own chat history (user prompts + your prior answers + tool traces). DEFAULT is compact (prompt + toolCount); opt into `assistantText` / `reasoning` / `toolCalls` via `fields`. Use to avoid repeating past explanations.",
    "- explainLegality(action, args) — why a specific action is blocked, with the failing guard expression.",
    "Source reads (MEL editing):",
    "- inspectSourceOutline() — list every declaration in the current MEL with line ranges. Call first before any edit.",
    "- readDeclaration({target}) — exact source text for one declaration (domain/type/state/computed/action). Read what is actually there; never reconstruct from memory.",
    "- findInSource({query, limit?}) — substring search in the current MEL; useful when the target name is uncertain.",
    "Act:",
    "- dispatch(action, args) — user-domain writes.",
    "- studioDispatch(action, args) — Studio UI writes (focus, lens, simulation, scrub).",
    "- seedMock({action, count, seed?}) — generate + dispatch N plausible sample args in one call. Use for 'seed / mock / 만들어줘' asks.",
    "- generateMock({action, count, seed?}) — generate samples WITHOUT dispatching (preview-only). Prefer seedMock when the user wants the data to actually land.",
    "Propose source changes:",
    "- createProposal({proposedSource, title?, rationale?}) — the ONLY way to change MEL. Ship the full proposed source; Studio shadow-builds it and shows an Accept/Reject diff. If it comes back with diagnostics, the response includes them under detail.failureReport — read them, re-read the failing spans with readDeclaration, then re-propose.",
    "",
    "# How to ground yourself",
    "- Deictic references ('this', 'that', 'it', '이것', '이거', '이건', '그거') → inspectFocus() first.",
    "- State, count, value, or computed questions → inspectSnapshot().",
    "- Relation and dependency questions → inspectNeighbors(nodeId).",
    "- Blocked actions → explainLegality(action, args).",
    "- Adding a focused action is allowed when the user asks for a small source change, but inspectSourceOutline() and readDeclaration({target}) must happen first.",
    "- Do not answer with a plain-text proposal summary for source edits; call createProposal.",
    "- Do not write the full MEL source yourself in the chat response; put the complete proposed source only in createProposal({proposedSource}).",
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

  // Recent conversation tail — always injected for short-horizon
  // continuity so the agent can reference the last few turns without
  // a tool round-trip. Intentionally placed AFTER the MEL so the
  // identity+tools+MEL prefix stays stable for prompt-cache hits;
  // only this tail varies per turn. Older history is searchable via
  // `inspectConversation` (explicit pointer in the section header).
  if (ctx.recentTurns.length > 0) {
    lines.push(
      "",
      `# Recent conversation (${ctx.recentTurns.length} most recent turn${ctx.recentTurns.length === 1 ? "" : "s"}, newest first)`,
      "Older turns are searchable via `inspectConversation({beforeTurnId, fields?})`.",
      "",
    );
    for (const [i, t] of ctx.recentTurns.entries()) {
      const label = `turn ${ctx.recentTurns.length - i}`;
      const toolTag = t.toolCount > 0 ? ` · ${t.toolCount} tool` : "";
      lines.push(`${label}${toolTag}`);
      lines.push(`  user: ${t.userPrompt}`);
      lines.push(
        `  you: ${t.assistantExcerpt === "" ? "(tool-only turn)" : t.assistantExcerpt}`,
      );
      if (i < ctx.recentTurns.length - 1) lines.push("");
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
