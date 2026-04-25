import type { DomainModule, SourceSpan } from "@manifesto-ai/studio-core";
import type { AgentTool, ToolRunResult } from "./types.js";

export type ReadDeclarationContext = {
  readonly getModule: () => DomainModule | null;
  readonly getSource: () => string;
};

export type ReadDeclarationInput = {
  readonly target: string;
};

export type ReadDeclarationOutput = {
  readonly target: string;
  readonly localKey: string;
  readonly span: SourceSpan;
  readonly text: string;
  readonly lineCount: number;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["target"],
  properties: {
    target: {
      type: "string",
      description:
        "Declaration key to read. Accepts domain:Name, type:Name, state:name, computed:name, action:name, or type_field:Type.field (as returned by inspectSourceOutline).",
    },
  },
};

export function createReadDeclarationTool(): AgentTool<
  ReadDeclarationInput,
  ReadDeclarationOutput,
  ReadDeclarationContext
> {
  return {
    name: "readDeclaration",
    description:
      "Return the literal MEL source text for one declaration, identified by the target string from inspectSourceOutline. Use this to see the exact current body before proposing an edit — do not reconstruct declaration bodies from memory.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runReadDeclaration(input, ctx),
  };
}

export async function runReadDeclaration(
  input: ReadDeclarationInput,
  ctx: ReadDeclarationContext,
): Promise<ToolRunResult<ReadDeclarationOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.target !== "string" ||
    input.target.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`readDeclaration` requires { target: string }.",
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
  const entry =
    module.sourceMap.entries[localKey as keyof typeof module.sourceMap.entries];
  if (entry === undefined) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `No declaration found for target "${target}" (normalized "${localKey}"). Call inspectSourceOutline to see valid targets.`,
    };
  }
  const text = sliceSpan(ctx.getSource(), entry.span);
  return {
    ok: true,
    output: {
      target,
      localKey,
      span: entry.span,
      text,
      lineCount: text === "" ? 0 : text.split(/\r?\n/).length,
    },
  };
}

function normalizeLocalKey(target: string): string {
  if (target.startsWith("state:")) {
    return `state_field:${target.slice("state:".length)}`;
  }
  return target;
}

function sliceSpan(source: string, span: SourceSpan): string {
  const lines = source.split(/\r?\n/);
  const startLine = Math.max(1, span.start.line);
  const endLine = Math.min(lines.length, Math.max(startLine, span.end.line));
  if (startLine === endLine) {
    const line = lines[startLine - 1] ?? "";
    const start = Math.max(0, span.start.column - 1);
    const end = Math.max(start, span.end.column - 1);
    return line.slice(start, end);
  }
  const first = lines[startLine - 1] ?? "";
  const last = lines[endLine - 1] ?? "";
  const firstStart = Math.max(0, span.start.column - 1);
  const lastEnd = Math.max(0, span.end.column - 1);
  const body = lines.slice(startLine, endLine - 1);
  return [first.slice(firstStart), ...body, last.slice(0, lastEnd)].join("\n");
}
