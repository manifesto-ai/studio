/**
 * `recallAnchor` — fetch the full body (topic + summary) of a single
 * anchor by id. Pair with `searchAnchors` (which returns light
 * snippets) to drill into a specific result.
 *
 * Side effect: appends the recalled id to the host's recent-recall
 * sequence, which deposits pheromone on the edge between this anchor
 * and the previously-recalled one. Trails strengthen with use.
 */
import type { AgentTool, ToolRunResult } from "./types.js";
import type { AnchorStore } from "../session/agent-session-anchor-store.js";

export type RecallAnchorContext = {
  readonly anchorStore: AnchorStore;
  /** Append this id to the recent-recall sequence so pheromone trails can update. */
  readonly noteRecall: (anchorId: string) => void;
};

export type RecallAnchorInput = {
  readonly anchorId: string;
};

export type RecallAnchorOutput = {
  readonly anchorId: string;
  readonly topic: string;
  readonly summary: string;
  readonly fromWorldId: string;
  readonly toWorldId: string;
  readonly recordedAt: string;
  readonly turnRange: readonly [number, number];
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["anchorId"],
  properties: {
    anchorId: {
      type: "string",
      description:
        "Anchor id returned from a prior searchAnchors call. The full topic + summary body lives in the host store keyed by this id.",
    },
  },
};

export function createRecallAnchorTool(): AgentTool<
  RecallAnchorInput,
  RecallAnchorOutput,
  RecallAnchorContext
> {
  return {
    name: "recallAnchor",
    description:
      "Fetch the full topic + summary of one anchor by id. Use after searchAnchors when a result snippet looks relevant and you need the complete summary text. Successful recalls leave a pheromone trail so future searches favour related anchors.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runRecallAnchor(input, ctx),
  };
}

export async function runRecallAnchor(
  input: RecallAnchorInput,
  ctx: RecallAnchorContext,
): Promise<ToolRunResult<RecallAnchorOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.anchorId !== "string" ||
    input.anchorId.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "recallAnchor requires `anchorId: string`.",
    };
  }
  const record = ctx.anchorStore.getAnchor(input.anchorId);
  if (record === null) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `Unknown anchorId "${input.anchorId}". Use searchAnchors to discover ids.`,
    };
  }
  // Trail update — agent retrieved this anchor; the previous recall
  // (if any) gets a pheromone deposit on the edge to this one.
  ctx.noteRecall(record.anchorId);

  return {
    ok: true,
    output: {
      anchorId: record.anchorId,
      topic: record.topic,
      summary: record.summary,
      fromWorldId: record.fromWorldId,
      toWorldId: record.toWorldId,
      recordedAt: new Date(record.recordedAt).toISOString(),
      turnRange: [record.turnRangeStart, record.turnRangeEnd] as const,
    },
  };
}
