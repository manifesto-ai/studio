/**
 * `inspectFocus` — read-only tool that returns what the Studio UI is
 * currently focused on, plus the ambient UI state the agent needs to
 * ground deictic references ("this", "그거", etc.).
 *
 * Why a tool, not a system-prompt block?
 *
 * Focus is **dynamic** — it changes with every Monaco cursor move and
 * every graph click. Embedding it in the system prompt means either
 * (a) re-rendering the prompt on every micro-interaction (hostile to
 * prompt caching), or (b) a stale focus line leaking into old reasoning.
 * A tool call is the correct seam: the agent asks when it needs to
 * know, and always sees the live value.
 *
 * No inputs — one tool call returns the whole focus+ui slice.
 */
import type { AgentTool } from "./types.js";

export type InspectFocusContext = {
  readonly getFocus: () => InspectFocusOutput;
};

export type InspectFocusOutput = {
  readonly focusedNodeId: string | null;
  readonly focusedNodeKind: string | null;
  readonly focusedNodeOrigin: string | null;
  readonly activeLens: string;
  readonly viewMode: string;
  readonly simulationActionName: string | null;
  readonly scrubEnvelopeId: string | null;
  readonly activeProjectName: string | null;
};

export function createInspectFocusTool(): AgentTool<
  Record<string, never>,
  InspectFocusOutput,
  InspectFocusContext
> {
  return {
    name: "inspectFocus",
    description:
      "Return the currently focused graph node and the Studio UI state " +
      "(active lens, view mode, active project). Always call this first " +
      "when the user refers to 'this' / '이것' / '이거' / 'that' / etc., " +
      "or when they ask about 'the current' anything. The focused node id " +
      "is in `<kind>:<name>` format, e.g. `action:toggleTodo`.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    run: async (_input, ctx) => {
      try {
        const value = ctx.getFocus();
        return { ok: true, output: value };
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
