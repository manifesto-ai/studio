import type { DomainModule, SourceSpan } from "@manifesto-ai/studio-core";
import type { AgentTool, ToolRunResult } from "./types.js";

export type InspectSourceOutlineContext = {
  readonly getModule: () => DomainModule | null;
  readonly getSource: () => string;
};

export type SourceOutlineEntry = {
  readonly target: string;
  readonly kind: "domain" | "type" | "type_field" | "state" | "computed" | "action";
  readonly name: string;
  readonly span: SourceSpan;
};

export type InspectSourceOutlineOutput = {
  readonly schemaHash: string;
  readonly lineCount: number;
  readonly entryCount: number;
  readonly domains: readonly string[];
  readonly entries: readonly SourceOutlineEntry[];
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export function createInspectSourceOutlineTool(): AgentTool<
  Record<string, never>,
  InspectSourceOutlineOutput,
  InspectSourceOutlineContext
> {
  return {
    name: "inspectSourceOutline",
    description:
      "List every top-level declaration in the current MEL source with its line range. Returns entries keyed by target (domain:Name, type:Name, state:name, computed:name, action:name, type_field:Type.field). Call first before readDeclaration or proposing source changes — never guess the structure from memory.",
    jsonSchema: JSON_SCHEMA,
    run: async (_input, ctx) => runInspectSourceOutline(ctx),
  };
}

export async function runInspectSourceOutline(
  ctx: InspectSourceOutlineContext,
): Promise<ToolRunResult<InspectSourceOutlineOutput>> {
  const module = ctx.getModule();
  if (module === null) {
    return {
      ok: false,
      kind: "runtime_error",
      message: "No compiled MEL module is available.",
    };
  }
  const source = ctx.getSource();
  const lineCount = source === "" ? 0 : source.split(/\r?\n/).length;
  const entries: SourceOutlineEntry[] = [];
  const domainNames = new Set<string>();
  for (const [localKey, entry] of Object.entries(module.sourceMap.entries)) {
    const projected = projectEntry(localKey, entry.target, entry.span);
    if (projected === null) continue;
    if (projected.kind === "domain") domainNames.add(projected.name);
    entries.push(projected);
  }
  entries.sort((a, b) => a.span.start.line - b.span.start.line);
  return {
    ok: true,
    output: {
      schemaHash: module.schema.hash,
      lineCount,
      entryCount: entries.length,
      domains: [...domainNames].sort(),
      entries,
    },
  };
}

function projectEntry(
  localKey: string,
  target: { readonly kind: string; readonly [k: string]: unknown },
  span: SourceSpan,
): SourceOutlineEntry | null {
  switch (target.kind) {
    case "domain":
      return {
        target: localKey,
        kind: "domain",
        name: readName(target, "domain"),
        span,
      };
    case "type":
      return {
        target: localKey,
        kind: "type",
        name: readName(target, "type"),
        span,
      };
    case "type_field":
      return {
        target: localKey,
        kind: "type_field",
        name: `${readName(target, "type")}.${readNestedName(target, "field")}`,
        span,
      };
    case "state_field":
      return {
        target: `state:${readNestedName(target, "field")}`,
        kind: "state",
        name: readNestedName(target, "field"),
        span,
      };
    case "computed":
      return {
        target: localKey,
        kind: "computed",
        name: readName(target, "computed"),
        span,
      };
    case "action":
      return {
        target: localKey,
        kind: "action",
        name: readName(target, "action"),
        span,
      };
    default:
      return null;
  }
}

function readName(
  target: { readonly [k: string]: unknown },
  key: string,
): string {
  const node = target[key];
  if (node !== null && typeof node === "object" && "name" in node) {
    const name = (node as { readonly name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function readNestedName(
  target: { readonly [k: string]: unknown },
  key: string,
): string {
  return readName(target, key);
}
