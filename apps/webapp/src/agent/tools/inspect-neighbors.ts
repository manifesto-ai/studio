/**
 * `inspectNeighbors` — read-only tool returning the graph edges that
 * touch a given node in the compiled user-domain schema graph.
 *
 * Relations (from `@manifesto-ai/compiler` SchemaGraphEdgeRelation):
 *   - `feeds`    : source state/computed flows into a computed.
 *   - `mutates`  : action patches a state field.
 *   - `unlocks`  : state/computed appears in an action's `available`
 *                  or `dispatchable` guard.
 *
 * Edge direction is literal (`from` → `to`). This tool reports each
 * edge touching `nodeId` with `direction: "in" | "out"` so the model
 * can read cause vs. effect without reconstructing it.
 *
 * Why a tool, not a prompt block?
 *
 * The schema graph is large; only the neighborhood of the currently-
 * relevant node matters. Shipping all edges inflates the prompt and
 * forces the model to filter. A tool call is targeted by nodeId.
 */
import type { AgentTool } from "./types.js";

export type InspectNeighborsContext = {
  /**
   * Return the full edge list from the compiled module's
   * `schema-graph`. Real callers pass `core.getModule()?.graph.edges`.
   */
  readonly getEdges: () => readonly {
    readonly from: string;
    readonly to: string;
    readonly relation: "feeds" | "mutates" | "unlocks";
  }[];
  /** Optional existence check used to reject typos early. */
  readonly hasNode?: (nodeId: string) => boolean;
};

export type InspectNeighborsInput = {
  readonly nodeId: string;
};

export type Neighbor = {
  readonly peerId: string;
  readonly relation: "feeds" | "mutates" | "unlocks";
  readonly direction: "in" | "out";
};

export type InspectNeighborsOutput = {
  readonly nodeId: string;
  readonly incoming: readonly Neighbor[];
  readonly outgoing: readonly Neighbor[];
};

export function createInspectNeighborsTool(): AgentTool<
  InspectNeighborsInput,
  InspectNeighborsOutput,
  InspectNeighborsContext
> {
  return {
    name: "inspectNeighbors",
    description:
      "Return the graph edges touching a node in the user-domain schema " +
      "graph. Use this for 'related graph', 'what depends on X', 'what " +
      "does X affect' questions. Edge relations are: feeds (computed " +
      "depends on source), mutates (action writes state), unlocks " +
      "(state/computed appears in an action's guard). Node ids follow " +
      "`<kind>:<name>`, e.g. `action:toggleTodo`, `state:tasks`, " +
      "`computed:deletedCount`.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["nodeId"],
      properties: {
        nodeId: {
          type: "string",
          description:
            "The target node id in `<kind>:<name>` format. Get the " +
            "focused id from `inspectFocus()` if the user says 'this'.",
        },
      },
    },
    run: async (input, ctx) => {
      if (typeof input?.nodeId !== "string" || input.nodeId === "") {
        return {
          ok: false,
          kind: "invalid_input",
          message: "nodeId must be a non-empty string",
        };
      }
      if (ctx.hasNode !== undefined && !ctx.hasNode(input.nodeId)) {
        return {
          ok: false,
          kind: "invalid_input",
          message: `unknown node id: ${input.nodeId}`,
        };
      }
      try {
        const incoming: Neighbor[] = [];
        const outgoing: Neighbor[] = [];
        for (const e of ctx.getEdges()) {
          if (e.to === input.nodeId) {
            incoming.push({
              peerId: e.from,
              relation: e.relation,
              direction: "in",
            });
          }
          if (e.from === input.nodeId) {
            outgoing.push({
              peerId: e.to,
              relation: e.relation,
              direction: "out",
            });
          }
        }
        return {
          ok: true,
          output: { nodeId: input.nodeId, incoming, outgoing },
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
