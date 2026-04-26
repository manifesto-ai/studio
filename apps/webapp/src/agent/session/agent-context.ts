/**
 * Studio agent context.
 *
 * The system prompt carries identity, the current admitted tool catalog
 * contract, a compact domain summary, and a short recent-turn tail.
 * It deliberately does not carry full MEL source or dynamic runtime
 * state. The agent must inspect live focus, snapshot, availability,
 * graph neighbors, and legality through tools at decision time.
 */
import type { DomainModule, Marker } from "@manifesto-ai/studio-core";
import { summarizeActionInput } from "./action-input-summary.js";

export type AgentContextCore = {
  readonly getModule: () => DomainModule | null;
  readonly getDiagnostics: () => readonly Marker[];
};

export type RecentTurn = {
  readonly turnId: string;
  readonly userPrompt: string;
  readonly assistantExcerpt: string;
  readonly toolCount: number;
};

export type DomainActionSummary = {
  readonly name: string;
  readonly params: readonly string[];
  readonly paramHints: readonly string[];
  readonly inputHint: string | null;
  readonly hasDispatchableGate: boolean;
  readonly description: string | null;
};

export type DomainSummary = {
  readonly schemaId: string | null;
  readonly schemaHash: string | null;
  readonly source: {
    readonly present: boolean;
    readonly lineCount: number;
    readonly charCount: number;
  };
  readonly stateFields: readonly string[];
  readonly computedFields: readonly string[];
  readonly actions: readonly DomainActionSummary[];
  readonly graph: {
    readonly nodeCount: number;
    readonly edgeCount: number;
  };
};

export type StudioAgentContext = {
  readonly hasModule: boolean;
  readonly domainSummary: DomainSummary;
  readonly diagnostics: {
    readonly errors: number;
    readonly warnings: number;
  };
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
    domainSummary: buildDomainSummary(mod, melSource),
    diagnostics: countDiagnostics(userCore.getDiagnostics()),
    recentTurns,
  };
}

export function buildAgentSystemPrompt(ctx: StudioAgentContext): string {
  const lines: string[] = [
    "You are operating a Manifesto runtime through a compact schema summary plus live tools. Treat the summary as identity, not state. Everything dynamic (focus, snapshot, availability, graph neighbors, legality) must be inspected through tools; never guess.",
    "",
    "# Tools",
    "- inspectToolAffordances({toolName?, includeUnavailable?}) — live catalog of tools admitted by studio.mel; use this after any unavailable/unknown tool or when choosing a path.",
    "Inspect:",
    "- inspectFocus() — current focused node and Studio UI context.",
    "- inspectSnapshot() — current state data and computed values.",
    "- inspectAvailability() — live domain action availability.",
    "- inspectNeighbors({nodeId}) — graph edges touching a state/computed/action node.",
    "- explainLegality({action, args}) — why a specific domain action is blocked.",
    "- simulateIntent({action, args}) — deterministic dry-run preview without dispatching.",
    "Act:",
    "- dispatch({action, args}) — user-domain writes. Runtime legality still decides whether the requested action can run.",
    "- studioDispatch({action, args}) — Studio UI writes such as focus, lens, simulation, and scrub.",
    "- endTurn({summary?}) — terminal signal after your visible assistant text.",
    "",
    "# Grounding Rules",
    "- Deictic references ('this', 'that', 'it', '이것', '이거', '이건', '그거') → inspectFocus() first.",
    "- State, count, value, or computed questions → inspectSnapshot().",
    "- Relation and dependency questions → inspectNeighbors({nodeId}).",
    "- Blocked actions → explainLegality({action, args}).",
    "- Unknown or unavailable tools → inspectToolAffordances({toolName}).",
    "- Enum/literal params must use the exact listed value, e.g. use `med`, not a translated label like `보통`.",
    "- Domain actions are not tool names. If you need to run an action like `addTodo`, call `dispatch({action: \"addTodo\", args: [...]})`.",
    "- You do not have source-authoring tools in this runtime. If the user asks for a MEL edit, explain that the current admitted tool catalog cannot edit source instead of inventing a tool.",
  ];

  if (ctx.hasModule) {
    appendDomainSummary(lines, ctx.domainSummary);
  } else {
    lines.push(
      "",
      `# Domain Summary`,
      `compiled: false`,
      `diagnostics: ${ctx.diagnostics.errors} errors, ${ctx.diagnostics.warnings} warnings`,
      `source: ${formatSourceSummary(ctx.domainSummary.source)}`,
    );
  }

  if (ctx.recentTurns.length > 0) {
    lines.push(
      "",
      `# Recent Conversation (${ctx.recentTurns.length} most recent turn${ctx.recentTurns.length === 1 ? "" : "s"}, newest first)`,
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

function appendDomainSummary(lines: string[], summary: DomainSummary): void {
  lines.push(
    "",
    "# Domain Summary",
    `compiled: true`,
    `schema: ${summary.schemaId ?? "(unknown)"}${summary.schemaHash === null ? "" : ` @ ${summary.schemaHash}`}`,
    `source: ${formatSourceSummary(summary.source)}`,
    `graph: ${summary.graph.nodeCount} nodes, ${summary.graph.edgeCount} edges`,
    `state: ${formatNameList(summary.stateFields)}`,
    `computed: ${formatNameList(summary.computedFields)}`,
    `actions: ${formatActionList(summary.actions)}`,
  );
}

function buildDomainSummary(
  module: DomainModule | null,
  melSource: string,
): DomainSummary {
  const source = summarizeSource(melSource);
  if (module === null) {
    return {
      schemaId: null,
      schemaHash: null,
      source,
      stateFields: [],
      computedFields: [],
      actions: [],
      graph: { nodeCount: 0, edgeCount: 0 },
    };
  }
  const schema = asRecord(module.schema);
  const state = asRecord(schema?.state);
  const computed = asRecord(schema?.computed);
  const actions = asRecord(schema?.actions);
  return {
    schemaId: typeof schema?.id === "string" ? schema.id : null,
    schemaHash: typeof schema?.hash === "string" ? schema.hash : null,
    source,
    stateFields: Object.keys(asRecord(state?.fields) ?? {}).sort(),
    computedFields: Object.keys(asRecord(computed?.fields) ?? {}).sort(),
    actions: Object.entries(actions ?? {})
      .map(([name, value]) => summarizeAction(name, value, schema))
      .sort((a, b) => a.name.localeCompare(b.name)),
    graph: {
      nodeCount: module.graph?.nodes?.length ?? 0,
      edgeCount: module.graph?.edges?.length ?? 0,
    },
  };
}

function summarizeAction(
  name: string,
  value: unknown,
  schema: unknown,
): DomainActionSummary {
  const spec = asRecord(value);
  const input = summarizeActionInput(value, schema);
  return {
    name,
    params: Array.isArray(spec?.params)
      ? spec.params.filter((param): param is string => typeof param === "string")
      : [],
    paramHints: input.paramHints,
    inputHint: input.inputHint,
    hasDispatchableGate: spec?.dispatchable !== undefined,
    description:
      typeof spec?.description === "string" && spec.description.trim() !== ""
        ? spec.description.trim()
        : null,
  };
}

function summarizeSource(source: string): DomainSummary["source"] {
  const trimmed = source.trim();
  return {
    present: trimmed !== "",
    lineCount: trimmed === "" ? 0 : source.split(/\r?\n/).length,
    charCount: source.length,
  };
}

function formatSourceSummary(source: DomainSummary["source"]): string {
  return source.present
    ? `${source.lineCount} lines, ${source.charCount} chars`
    : "empty";
}

function formatNameList(values: readonly string[], limit = 40): string {
  if (values.length === 0) return "(none)";
  const shown = values.slice(0, limit);
  const suffix = values.length > shown.length ? `, +${values.length - shown.length} more` : "";
  return `${shown.join(", ")}${suffix}`;
}

function formatActionList(actions: readonly DomainActionSummary[]): string {
  if (actions.length === 0) return "(none)";
  const shown = actions.slice(0, 40).map((action) => {
    const params =
      action.paramHints.length === 0 ? "" : `(${action.paramHints.join(", ")})`;
    const gate = action.hasDispatchableGate ? " [guarded]" : "";
    const description =
      action.description === null ? "" : ` — ${truncate(action.description, 72)}`;
    return `${action.name}${params}${gate}${description}`;
  });
  const suffix =
    actions.length > shown.length ? `, +${actions.length - shown.length} more` : "";
  return `${shown.join("; ")}${suffix}`;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
