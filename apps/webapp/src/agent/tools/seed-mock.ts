/**
 * `seedMock` — one-shot mock-data seeder for the agent. Combines
 * `generateMock`'s type-walk + `dispatch`'s write step into a single
 * tool call, because the agent's end goal is almost always "make the
 * runtime have N sample rows," not "show me what samples would look
 * like." Splitting those into two tool calls leaves small models
 * prone to stopping after the generate step and declaring success
 * when nothing actually landed.
 *
 * Still composable: the pure `generateForAction` builder is the same
 * one `generateMock` and the human MockDataPalette use. The agent
 * can choose `generateMock` when it wants a preview to narrate over,
 * and `seedMock` when it wants to just make the change stick.
 *
 * The tool dispatches samples sequentially (not in parallel) so each
 * write settles against the previous one's snapshot — matters for
 * actions whose guards reference counts. A rejected or failed
 * dispatch does NOT abort the loop; we report a per-outcome tally so
 * the agent can describe the partial result.
 */
import type { AgentTool } from "./types.js";
import {
  generateForAction,
  type GenerateForActionResult,
} from "../../mock/generate.js";
import type { DomainModule } from "@manifesto-ai/studio-core";

/** Shape we expect on dispatch result — we keep it loose (index
 *  signature) to tolerate the runtime version-skew, while picking
 *  out the fields the tool actually surfaces: kind, a rejection
 *  code, and any human message. */
export type SeedMockDispatchResult = {
  readonly kind: "completed" | "rejected" | "failed" | string;
  readonly rejection?: {
    readonly code?: string;
    readonly message?: string;
    readonly expression?: string;
  };
  readonly error?: { readonly message?: string };
  readonly [k: string]: unknown;
};

export type SeedMockContext = {
  readonly getModule: () => DomainModule | null;
  readonly createIntent: (action: string, ...args: unknown[]) => unknown;
  readonly dispatchAsync: (intent: unknown) => Promise<SeedMockDispatchResult>;
};

export type SeedMockInput = {
  readonly action: string;
  readonly count?: number;
  readonly seed?: number;
};

export type SeedMockOutcome =
  | { readonly kind: "completed" }
  | {
      readonly kind: "rejected";
      /** Rejection code from the runtime (e.g. guard name). */
      readonly code?: string;
      /** Human-readable reason if the runtime surfaces one. */
      readonly message?: string;
    }
  | { readonly kind: "failed"; readonly message?: string }
  | { readonly kind: "error"; readonly message: string };

export type SeedMockOutput = {
  readonly action: string;
  readonly attempted: number;
  readonly completed: number;
  readonly rejected: number;
  readonly failed: number;
  readonly errored: number;
  /**
   * The samples that were *generated*, in order. Useful for the
   * agent to describe what it created. Not filtered by outcome —
   * index-aligned with `outcomes`.
   */
  readonly samples: readonly (readonly unknown[])[];
  /**
   * Per-sample outcome detail, same length as `samples`.
   * `rejected` entries carry the runtime's rejection code/message
   * so the agent can tell the user *why* a batch failed instead of
   * just "5/5 rejected." `error` means dispatch threw (unexpected) —
   * separate from `rejected` (legality gate) and `failed` (runtime
   * logic returned failure).
   */
  readonly outcomes: readonly SeedMockOutcome[];
};

export function createSeedMockTool(): AgentTool<
  SeedMockInput,
  SeedMockOutput,
  SeedMockContext
> {
  return {
    name: "seedMock",
    description:
      "Generate plausible sample arguments for a user-domain action AND " +
      "dispatch each one against the runtime. Use this for 'seed 10 tasks' / " +
      "'mock data 만들어줘' style requests — it's one call, sequential " +
      "dispatches, and returns a tally of completed/rejected/failed/errored. " +
      "Use `generateMock` instead when you want to preview samples without " +
      "mutating the runtime.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          description:
            "User-domain action name to seed. Must match an action declared " +
            "in the current MEL module.",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "How many samples to generate + dispatch. Clamped to [1, 100]. " +
            "Default 1.",
        },
        seed: {
          type: "integer",
          description:
            "RNG seed. Same seed + same module = same samples. Omit for " +
            "time-based pseudo-randomness.",
        },
      },
    },
    run: async (input, ctx) => {
      if (typeof input?.action !== "string" || input.action === "") {
        return {
          ok: false,
          kind: "invalid_input",
          message: "`action` must be a non-empty string",
        };
      }
      const mod = ctx.getModule();
      if (mod === null) {
        return {
          ok: false,
          kind: "runtime_error",
          message:
            "no module compiled — the editor has no valid MEL to seed against",
        };
      }

      let generated: GenerateForActionResult;
      try {
        generated = generateForAction(mod, input.action, {
          count: input.count,
          seed: input.seed,
        });
      } catch (err) {
        return {
          ok: false,
          kind: "invalid_input",
          message: err instanceof Error ? err.message : String(err),
        };
      }

      const outcomes: SeedMockOutcome[] = [];
      let completed = 0;
      let rejected = 0;
      let failed = 0;
      let errored = 0;

      // Sequential on purpose — if action N depends on state written
      // by action N-1, parallel would lose that dependency. The loop
      // also lets a per-sample error get recorded without aborting
      // subsequent dispatches.
      for (const args of generated.samples) {
        try {
          const intent = ctx.createIntent(input.action, ...args);
          const report = await ctx.dispatchAsync(intent);
          if (report.kind === "completed") {
            completed += 1;
            outcomes.push({ kind: "completed" });
          } else if (report.kind === "rejected") {
            rejected += 1;
            // Bubble the runtime's rejection code/message upward so
            // the agent can explain WHY — "rejected because guard
            // `existsById(...)` evaluated false" beats an opaque count.
            outcomes.push({
              kind: "rejected",
              code: report.rejection?.code,
              message:
                report.rejection?.message ?? report.rejection?.expression,
            });
          } else if (report.kind === "failed") {
            failed += 1;
            outcomes.push({
              kind: "failed",
              message: report.error?.message,
            });
          } else {
            // Unknown kind — treat as errored so the agent flags an
            // unexpected result shape rather than silently tallying.
            errored += 1;
            outcomes.push({
              kind: "error",
              message: `unknown dispatch result kind: ${String(report.kind)}`,
            });
          }
        } catch (err) {
          errored += 1;
          outcomes.push({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        ok: true,
        output: {
          action: input.action,
          attempted: generated.samples.length,
          completed,
          rejected,
          failed,
          errored,
          samples: generated.samples,
          outcomes,
        },
      };
    },
  };
}
