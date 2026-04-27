import type { DomainModule, SourceSpan } from "@manifesto-ai/studio-core";
import type { AgentTool, ToolRunResult } from "./types.js";

export type SourceMapContext = {
  readonly getModule: () => DomainModule | null;
  readonly getSource: () => string;
};

export type LocateSourceInput = {
  readonly target: string;
};

export type LocateSourceOutput = {
  readonly target: string;
  readonly localKey: string;
  readonly schemaHash: string;
  readonly span: SourceSpan;
  readonly preview: string;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["target"],
  properties: {
    target: {
      type: "string",
      description:
        "Source target to locate. Accepts graph node ids like action:addTodo, computed:todoCount, state:todos, or source-map local keys like state_field:todos.",
    },
  },
};

export function createSourceMapTool(): AgentTool<
  LocateSourceInput,
  LocateSourceOutput,
  SourceMapContext
> {
  return {
    name: "locateSource",
    description:
      "Locate a MEL declaration in source by graph node id or source-map local key. Returns line/column span plus a short source preview for citations. Use before proposing or explaining source edits.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runLocateSource(input, ctx),
  };
}

export async function runLocateSource(
  input: LocateSourceInput,
  ctx: SourceMapContext,
): Promise<ToolRunResult<LocateSourceOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.target !== "string" ||
    input.target.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`locateSource` requires { target: string }.",
    };
  }
  const module = ctx.getModule();
  if (module === null) {
    return {
      ok: false,
      kind: "runtime_error",
      message: "No compiled MEL module is available.",
    };
  }
  const target = input.target.trim();
  const localKey = normalizeLocalKey(target);
  const entry = module.sourceMap.entries[localKey as keyof typeof module.sourceMap.entries];
  if (entry === undefined) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `No source-map entry for "${target}" (normalized "${localKey}").`,
    };
  }
  return {
    ok: true,
    output: {
      target,
      localKey,
      schemaHash: module.schema.hash,
      span: entry.span,
      preview: previewSpan(ctx.getSource(), entry.span),
    },
  };
}

function normalizeLocalKey(target: string): string {
  if (target.startsWith("state:")) {
    return `state_field:${target.slice("state:".length)}`;
  }
  return target;
}

function previewSpan(source: string, span: SourceSpan): string {
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, span.start.line);
  const end = Math.max(start, span.end.line);
  const windowStart = Math.max(1, start - 1);
  const windowEnd = Math.min(lines.length, end + 1);
  const rendered: string[] = [];
  for (let lineNo = windowStart; lineNo <= windowEnd; lineNo++) {
    const raw = lines[lineNo - 1] ?? "";
    rendered.push(`${lineNo}: ${raw}`);
  }
  const preview = rendered.join("\n");
  return preview.length <= 1000 ? preview : preview.slice(0, 999) + "...";
}
