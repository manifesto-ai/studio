export type RecentTurn = {
  readonly turnId: string;
  readonly userPrompt: string;
  readonly assistantExcerpt: string;
  readonly toolCount: number;
};

export type RuntimeSignals = {
  readonly selectedNodeChanged: boolean;
  readonly currentFocusedNodeId: string | null;
  readonly currentFocusedNodeKind: string | null;
};

export type TurnStartSnapshot = {
  readonly worldId: string | null;
  readonly schemaHash: string | null;
  readonly focus: {
    readonly nodeId: string | null;
    readonly kind: string | null;
  };
  readonly viewMode: string;
  readonly data: unknown;
  readonly computed: unknown;
};

export type StudioAgentContext = {
  readonly studioMelDigest: string | null;
  readonly recentTurns: readonly RecentTurn[];
  readonly runtimeSignals: RuntimeSignals;
  readonly turnStartSnapshot: TurnStartSnapshot | null;
};

export type ReadStudioAgentContextInput = {
  readonly studioMelDigest?: string | null;
  readonly recentTurns?: readonly RecentTurn[];
  readonly runtimeSignals?: Partial<RuntimeSignals>;
  readonly turnStartSnapshot?: TurnStartSnapshot | null;
};

export function readStudioAgentContext(
  input: ReadStudioAgentContextInput,
): StudioAgentContext {
  return {
    studioMelDigest:
      typeof input.studioMelDigest === "string" &&
      input.studioMelDigest.trim() !== ""
        ? input.studioMelDigest.trim()
        : null,
    recentTurns: input.recentTurns ?? [],
    runtimeSignals: {
      selectedNodeChanged: input.runtimeSignals?.selectedNodeChanged === true,
      currentFocusedNodeId:
        typeof input.runtimeSignals?.currentFocusedNodeId === "string"
          ? input.runtimeSignals.currentFocusedNodeId
          : null,
      currentFocusedNodeKind:
        typeof input.runtimeSignals?.currentFocusedNodeKind === "string"
          ? input.runtimeSignals.currentFocusedNodeKind
          : null,
    },
    turnStartSnapshot: input.turnStartSnapshot ?? null,
  };
}

export function buildAgentSystemPrompt(ctx: StudioAgentContext): string {
  const lines = [
    "You are Manifest Studio Agent.",
    "The Fine MEL projection below is your source of truth. Treat it as identity and runtime contract, not live state.",
    "Use admitted tools for live focus, state, availability, legality, lineage, and conversation history.",
    "",
    "# How To Read Fine MEL",
    "- `action admitX()` describes the Manifesto guard for host tool `x`; use the host tool name exposed to you, not the admit action name.",
    "- `grounding` explains what a declaration means; `invariant` explains what must hold; `stale_when` explains when prior observations expire; `recovery` explains what to inspect next.",
    "- Domain actions are inputs to `dispatch`, not tool names. If a tool is missing or blocked, inspect tool affordances before retrying.",
    "",
    "# Manifesto Routing",
    "- User asks why a domain action is blocked, unavailable, disabled, illegal, or not working: inspectFocus if needed, then call `explainLegality` for that action.",
    "- User asks what actions are possible now: call `inspectAvailability`.",
    "- User asks to run or make a domain action happen: call `dispatch` with the domain action name and args.",
    "- Use `inspectToolAffordances` for agent-tool catalog failures only; it is not the legality explainer for user-domain actions.",
  ];

  if (ctx.studioMelDigest !== null) {
    lines.push("", "# Fine MEL", "```text", ctx.studioMelDigest, "```");
  }

  if (ctx.runtimeSignals.selectedNodeChanged) {
    lines.push(
      "",
      "# Runtime Signals",
      "- selected_node_changed: true",
      "- prior focus-dependent observations are stale; inspectFocus before using the current selection.",
    );
  }

  if (ctx.turnStartSnapshot !== null) {
    lines.push(
      "",
      "# Turn Start Snapshot",
      "Captured before the first model step of this user turn. Treat it as stale after any mutating tool result.",
      "```json",
      JSON.stringify(ctx.turnStartSnapshot, null, 2),
      "```",
    );
  }

  if (ctx.recentTurns.length > 0) {
    // Continuity hint only — keep the immediately-prior turn (or two)
    // for cheap deictic resolution ("그거", "2번 방향", "above"). For
    // anything older than this, the agent should call
    // `inspectConversation` with a query / cursor. This keeps the
    // prompt bounded as the session grows and forces the agent to
    // *retrieve* rather than rely on a passively-stuffed transcript.
    lines.push("", "# Conversation continuity");
    lines.push(
      "Most recent settled turn (for deictic context — older context via `inspectConversation`):",
    );
    ctx.recentTurns.forEach((turn) => {
      lines.push(
        `- id=${turn.turnId} (tools=${turn.toolCount})`,
        `  user: ${turn.userPrompt}`,
        `  you: ${turn.assistantExcerpt.trim() === "" ? "(tool-only turn)" : turn.assistantExcerpt}`,
      );
    });
    lines.push(
      "",
      "To read older turns or search by keyword, call `inspectConversation`:",
      "- `inspectConversation()` — most recent N",
      "- `inspectConversation({ query: '...' })` — keyword filter",
      "- `inspectConversation({ beforeTurnId: '...' })` — page older",
    );
  }

  return lines.join("\n");
}
