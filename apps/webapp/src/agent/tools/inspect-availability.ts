/**
 * `inspectAvailability` — read-only tool returning the list of
 * user-domain actions with their live availability flags. Sugar over
 * `listActionNames` + `isActionAvailable` so the model can answer
 * "what can I do right now?" with a single call.
 *
 * Why a tool, not a prompt block?
 *
 * Availability changes with every snapshot mutation (actions become
 * available/unavailable as guards flip). Baking the list into the
 * prompt means stale info the moment the agent dispatches anything.
 *
 * This does NOT explain *why* something is unavailable — that's
 * `explainLegality`'s job, which returns the failing guard expression
 * and evaluated result. Use `inspectAvailability` for an overview,
 * `explainLegality` to diagnose a specific block.
 */
import type { AgentTool } from "./types.js";

export type InspectAvailabilityContext = {
  readonly listActionNames: () => readonly string[];
  readonly isActionAvailable: (name: string) => boolean;
  /**
   * Optional: per-action param names + description + gate presence.
   * When provided, the output is enriched so the model can route
   * without needing to re-read the MEL for signatures.
   */
  readonly describeAction?: (name: string) => {
    readonly paramNames: readonly string[];
    readonly hasDispatchableGate: boolean;
    readonly description?: string;
  } | null;
};

export type ActionAvailabilityEntry = {
  readonly name: string;
  readonly available: boolean;
  readonly paramNames?: readonly string[];
  readonly hasDispatchableGate?: boolean;
  readonly description?: string;
};

export type InspectAvailabilityOutput = {
  readonly actions: readonly ActionAvailabilityEntry[];
};

export function createInspectAvailabilityTool(): AgentTool<
  Record<string, never>,
  InspectAvailabilityOutput,
  InspectAvailabilityContext
> {
  return {
    name: "inspectAvailability",
    description:
      "Return every user-domain action with its current availability " +
      "flag. Use this for 'what can I do?' / 'which actions work?' " +
      "questions, and before suggesting a next step. For a single " +
      "action's block reason use `explainLegality` instead.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    run: async (_input, ctx) => {
      try {
        const names = ctx.listActionNames();
        const actions: ActionAvailabilityEntry[] = names.map((name) => {
          const base: ActionAvailabilityEntry = {
            name,
            available: safeBool(() => ctx.isActionAvailable(name)),
          };
          if (ctx.describeAction === undefined) return base;
          const desc = ctx.describeAction(name);
          if (desc === null) return base;
          return {
            ...base,
            paramNames: desc.paramNames,
            hasDispatchableGate: desc.hasDispatchableGate,
            description: desc.description,
          };
        });
        return { ok: true, output: { actions } };
      } catch (err) {
        return {
          ok: false,
          kind: "runtime_error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
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
