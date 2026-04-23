/**
 * `inspectLineage` — read-only tool over the user-domain runtime's
 * world chain. Every completed dispatch advances StudioCore onto a
 * new World; this tool walks that chain so the agent can answer
 * historical questions without the host shipping the full history
 * every turn.
 *
 * ## Why projection is load-bearing
 *
 * A naïve "return everything" tool would dump every `changedPaths`
 * array back into the LLM each turn. A single busy domain dispatch
 * can mutate 20+ paths, across 10 entries that's hundreds of path
 * strings — enough to eat the model's context budget over a few
 * recall calls.
 *
 * This tool defaults to the *minimum useful* projection:
 *   - worldId (needed for pagination)
 *   - origin.kind + intent name ("what happened")
 *
 * Everything else (changedPaths, parent link, schemaHash, createdAt)
 * is opt-in via `fields`. The agent asks for what it needs, when
 * it needs it — no silent context bloat.
 *
 * ## Filtering
 *
 * `intentType` narrows the chain to entries whose originating
 * dispatch matches a specific action name. Natural for questions
 * like "how many times did we toggleTodo?" — the filter happens
 * server-side so we don't send the irrelevant entries at all.
 */
import type { AgentTool } from "./types.js";

export type WorldOriginLike =
  | { readonly kind: "build"; readonly buildId?: string }
  | { readonly kind: "dispatch"; readonly intentType: string };

export type LineageField =
  | "changedPaths"
  | "parent"
  | "schemaHash"
  | "createdAt";

/**
 * Full shape a single lineage entry can take. All fields except
 * `worldId` and `origin` are optional — projection determines which
 * land in the actual response.
 */
export type LineageEntry = {
  readonly worldId: string;
  readonly origin: WorldOriginLike;
  readonly parentWorldId?: string | null;
  readonly schemaHash?: string;
  readonly changedPaths?: readonly string[];
  readonly changedPathsTruncated?: boolean;
  readonly createdAt?: string;
};

export type InspectLineageContext = {
  /**
   * Return the full lineage, newest-first. The tool filters /
   * projects / paginates; the context just supplies the raw chain.
   */
  readonly getLineage: () => readonly FullLineageEntry[];
};

/**
 * Internal shape the context produces. The adapter in AgentLens
 * projects StudioCore's `WorldLineage` into this shape once; the
 * tool does further slicing based on `fields` / `intentType`.
 */
export type FullLineageEntry = {
  readonly worldId: string;
  readonly origin: WorldOriginLike;
  readonly parentWorldId: string | null;
  readonly schemaHash: string;
  readonly changedPaths: readonly string[];
  readonly createdAt: string;
};

export type InspectLineageInput = {
  readonly limit?: number;
  /**
   * Walk backwards from (older than) this world. Use for paging
   * through long histories without refetching everything.
   */
  readonly beforeWorldId?: string;
  /**
   * Which optional fields to include per entry. Default (omitted)
   * returns just `{worldId, origin}` — the compact projection. Ask
   * for more only when the answer requires it.
   */
  readonly fields?: readonly LineageField[];
  /**
   * Keep only entries whose originating dispatch has this intent
   * type (action name). Applied before pagination so `limit` means
   * "N matching entries," not "N of the full chain that may be
   * mostly irrelevant."
   */
  readonly intentType?: string;
};

export type InspectLineageOutput = {
  readonly entries: readonly LineageEntry[];
  /** Total entries matching the filter (NOT the grand total). */
  readonly totalMatched: number;
  /** Grand total worlds in the chain — useful for "we're N% through." */
  readonly totalWorlds: number;
  /**
   * When this page didn't reach the oldest matching entry, the
   * worldId to pass as `beforeWorldId` for the next page. `null`
   * means the current page reaches the tail.
   */
  readonly nextBeforeWorldId: string | null;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 30;
const CHANGED_PATHS_CAP = 20;

export function createInspectLineageTool(): AgentTool<
  InspectLineageInput,
  InspectLineageOutput,
  InspectLineageContext
> {
  return {
    name: "inspectLineage",
    description:
      "Walk the user-domain runtime's recent world chain (past " +
      "dispatches). DEFAULT response is compact — just {worldId, " +
      "origin}. Use `fields` to opt into changedPaths / parent / " +
      "schemaHash / createdAt when the question actually needs them; " +
      "never request fields speculatively (context cost). Use " +
      "`intentType` to filter to a specific action (e.g. 'toggleTodo'). " +
      "`limit` default 5, max 30. Use `beforeWorldId` to page older.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many entries to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
        },
        beforeWorldId: {
          type: "string",
          description:
            "Return entries older than this world id (pagination).",
        },
        fields: {
          type: "array",
          items: {
            type: "string",
            enum: ["changedPaths", "parent", "schemaHash", "createdAt"],
          },
          description:
            "Optional fields to include per entry. Omit for the " +
            "compact default. `changedPaths` is capped at " +
            `${CHANGED_PATHS_CAP} paths per entry; a ` +
            "`changedPathsTruncated: true` flag signals overflow.",
        },
        intentType: {
          type: "string",
          description:
            "Keep only entries whose dispatch was this action. " +
            "Use for 'how many times did we X?' style queries.",
        },
      },
    },
    run: async (input, ctx) => {
      const limit = Math.max(
        1,
        Math.min(MAX_LIMIT, input?.limit ?? DEFAULT_LIMIT),
      );
      const wantFields = new Set<LineageField>(input?.fields ?? []);
      const intentFilter = input?.intentType;
      try {
        const all = ctx.getLineage();

        // Filter by intent type BEFORE paging so `limit` means
        // "matching entries." Build lineage is retained regardless —
        // it's a useful pinpoint for "when did the schema change"
        // even without a filter match.
        const matched =
          intentFilter === undefined
            ? all
            : all.filter(
                (e) =>
                  e.origin.kind === "dispatch" &&
                  e.origin.intentType === intentFilter,
              );

        // Paging cursor — find by id in the filtered list.
        let cursor = 0;
        if (input?.beforeWorldId !== undefined) {
          const idx = matched.findIndex(
            (e) => e.worldId === input.beforeWorldId,
          );
          if (idx === -1) {
            return {
              ok: false,
              kind: "invalid_input",
              message: `unknown worldId: ${input.beforeWorldId}`,
            };
          }
          cursor = idx + 1;
        }

        const slice = matched.slice(cursor, cursor + limit);
        const projected = slice.map((e) => projectEntry(e, wantFields));
        const nextBeforeWorldId =
          cursor + limit < matched.length
            ? matched[cursor + limit - 1]?.worldId ?? null
            : null;

        return {
          ok: true,
          output: {
            entries: projected,
            totalMatched: matched.length,
            totalWorlds: all.length,
            nextBeforeWorldId,
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

function projectEntry(
  e: FullLineageEntry,
  wantFields: ReadonlySet<LineageField>,
): LineageEntry {
  const out: {
    worldId: string;
    origin: WorldOriginLike;
    parentWorldId?: string | null;
    schemaHash?: string;
    changedPaths?: readonly string[];
    changedPathsTruncated?: boolean;
    createdAt?: string;
  } = {
    worldId: e.worldId,
    origin: e.origin,
  };
  if (wantFields.has("parent")) {
    out.parentWorldId = e.parentWorldId;
  }
  if (wantFields.has("schemaHash")) {
    out.schemaHash = e.schemaHash;
  }
  if (wantFields.has("changedPaths")) {
    if (e.changedPaths.length <= CHANGED_PATHS_CAP) {
      out.changedPaths = e.changedPaths;
    } else {
      // Truncate with an explicit flag so the agent knows the list
      // is not complete. `limit` on lineage itself doesn't help here;
      // this is about one entry's changed-set cardinality.
      out.changedPaths = e.changedPaths.slice(0, CHANGED_PATHS_CAP);
      out.changedPathsTruncated = true;
    }
  }
  if (wantFields.has("createdAt")) {
    out.createdAt = e.createdAt;
  }
  return out;
}
