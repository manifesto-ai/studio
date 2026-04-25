import type { AgentTool, ToolRunResult } from "./types.js";

export type FindInSourceContext = {
  readonly getSource: () => string;
};

export type FindInSourceInput = {
  readonly query: string;
  readonly limit?: number;
};

export type FindInSourceHit = {
  readonly line: number;
  readonly column: number;
  readonly preview: string;
};

export type FindInSourceOutput = {
  readonly query: string;
  readonly hitCount: number;
  readonly truncated: boolean;
  readonly hits: readonly FindInSourceHit[];
};

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: {
      type: "string",
      description: "Substring or identifier to search for. Case-sensitive.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Maximum hits to return. Defaults to ${DEFAULT_LIMIT}, cap ${MAX_LIMIT}.`,
    },
  },
};

export function createFindInSourceTool(): AgentTool<
  FindInSourceInput,
  FindInSourceOutput,
  FindInSourceContext
> {
  return {
    name: "findInSource",
    description:
      "Search the current MEL source for a substring. Returns line/column hits with a short preview line. Use when the target name is uncertain or when looking for usages before an edit.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runFindInSource(input, ctx),
  };
}

export async function runFindInSource(
  input: FindInSourceInput,
  ctx: FindInSourceContext,
): Promise<ToolRunResult<FindInSourceOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.query !== "string" ||
    input.query === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`findInSource` requires { query: string } with a non-empty query.",
    };
  }
  const query = input.query;
  const limit = resolveLimit(input.limit);
  const source = ctx.getSource();
  const lines = source.split(/\r?\n/);
  const hits: FindInSourceHit[] = [];
  let total = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    let from = 0;
    while (from <= line.length) {
      const idx = line.indexOf(query, from);
      if (idx === -1) break;
      total += 1;
      if (hits.length < limit) {
        hits.push({
          line: lineIndex + 1,
          column: idx + 1,
          preview: previewLine(line),
        });
      }
      from = idx + Math.max(1, query.length);
    }
  }
  return {
    ok: true,
    output: {
      query,
      hitCount: total,
      truncated: total > hits.length,
      hits,
    },
  };
}

function resolveLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  const rounded = Math.floor(raw);
  if (rounded < 1) return 1;
  if (rounded > MAX_LIMIT) return MAX_LIMIT;
  return rounded;
}

function previewLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}...`;
}
