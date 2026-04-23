/**
 * `inspectSnapshot` — read-only tool returning the user-domain
 * Manifesto snapshot as `{ data, computed }`.
 *
 * Why a tool, not a system-prompt block?
 *
 * The snapshot mutates on every successful dispatch. Baking it into
 * every system prompt means a cold cache per dispatch and a stale
 * risk if the agent reasons across multiple turns. A tool call is
 * fresh-by-construction.
 *
 * The tool returns the full `{data, computed}` pair verbatim — no
 * filtering, no truncation beyond what the caller's serializer does.
 * Orchestrator JSON-encodes the result, so very large snapshots may
 * hit the model's context budget; the caller can swap in a projected
 * slice later if that becomes a real constraint.
 */
import type { AgentTool } from "./types.js";

export type InspectSnapshotContext = {
  /**
   * Return the current snapshot shape. Callers pass
   * `core.getSnapshot()` here. Returning `null` means no module is
   * compiled yet — the tool converts that into an `invalid_input`
   * result so the model doesn't hallucinate a shape.
   */
  readonly getSnapshot: () => unknown;
};

export type InspectSnapshotOutput = {
  readonly data: unknown;
  readonly computed: unknown;
  readonly system?: unknown;
};

export function createInspectSnapshotTool(): AgentTool<
  Record<string, never>,
  InspectSnapshotOutput,
  InspectSnapshotContext
> {
  return {
    name: "inspectSnapshot",
    description:
      "Return the current user-domain snapshot: { data, computed }. " +
      "Call this when answering questions about the current state of " +
      "the runtime (counts, field values, whether lists are empty, " +
      "computed field values, etc.). Do not guess — always inspect.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    run: async (_input, ctx) => {
      try {
        const snap = ctx.getSnapshot();
        if (snap === null || snap === undefined) {
          return {
            ok: false,
            kind: "runtime_error",
            message:
              "no snapshot available — user module has not compiled yet",
          };
        }
        const s = snap as {
          readonly data?: unknown;
          readonly computed?: unknown;
          readonly system?: unknown;
        };
        return {
          ok: true,
          output: {
            data: s.data ?? null,
            computed: s.computed ?? null,
            system: s.system,
          },
        };
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
