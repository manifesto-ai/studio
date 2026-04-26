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
    lines.push("", "# Recent Conversation");
    ctx.recentTurns.forEach((turn, index) => {
      lines.push(
        `turn ${index + 1} (newest-first id=${turn.turnId}, tools=${turn.toolCount})`,
        `user: ${turn.userPrompt}`,
        `you: ${turn.assistantExcerpt.trim() === "" ? "(tool-only turn)" : turn.assistantExcerpt}`,
      );
    });
  }

  return lines.join("\n");
}
