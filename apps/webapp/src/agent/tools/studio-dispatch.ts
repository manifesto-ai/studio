/**
 * `studioDispatch` — write tool for the Studio UI runtime (studio.mel).
 *
 * Pair with `dispatch` (user domain) — same shape, different runtime.
 * Kept as a separate tool rather than a `runtime: "user" | "studio"`
 * parameter on a single tool because description semantics matter for
 * small models: the LLM sees
 *
 *   - dispatch        → "change the user's domain state"
 *   - studioDispatch  → "change Studio UI state (focus, lens, …)"
 *
 * so it can route intent on a single tool-description scan instead of
 * having to understand an enum arg. The runtime's legality gates
 * (`enterSimulation` only from live, etc.) are the final vetoer.
 *
 * React-free; import discipline enforced by the boundary test.
 */
import type { AgentTool, ToolRunResult } from "./types.js";
import type { DispatchResultLike } from "./dispatch.js";

export type StudioDispatchContext = {
  readonly createIntent: (action: string, ...args: unknown[]) => unknown;
  readonly dispatchAsync: (intent: unknown) => Promise<DispatchResultLike>;
  readonly isActionAvailable: (name: string) => boolean;
  readonly listActionNames?: () => readonly string[];
};

export type StudioDispatchInput = {
  readonly action: string;
  readonly args?: readonly unknown[];
};

export type StudioDispatchOutput = {
  readonly action: string;
  readonly status: "completed" | "rejected" | "failed" | "unavailable";
  readonly changedPaths: readonly string[];
  readonly summary: string;
  readonly error?: string;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      description:
        "Studio UI action name as declared in studio.mel (focusNode, clearFocus, openLens, enterSimulation, exitSimulation, scrubTo, resetScrub, switchProject).",
    },
    args: {
      type: "array",
      description:
        "Positional args matching the studio.mel action signature. Example: focusNode(id, kind, origin) → args=[\"action:toggleTodo\", \"action\", \"agent\"].",
      items: {},
    },
  },
};

export function createStudioDispatchTool(): AgentTool<
  StudioDispatchInput,
  StudioDispatchOutput,
  StudioDispatchContext
> {
  return {
    name: "studioDispatch",
    description:
      "Change Studio UI state (focus a node, open a lens, enter/exit simulation, scrub to a past edit). Runs against the studio.mel runtime, not the user's domain. The runtime enforces mutual-exclusion gates on viewMode; blocked transitions return `unavailable` / `rejected` without mutating state.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runStudioDispatch(input, ctx),
  };
}

export async function runStudioDispatch(
  input: StudioDispatchInput,
  ctx: StudioDispatchContext,
): Promise<ToolRunResult<StudioDispatchOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.action !== "string" ||
    input.action === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`studioDispatch` requires { action: string, args?: unknown[] }.",
    };
  }
  const action = input.action;
  const args = Array.isArray(input.args) ? input.args : [];

  const known = ctx.listActionNames?.();
  if (known !== undefined && !known.includes(action)) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `Unknown studio action "${action}". Known: ${known.length === 0 ? "(none)" : known.join(", ")}.`,
    };
  }

  if (!safeBool(() => ctx.isActionAvailable(action))) {
    return {
      ok: true,
      output: {
        action,
        status: "unavailable",
        changedPaths: [],
        summary: `Studio action "${action}" is not available right now (check viewMode gate).`,
      },
    };
  }

  let intent: unknown;
  try {
    intent = ctx.createIntent(action, ...args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "invalid_input",
      message: `createIntent("${action}", …) failed: ${message}`,
    };
  }

  let result: DispatchResultLike;
  try {
    result = await ctx.dispatchAsync(intent);
  } catch (err) {
    return {
      ok: true,
      output: {
        action,
        status: "failed",
        changedPaths: [],
        summary: `studioDispatch threw: ${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const status = normaliseStatus(result.kind);
  const changedPaths = result.outcome?.projected?.changedPaths ?? [];

  if (status === "completed") {
    return {
      ok: true,
      output: {
        action,
        status,
        changedPaths,
        summary:
          changedPaths.length === 0
            ? `Studio action ${action} dispatched (no UI fields changed).`
            : `Studio action ${action} dispatched. Changed: ${changedPaths.join(", ")}.`,
      },
    };
  }

  const reason =
    result.rejection?.reason ?? result.error?.message ?? "unknown reason";
  return {
    ok: true,
    output: {
      action,
      status,
      changedPaths,
      summary: `Studio action ${action} ${status}: ${reason}`,
      error: reason,
    },
  };
}

function safeBool(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

function normaliseStatus(raw: string | undefined): StudioDispatchOutput["status"] {
  if (raw === "completed") return "completed";
  if (raw === "rejected") return "rejected";
  if (raw === "failed") return "failed";
  return "failed";
}
