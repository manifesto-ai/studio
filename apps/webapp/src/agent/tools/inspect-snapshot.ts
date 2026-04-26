import { digestSnapshot, type SnapshotDigest } from "../digest/manifesto-digest.js";
import type { AgentTool } from "./types.js";

export type InspectSnapshotContext = {
  readonly getSnapshot: () => unknown;
};

export type InspectSnapshotOutput = SnapshotDigest;

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
        return {
          ok: true,
          output: digestSnapshot(snap),
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
