/**
 * `dispatch` — the primary write tool. Equivalent to taskflow's
 * per-action tools (create_task, move_task, …) but deliberately
 * generic: one tool, one argument (`action` + `args`), the runtime
 * owns the rest.
 *
 * Why one tool instead of N per-action tools?
 *   - Taskflow hand-authors tools so each one embeds product UX
 *     ("requires_confirmation", snapshot diff summaries, etc.).
 *   - The Studio is a *meta* tool — it edits other people's MEL
 *     domains. Hand-authoring per-action tools would mean generating
 *     them dynamically per loaded module, which re-introduces a code
 *     path the prompt already covers for free (MEL source + action
 *     list are in the system prompt).
 *   - One `dispatch` tool + one `explainLegality` tool is enough for
 *     Phase α. Phase β can add `simulate`, `focusNode`, etc.
 *
 * The runtime still owns legality: if the model asks to dispatch an
 * unavailable or non-dispatchable action, `dispatchAsync` rejects and
 * the tool returns a structured failure the model can act on.
 */
import type { AgentTool, ToolRunResult } from "./types.js";
import { normalizeActionName } from "./action-name.js";

export type DispatchContext = {
  readonly createIntent: (action: string, ...args: unknown[]) => unknown;
  readonly dispatchAsync: (intent: unknown) => Promise<DispatchResultLike>;
  readonly isActionAvailable: (name: string) => boolean;
  readonly listActionNames?: () => readonly string[];
};

/**
 * Shape matching the SDK's `DispatchReport` closely enough for our
 * read. We tolerate missing fields so a test stub doesn't have to
 * populate the whole union.
 */
export type DispatchResultLike = {
  readonly kind?: string;
  readonly outcome?: {
    readonly projected?: { readonly changedPaths?: readonly string[] };
  };
  readonly rejection?: {
    readonly code?: string;
    readonly reason?: string;
  };
  readonly error?: { readonly message?: string };
};

export type DispatchInput = {
  readonly action: string;
  readonly args?: readonly unknown[];
};

export type DispatchOutput = {
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
        "Action name exactly as it appears in the MEL source. Graph node ids like `action:restoreTask` are also accepted and normalized. Must match a declared action; the runtime rejects unknown names.",
    },
    args: {
      type: "array",
      description:
        "Positional arguments for the action, matching the order of its params. Omit or pass [] for zero-arg actions.",
      items: {},
    },
  },
};

export function createDispatchTool(): AgentTool<
  DispatchInput,
  DispatchOutput,
  DispatchContext
> {
  return {
    name: "dispatch",
    description:
      "Dispatch a Manifesto action against the current snapshot. The runtime enforces availability and dispatchable gates — if the action is blocked the call returns an `unavailable`/`rejected` result with the failing guard. Use for any write the user asks for.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runDispatch(input, ctx),
  };
}

export async function runDispatch(
  input: DispatchInput,
  ctx: DispatchContext,
): Promise<ToolRunResult<DispatchOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.action !== "string" ||
    input.action.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`dispatch` requires { action: string, args?: unknown[] }.",
    };
  }
  const action = normalizeActionName(input.action);
  if (action === "") {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`dispatch` requires a non-empty action name.",
    };
  }
  const args = Array.isArray(input.args) ? input.args : [];

  const known = ctx.listActionNames?.();
  if (known !== undefined && !known.includes(action)) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `Unknown action "${action}". Known: ${known.length === 0 ? "(none)" : known.join(", ")}.`,
    };
  }

  if (!safeBool(() => ctx.isActionAvailable(action))) {
    return {
      ok: true,
      output: {
        action,
        status: "unavailable",
        changedPaths: [],
        summary: `"${action}" is not available on the current snapshot. Use explainLegality to see which guard is blocking it.`,
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
        summary: `dispatch threw: ${err instanceof Error ? err.message : String(err)}`,
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
            ? `${action} dispatched (no state paths changed).`
            : `${action} dispatched. Changed paths: ${changedPaths.join(", ")}.`,
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
      summary: `${action} ${status}: ${reason}`,
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

function normaliseStatus(raw: string | undefined): DispatchOutput["status"] {
  if (raw === "completed") return "completed";
  if (raw === "rejected") return "rejected";
  if (raw === "failed") return "failed";
  return "failed";
}
