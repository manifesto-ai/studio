import type { AgentTool, ToolRunResult } from "./types.js";

export type SimulateIntentContext = {
  readonly createIntent: (action: string, ...args: unknown[]) => unknown;
  readonly explainIntent: (intent: unknown) => IntentExplanationLike;
  readonly simulate: (intent: unknown) => SimulateResultLike;
  readonly listActionNames?: () => readonly string[];
};

export type IntentExplanationLike =
  | {
      readonly kind: "blocked";
      readonly actionName?: string;
      readonly available: boolean;
      readonly dispatchable: false;
      readonly blockers?: readonly BlockerLike[];
    }
  | {
      readonly kind: "admitted";
      readonly actionName?: string;
      readonly available: true;
      readonly dispatchable: true;
      readonly changedPaths?: readonly string[];
      readonly newAvailableActions?: readonly unknown[];
      readonly requirements?: readonly unknown[];
      readonly status?: unknown;
    };

export type BlockerLike = {
  readonly layer?: string;
  readonly description?: string;
  readonly expression?: unknown;
  readonly evaluatedResult?: unknown;
};

export type SimulateResultLike = {
  readonly changedPaths?: readonly string[];
  readonly newAvailableActions?: readonly unknown[];
  readonly requirements?: readonly unknown[];
  readonly status?: unknown;
  readonly meta?: { readonly schemaHash?: string };
};

export type SimulateIntentInput = {
  readonly action: string;
  readonly args?: readonly unknown[];
};

export type SimulateIntentOutput = {
  readonly action: string;
  readonly status: "blocked" | "simulated";
  readonly available: boolean;
  readonly dispatchable: boolean;
  readonly changedPaths: readonly string[];
  readonly newAvailableActions: readonly string[];
  readonly requirementCount: number;
  readonly requirements: readonly SimulateRequirementSummary[];
  readonly schemaHash: string | null;
  readonly blockers: readonly SimulateBlockerSummary[];
  readonly summary: string;
};

export type SimulateRequirementSummary = {
  readonly id?: string;
  readonly type?: string;
};

export type SimulateBlockerSummary = {
  readonly layer: string;
  readonly description?: string;
  readonly evaluatedResult?: unknown;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      description: "Action name exactly as declared in the MEL module.",
    },
    args: {
      type: "array",
      description:
        "Positional action arguments matching the MEL action parameter order.",
      items: {},
    },
  },
};

const REQUIREMENT_CAP = 8;

export function createSimulateIntentTool(): AgentTool<
  SimulateIntentInput,
  SimulateIntentOutput,
  SimulateIntentContext
> {
  return {
    name: "simulateIntent",
    description:
      "Preview a Manifesto action without dispatching it. Returns projected changed paths, newly available actions, host requirement count, and blocker summaries. Use before recommending a write or explaining the impact of a possible action.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runSimulateIntent(input, ctx),
  };
}

export async function runSimulateIntent(
  input: SimulateIntentInput,
  ctx: SimulateIntentContext,
): Promise<ToolRunResult<SimulateIntentOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.action !== "string" ||
    input.action.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`simulateIntent` requires { action: string, args?: unknown[] }.",
    };
  }
  const action = input.action.trim();
  const args = Array.isArray(input.args) ? input.args : [];
  const known = ctx.listActionNames?.();
  if (known !== undefined && !known.includes(action)) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `Unknown action "${action}". Known: ${known.length === 0 ? "(none)" : known.join(", ")}.`,
    };
  }

  let intent: unknown;
  try {
    intent = ctx.createIntent(action, ...args);
  } catch (err) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `createIntent("${action}", ...) failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let explanation: IntentExplanationLike;
  try {
    explanation = ctx.explainIntent(intent);
  } catch (err) {
    return {
      ok: false,
      kind: "runtime_error",
      message: `explainIntent failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (explanation.kind === "blocked") {
    const blockers = (explanation.blockers ?? []).map(summarizeBlocker);
    return {
      ok: true,
      output: {
        action,
        status: "blocked",
        available: explanation.available,
        dispatchable: false,
        changedPaths: [],
        newAvailableActions: [],
        requirementCount: 0,
        requirements: [],
        schemaHash: null,
        blockers,
        summary:
          blockers.length === 0
            ? `${action} is blocked; no simulation was run.`
            : `${action} is blocked by ${blockers.map((b) => b.layer).join(", ")} guard(s); no simulation was run.`,
      },
    };
  }

  let simulated: SimulateResultLike;
  try {
    simulated = ctx.simulate(intent);
  } catch (err) {
    return {
      ok: false,
      kind: "runtime_error",
      message: `simulate failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const changedPaths = simulated.changedPaths ?? explanation.changedPaths ?? [];
  const requirements = simulated.requirements ?? explanation.requirements ?? [];
  const newAvailableActions =
    simulated.newAvailableActions ?? explanation.newAvailableActions ?? [];
  return {
    ok: true,
    output: {
      action,
      status: "simulated",
      available: true,
      dispatchable: true,
      changedPaths,
      newAvailableActions: newAvailableActions.map(String),
      requirementCount: requirements.length,
      requirements: requirements.slice(0, REQUIREMENT_CAP).map(summarizeRequirement),
      schemaHash: simulated.meta?.schemaHash ?? null,
      blockers: [],
      summary:
        changedPaths.length === 0
          ? `${action} simulated without projected snapshot changes.`
          : `${action} simulated. Changed paths: ${changedPaths.join(", ")}.`,
    },
  };
}

function summarizeBlocker(blocker: BlockerLike): SimulateBlockerSummary {
  return {
    layer: typeof blocker.layer === "string" ? blocker.layer : "unknown",
    description: blocker.description,
    evaluatedResult: normalizeJsonValue(blocker.evaluatedResult),
  };
}

function summarizeRequirement(req: unknown): SimulateRequirementSummary {
  if (req === null || typeof req !== "object") return {};
  const record = req as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    type: typeof record.type === "string" ? record.type : undefined,
  };
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
