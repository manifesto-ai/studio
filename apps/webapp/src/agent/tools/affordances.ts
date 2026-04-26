/**
 * Manifesto-native tool admission.
 *
 * Tool implementations live in TS, but availability lives in studio.mel.
 * Each implementation is paired with `requestTool(toolName)`.
 * The host exposes schemas only for tools whose admission action is
 * currently available, and every actual tool call dispatches admission
 * before running the implementation.
 */
import {
  type AgentTool,
  createToolRegistry,
  type BoundAgentTool,
  type ToolRegistry,
  type ToolRunResult,
} from "./types.js";

export type ToolImplementation = {
  readonly tool: BoundAgentTool;
  readonly admissionAction: string;
  readonly admissionArgs?: readonly unknown[];
  readonly buildAdmissionArgs?: (input: unknown) => readonly unknown[];
};

export type ToolAdmissionRuntime = {
  readonly isActionAvailable: (actionName: string) => boolean;
  readonly createIntent: (actionName: string, ...args: unknown[]) => unknown;
  readonly dispatchAsync: (intent: unknown) => Promise<DispatchResultLike>;
  readonly explainIntent?: (intent: unknown) => IntentExplanationLike;
  readonly whyNot?: (intent: unknown) => readonly AdmissionBlockerLike[] | null;
};

export type DispatchResultLike = {
  readonly kind?: string;
  readonly rejection?: {
    readonly code?: string;
    readonly reason?: string;
  };
  readonly error?: { readonly message?: string };
};

export type IntentExplanationLike =
  | {
      readonly kind: "blocked";
      readonly blockers?: readonly AdmissionBlockerLike[];
    }
  | { readonly kind: "admitted" };

export type AdmissionBlockerLike = {
  readonly layer?: string;
  readonly description?: string;
  readonly evaluatedResult?: unknown;
};

export type ToolAdmissionDecision = {
  readonly available: boolean;
  readonly reason: string | null;
};

export type ToolCatalogEntry = {
  readonly name: string;
  readonly admissionAction: string;
  readonly available: boolean;
  readonly reason: string | null;
  readonly description?: string;
};

export type ToolAffordanceReport = {
  readonly requestedTool: string | null;
  readonly requestedToolAvailable: boolean | null;
  readonly requestedToolReason: string | null;
  readonly domainActionHint: DomainActionToolHint | null;
  readonly availableTools: readonly string[];
  readonly unavailableTools: readonly ToolCatalogEntry[];
  readonly recoveryTools: readonly string[];
  readonly unavailableToolCount: number;
  readonly summary: string;
};

export type DomainActionToolHint = {
  readonly action: string;
  readonly dispatchToolAvailable: boolean;
  readonly recommendedToolCall: {
    readonly tool: "dispatch";
    readonly input: {
      readonly action: string;
      readonly args: readonly unknown[];
    };
  };
  readonly message: string;
};

export type InspectToolAffordancesInput = {
  readonly toolName?: string;
  readonly includeUnavailable?: boolean;
  readonly includeDescriptions?: boolean;
  readonly limit?: number;
};

export type InspectToolAffordancesContext = {
  readonly getTools: () => readonly ToolImplementation[];
  readonly getRuntime: () => ToolAdmissionRuntime | null;
  readonly getDomainActionNames?: () => readonly string[];
};

export type ToolAffordanceOptions = {
  readonly domainActionNames?: readonly string[];
};

export function createAdmittedToolRegistry(
  tools: readonly ToolImplementation[],
  runtime: ToolAdmissionRuntime | null,
): ToolRegistry {
  if (runtime === null) return createToolRegistry([]);
  return createToolRegistry(filterAdmittedTools(tools, runtime));
}

export function filterAdmittedTools(
  tools: readonly ToolImplementation[],
  runtime: ToolAdmissionRuntime,
): readonly BoundAgentTool[] {
  return tools
    .filter((entry) => isAdmissionAvailable(entry, runtime))
    .map(({ tool }) => tool);
}

export function isAdmissionAvailable(
  entry: ToolImplementation,
  runtime: ToolAdmissionRuntime,
): boolean {
  return explainAdmissionAvailability(entry, runtime).available;
}

export function explainAdmissionAvailability(
  entry: ToolImplementation,
  runtime: ToolAdmissionRuntime | null,
  input?: unknown,
): ToolAdmissionDecision {
  if (runtime === null) {
    return unavailable("Studio UI runtime is not ready");
  }
  if (!safeAvailable(runtime, entry.admissionAction)) {
    return unavailable(readAdmissionReason(entry, runtime, input));
  }
  const reason = readBoundAdmissionBlocker(entry, runtime, input);
  return reason === null ? { available: true, reason: null } : unavailable(reason);
}

export async function admitToolCall(
  entry: ToolImplementation,
  runtime: ToolAdmissionRuntime | null,
  input: unknown,
): Promise<ToolRunResult<{ readonly admitted: true }>> {
  if (runtime === null) {
    return {
      ok: false,
      kind: "runtime_error",
      message: "Studio UI runtime is not ready.",
    };
  }
  const args = readAdmissionArgs(entry, input);
  let intent: unknown;
  try {
    intent = runtime.createIntent(entry.admissionAction, ...args);
  } catch (err) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `tool "${entry.tool.name}" admission failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const result = await runtime.dispatchAsync(intent);
  if (result.kind === "completed") {
    return { ok: true, output: { admitted: true } };
  }

  const reason =
    result.rejection?.reason ??
    result.error?.message ??
    readAdmissionReason(entry, runtime, input);
  return {
    ok: false,
    kind: "runtime_error",
    message: `tool "${entry.tool.name}" is not admitted by Manifesto runtime: ${reason}`,
    detail: {
      toolName: entry.tool.name,
      admissionAction: entry.admissionAction,
      reason,
    },
  };
}

export function rejectUnavailableTool(
  tools: readonly ToolImplementation[],
  toolName: string,
  runtime: ToolAdmissionRuntime | null,
  options: ToolAffordanceOptions = {},
): ToolRunResult<never> {
  const report = buildToolAffordanceReport(
    tools,
    runtime,
    {
      toolName,
      includeUnavailable: false,
      includeDescriptions: false,
    },
    options,
  );
  return {
    ok: false,
    kind: "runtime_error",
    message: report.summary,
    detail: report,
  };
}

export function createInspectToolAffordancesTool(): AgentTool<
  InspectToolAffordancesInput,
  ToolAffordanceReport,
  InspectToolAffordancesContext
> {
  return {
    name: "inspectToolAffordances",
    description:
      "Inspect the live Manifesto tool catalog. Returns which tools are currently admitted by studio.mel, why a requested tool is blocked or unknown, and which available tools can recover the task.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        toolName: {
          type: "string",
          description:
            "Optional tool name to explain, especially after a rejected or unknown tool call.",
        },
        includeUnavailable: {
          type: "boolean",
          description:
            "When true, include blocked tools and their Manifesto admission reasons.",
        },
        includeDescriptions: {
          type: "boolean",
          description: "When true, include tool descriptions.",
        },
        limit: {
          type: "number",
          description:
            "Maximum blocked tools to include when includeUnavailable is true. Defaults to 12.",
        },
      },
    },
    run: async (input, ctx) => ({
      ok: true,
      output: buildToolAffordanceReport(
        ctx.getTools(),
        ctx.getRuntime(),
        input,
        { domainActionNames: ctx.getDomainActionNames?.() ?? [] },
      ),
    }),
  };
}

export function buildToolAffordanceReport(
  tools: readonly ToolImplementation[],
  runtime: ToolAdmissionRuntime | null,
  input: InspectToolAffordancesInput = {},
  options: ToolAffordanceOptions = {},
): ToolAffordanceReport {
  const requestedTool =
    typeof input.toolName === "string" && input.toolName.trim() !== ""
      ? input.toolName.trim()
      : null;
  const includeUnavailable = input.includeUnavailable === true;
  const includeDescriptions = input.includeDescriptions === true;
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(0, Math.min(50, Math.trunc(input.limit)))
      : 12;
  const entries = tools.map((entry) => {
    const decision = explainAdmissionAvailability(entry, runtime);
    return {
      name: entry.tool.name,
      admissionAction: entry.admissionAction,
      available: decision.available,
      reason: decision.reason,
      ...(includeDescriptions ? { description: entry.tool.description } : {}),
    } satisfies ToolCatalogEntry;
  });
  const availableTools = entries
    .filter((entry) => entry.available)
    .map((entry) => entry.name);
  const unavailableEntries = entries.filter((entry) => !entry.available);
  const requestedEntry =
    requestedTool === null
      ? undefined
      : entries.find((entry) => entry.name === requestedTool);
  const domainActionHint = buildDomainActionHint(
    requestedTool,
    options.domainActionNames ?? [],
    availableTools,
  );
  const legacyReason =
    requestedEntry === undefined && requestedTool !== null
      ? domainActionHint?.message ?? readUnregisteredToolReason(requestedTool)
      : null;
  const requestedToolAvailable =
    requestedTool === null ? null : requestedEntry?.available ?? false;
  const requestedToolReason =
    requestedTool === null
      ? null
      : requestedEntry?.reason ??
        legacyReason ??
        "tool is not registered in the current Manifesto runtime";
  const unavailableTools =
    includeUnavailable || requestedEntry?.available === false
      ? unavailableEntries.slice(0, limit)
      : [];
  return {
    requestedTool,
    requestedToolAvailable,
    requestedToolReason,
    domainActionHint,
    availableTools,
    unavailableTools,
    recoveryTools: chooseRecoveryTools(
      availableTools,
      requestedTool,
      domainActionHint,
    ),
    unavailableToolCount: unavailableEntries.length,
    summary: buildToolAffordanceSummary({
      requestedTool,
      requestedToolAvailable,
      requestedToolReason,
      availableTools,
      unavailableCount: unavailableEntries.length,
    }),
  };
}

function readAdmissionReason(
  entry: ToolImplementation,
  runtime: ToolAdmissionRuntime,
  input: unknown,
): string {
  const reason = readBoundAdmissionBlocker(entry, runtime, input);
  if (reason !== null) return reason;
  return `admission action "${formatAdmissionCall(entry)}" is not available`;
}

function readBoundAdmissionBlocker(
  entry: ToolImplementation,
  runtime: ToolAdmissionRuntime,
  input: unknown,
): string | null {
  const args = readAdmissionArgs(entry, input);
  try {
    const intent = runtime.createIntent(entry.admissionAction, ...args);
    const blockers = runtime.whyNot?.(intent) ?? [];
    if (blockers.length > 0) {
      return blockers.map(formatBlocker).join("; ");
    }
    const explanation = runtime.explainIntent?.(intent);
    if (explanation?.kind === "blocked") {
      const listed = explanation.blockers ?? [];
      return listed.length > 0
        ? listed.map(formatBlocker).join("; ")
        : `admission action "${formatAdmissionCall(entry)}" is blocked`;
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

function formatBlocker(blocker: AdmissionBlockerLike): string {
  const layer = blocker.layer ?? "admission";
  if (blocker.description !== undefined && blocker.description !== "") {
    return `${layer} guard blocked: ${blocker.description}`;
  }
  if (blocker.evaluatedResult !== undefined) {
    return `${layer} guard evaluated to ${JSON.stringify(blocker.evaluatedResult)}`;
  }
  return `${layer} guard blocked`;
}

function readAdmissionArgs(
  entry: ToolImplementation,
  input: unknown,
): readonly unknown[] {
  return entry.buildAdmissionArgs?.(input) ?? entry.admissionArgs ?? [];
}

function safeAvailable(
  runtime: ToolAdmissionRuntime,
  actionName: string,
): boolean {
  try {
    return runtime.isActionAvailable(actionName);
  } catch {
    return false;
  }
}

function formatAdmissionCall(entry: ToolImplementation): string {
  const args = entry.admissionArgs ?? [];
  if (args.length === 0) return entry.admissionAction;
  return `${entry.admissionAction}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
}

function chooseRecoveryTools(
  availableTools: readonly string[],
  requestedTool: string | null,
  domainActionHint: DomainActionToolHint | null,
): readonly string[] {
  const preferred =
    domainActionHint !== null
      ? [
          "dispatch",
          "simulateIntent",
          "inspectAvailability",
          "explainLegality",
          "inspectSnapshot",
          "endTurn",
        ]
      : requestedTool === "dispatch"
        ? [
            "inspectAvailability",
            "inspectFocus",
            "studioDispatch",
            "explainLegality",
            "simulateIntent",
          ]
        : [
            "inspectToolAffordances",
            "inspectAvailability",
            "inspectFocus",
            "inspectSnapshot",
            "simulateIntent",
            "dispatch",
            "studioDispatch",
            "endTurn",
          ];
  return preferred.filter((name) => availableTools.includes(name)).slice(0, 5);
}

function buildDomainActionHint(
  requestedTool: string | null,
  domainActionNames: readonly string[],
  availableTools: readonly string[],
): DomainActionToolHint | null {
  if (requestedTool === null) return null;
  const action = findDomainActionName(requestedTool, domainActionNames);
  if (action === null) return null;
  const dispatchToolAvailable = availableTools.includes("dispatch");
  const message =
    `"${action}" is a domain action, not an agent tool. ` +
    `Call dispatch({ action: "${action}", args: [...] }) instead; args must match that action's declared params.`;
  return {
    action,
    dispatchToolAvailable,
    recommendedToolCall: {
      tool: "dispatch",
      input: { action, args: [] },
    },
    message,
  };
}

function findDomainActionName(
  toolName: string,
  domainActionNames: readonly string[],
): string | null {
  const normalized = toolName.trim().startsWith("action:")
    ? toolName.trim().slice("action:".length)
    : toolName.trim();
  return domainActionNames.find((name) => name === normalized) ?? null;
}

function buildToolAffordanceSummary({
  requestedTool,
  requestedToolAvailable,
  requestedToolReason,
  availableTools,
  unavailableCount,
}: {
  readonly requestedTool: string | null;
  readonly requestedToolAvailable: boolean | null;
  readonly requestedToolReason: string | null;
  readonly availableTools: readonly string[];
  readonly unavailableCount: number;
}): string {
  const available =
    availableTools.length === 0 ? "(none)" : availableTools.join(", ");
  if (requestedTool !== null) {
    if (requestedToolAvailable === true) {
      return `"${requestedTool}" is admitted by studio.mel. Available tools: ${available}.`;
    }
    return `"${requestedTool}" is unavailable: ${
      requestedToolReason ?? "unknown reason"
    }. Available tools: ${available}.`;
  }
  return `${availableTools.length} tool(s) admitted by studio.mel, ${unavailableCount} blocked. Available tools: ${available}.`;
}

function readUnregisteredToolReason(toolName: string): string | null {
  switch (toolName) {
    case "seedMock":
    case "generateMock":
      return "mock-data generation was removed from the current AgentLens runtime; inspect available domain actions and use dispatch with explicit action arguments instead";
    case "createProposal":
    case "readDeclaration":
    case "findInSource":
    case "inspectSourceOutline":
      return "source-authoring tools are not registered in the current AgentLens runtime";
    case "answerAndTurnEnd":
      return "answerAndTurnEnd was replaced by assistant text plus endTurn";
    default:
      return null;
  }
}

function unavailable(reason: string): ToolAdmissionDecision {
  return { available: false, reason };
}
