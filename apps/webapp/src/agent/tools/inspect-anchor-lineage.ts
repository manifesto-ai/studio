/**
 * `inspectAnchorLineage` — drill down from an anchor to the raw
 * lineage worlds within its [fromWorldId, toWorldId] range.
 *
 * Use this when `recallAnchor` returns a summary that's almost what
 * the agent needs but lacks specific detail. The world entries
 * include the same compact projection as `inspectLineage`, scoped
 * to the anchor's window.
 *
 * The host wires this on top of an existing `getLineage()` reader
 * (typically `core.getLineage()`).
 */
import type { AgentTool, ToolRunResult } from "./types.js";
import type {
  FullLineageEntry,
  LineageEntry,
  WorldOriginLike,
} from "./inspect-lineage.js";
import type { AnchorStore } from "../session/agent-session-anchor-store.js";

export type InspectAnchorLineageContext = {
  readonly anchorStore: AnchorStore;
  readonly getLineage: () => readonly FullLineageEntry[];
  /** Mark the anchor as recalled so pheromone trails update. */
  readonly noteRecall: (anchorId: string) => void;
};

export type InspectAnchorLineageInput = {
  readonly anchorId: string;
  readonly limit?: number;
  readonly beforeWorldId?: string;
};

export type InspectAnchorLineageOutput = {
  readonly anchorId: string;
  readonly fromWorldId: string;
  readonly toWorldId: string;
  readonly entries: readonly LineageEntry[];
  readonly totalInWindow: number;
  readonly nextBeforeWorldId: string | null;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["anchorId"],
  properties: {
    anchorId: {
      type: "string",
      description: "Anchor id whose world range should be drilled into.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `How many lineage entries to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
    },
    beforeWorldId: {
      type: "string",
      description:
        "Pagination cursor — return entries older than this world id within the anchor's window.",
    },
  },
};

export function createInspectAnchorLineageTool(): AgentTool<
  InspectAnchorLineageInput,
  InspectAnchorLineageOutput,
  InspectAnchorLineageContext
> {
  return {
    name: "inspectAnchorLineage",
    description:
      "Drill from an anchor to the raw lineage entries inside its [fromWorldId, toWorldId] window. Use when recallAnchor's summary is almost-but-not-quite what you need and you want the actual intent types / world ids that the anchor compressed. Paginate with `beforeWorldId`.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runInspectAnchorLineage(input, ctx),
  };
}

export async function runInspectAnchorLineage(
  input: InspectAnchorLineageInput,
  ctx: InspectAnchorLineageContext,
): Promise<ToolRunResult<InspectAnchorLineageOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.anchorId !== "string" ||
    input.anchorId.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "inspectAnchorLineage requires `anchorId: string`.",
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

  const limit = clampInt(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  // Walk lineage finding worlds within the [fromWorldId, toWorldId]
  // window. The lineage is newest-first by convention; we walk it in
  // order and keep entries whose world is in the closed-open window
  // (after fromWorldId, up to and including toWorldId).
  const all = ctx.getLineage();
  const inWindow = sliceWindow(all, record.fromWorldId, record.toWorldId);

  // Apply beforeWorldId pagination cursor if provided.
  let cursor = 0;
  if (typeof input.beforeWorldId === "string" && input.beforeWorldId !== "") {
    const idx = inWindow.findIndex((e) => e.worldId === input.beforeWorldId);
    if (idx === -1) {
      return {
        ok: false,
        kind: "invalid_input",
        message: `unknown worldId for cursor: ${input.beforeWorldId}`,
      };
    }
    cursor = idx + 1;
  }

  const slice = inWindow.slice(cursor, cursor + limit);
  const entries: LineageEntry[] = slice.map((e) => ({
    worldId: e.worldId,
    origin: e.origin as WorldOriginLike,
    schemaHash: e.schemaHash,
  }));
  const nextBeforeWorldId =
    cursor + limit < inWindow.length
      ? inWindow[cursor + limit - 1]?.worldId ?? null
      : null;

  ctx.noteRecall(record.anchorId);

  return {
    ok: true,
    output: {
      anchorId: record.anchorId,
      fromWorldId: record.fromWorldId,
      toWorldId: record.toWorldId,
      entries,
      totalInWindow: inWindow.length,
      nextBeforeWorldId,
    },
  };
}

/**
 * Slice the lineage to the [fromWorldId, toWorldId] window.
 *
 * Treats fromWorldId as exclusive (the prior anchor's end, so we
 * don't double-count) and toWorldId as inclusive. Sentinel
 * fromWorldId values like "session-start" are matched as "no lower
 * bound." Worlds beyond toWorldId are not returned even though
 * lineage may continue past it.
 */
function sliceWindow(
  lineage: readonly FullLineageEntry[],
  fromWorldId: string,
  toWorldId: string,
): readonly FullLineageEntry[] {
  // lineage is newest-first; reorder to chronological for window
  // computation, then return in the same chronological order.
  const chrono = [...lineage].reverse();
  let started = fromWorldId === "" || fromWorldId === "session-start";
  const out: FullLineageEntry[] = [];
  for (const e of chrono) {
    if (!started) {
      if (e.worldId === fromWorldId) {
        started = true;
      }
      continue;
    }
    out.push(e);
    if (e.worldId === toWorldId) break;
  }
  return out;
}

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(min, Math.min(max, n));
}
