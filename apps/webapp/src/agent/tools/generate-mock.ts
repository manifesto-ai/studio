/**
 * `generateMock` — agent-visible tool that produces N sample
 * argument arrays for a named user-domain action. Thin wrapper over
 * the pure `mock/generate.ts` module (which humans can invoke
 * directly, too — see `mock/MockDataPalette.tsx`).
 *
 * The tool does NOT dispatch the samples. The agent should call
 * `generateMock` first, then loop `dispatch(action, sample)` for each
 * one. Separating generation from dispatch keeps the tool composable
 * (the agent can generate, tweak, then dispatch) and safe (human
 * reviewer can see a preview before anything mutates the runtime).
 */
import type { AgentTool } from "./types.js";
import { normalizeActionName } from "./action-name.js";
import {
  generateForAction,
  type GenerateForActionResult,
} from "../../mock/generate.js";
import type { DomainModule } from "@manifesto-ai/studio-core";

export type GenerateMockContext = {
  /**
   * Supplier for the compiled domain module. Real callers pass
   * `() => core.getModule()`.
   */
  readonly getModule: () => DomainModule | null;
};

export type GenerateMockInput = {
  readonly action: string;
  readonly count?: number;
  readonly seed?: number;
};

export function createGenerateMockTool(): AgentTool<
  GenerateMockInput,
  GenerateForActionResult,
  GenerateMockContext
> {
  return {
    name: "generateMock",
    description:
      "Generate plausible sample argument arrays for a user-domain " +
      "action, matching its MEL type shape. Returns `{ action, " +
      "paramNames, samples: unknown[][] }`; each sample is an arg array " +
      "to spread into `dispatch(action, args)`. Does NOT dispatch — the " +
      "agent must call `dispatch` for each sample it wants to apply. " +
      "Use this for 'seed me N tasks' / 'mock data 10개 만들어줘' style " +
      "requests. `seed` makes the output reproducible.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          description:
            "User-domain action name to generate args for. Must match " +
            "an action declared in the current MEL module. Graph node ids " +
            "like `action:createTask` are also accepted and normalized.",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "How many samples to generate. Clamped to [1, 100]. " +
            "Default 1.",
        },
        seed: {
          type: "integer",
          description:
            "RNG seed. Same seed + same module = same samples. Omit " +
            "for time-based pseudo-randomness.",
        },
      },
    },
    run: async (input, ctx) => {
      if (typeof input?.action !== "string" || input.action.trim() === "") {
        return {
          ok: false,
          kind: "invalid_input",
          message: "`action` must be a non-empty string",
        };
      }
      const action = normalizeActionName(input.action);
      if (action === "") {
        return {
          ok: false,
          kind: "invalid_input",
          message: "`action` must be a non-empty action name",
        };
      }
      const mod = ctx.getModule();
      if (mod === null) {
        return {
          ok: false,
          kind: "runtime_error",
          message:
            "no module compiled — the editor has no valid MEL to mock against",
        };
      }
      try {
        const result = generateForAction(mod, action, {
          count: input.count,
          seed: input.seed,
        });
        return { ok: true, output: result };
      } catch (err) {
        return {
          ok: false,
          kind: "invalid_input",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
