import type {
  MelAuthorBuildOutput,
  MelAuthorExplanationOutput,
  MelAuthorFindSourceOutput,
  MelAuthorFinalDraft,
  MelAuthorFinalizeInput,
  MelAuthorGuideIndex,
  MelAuthorGuideSearchInput,
  MelAuthorGuideSearchOutput,
  MelAuthorGuideSource,
  MelAuthorGraphOutput,
  MelAuthorIntentInput,
  MelAuthorIntentOutput,
  MelAuthorLifecycle,
  MelAuthorLocateOutput,
  MelAuthorMutationOutput,
  MelAuthorPatchDeclarationOutput,
  MelAuthorPatchInput,
  MelAuthorReadDeclarationOutput,
  MelAuthorSourceOutlineOutput,
  MelAuthorSourceRangeOutput,
  MelAuthorSourceOutput,
  MelAuthorTool,
  MelAuthorToolRunResult,
  MelAuthorWhyNotOutput,
  MelAuthorWorkspace,
} from "./types.js";
import { searchMelAuthorGuide } from "./guide-search.js";

const EMPTY_OBJECT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

const READ_SOURCE_SCHEMA = EMPTY_OBJECT_SCHEMA;

const REPLACE_SOURCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["source"],
  properties: {
    source: {
      type: "string",
      description: "The complete replacement MEL source for the workspace.",
    },
  },
};

const PATCH_SOURCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "startLine",
    "startColumn",
    "endLine",
    "endColumn",
    "replacement",
  ],
  properties: {
    startLine: { type: "integer", minimum: 1 },
    startColumn: { type: "integer", minimum: 1 },
    endLine: { type: "integer", minimum: 1 },
    endColumn: { type: "integer", minimum: 1 },
    replacement: { type: "string" },
  },
};

const SOURCE_RANGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["startLine", "endLine"],
  properties: {
    startLine: { type: "integer", minimum: 1 },
    endLine: { type: "integer", minimum: 1 },
    contextLines: { type: "integer", minimum: 0, maximum: 20 },
  },
};

const READ_DECLARATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["target"],
  properties: {
    target: {
      type: "string",
      description:
        "Declaration target from inspectSourceOutline/findSource, e.g. action:addTodo, computed:doneCount, state:tasks, or type:Task.",
    },
    contextLines: { type: "integer", minimum: 0, maximum: 20 },
  },
};

const FIND_SOURCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: {
      type: "string",
      description: "Name, target, phrase, or MEL text to search for.",
    },
    kind: {
      type: "string",
      enum: ["domain", "type", "state", "computed", "action"],
      description: "Optional declaration kind filter.",
    },
    limit: { type: "integer", minimum: 1, maximum: 20 },
  },
};

const PATCH_DECLARATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["target", "replacement"],
  properties: {
    target: {
      type: "string",
      description:
        "Declaration target from inspectSourceOutline/findSource/readDeclaration.",
    },
    replacement: {
      type: "string",
      description:
        "Complete replacement text for that declaration only, without line numbers.",
    },
  },
};

const INSPECT_GRAPH_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodeLimit: { type: "integer", minimum: 1, maximum: 500 },
    edgeLimit: { type: "integer", minimum: 1, maximum: 500 },
  },
};

const LOCATE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["target"],
  properties: {
    target: {
      type: "string",
      description:
        "Graph node id or source-map key, e.g. action:addTodo, computed:doneCount, state:tasks, or state_field:tasks.",
    },
  },
};

const INTENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      description: "MEL action name exactly as declared in the workspace source.",
    },
    args: {
      type: "array",
      description: "Positional action arguments matching the action parameter order.",
      items: {},
    },
  },
};

const FINALIZE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      description: "Short title for the final MEL draft.",
    },
    rationale: {
      type: "string",
      description: "Why the draft satisfies the user request.",
    },
  },
};

const SEARCH_AUTHOR_GUIDE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: {
      type: "string",
      description:
        "Search terms, compiler diagnostic text, MEL construct, or error code.",
    },
    source: {
      type: "string",
      enum: ["reference", "syntax", "error"],
      description: "Optional guide source to search.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 8,
      description: "Maximum number of guide hits to return.",
    },
  },
};

export type CreateMelAuthorToolsOptions = {
  readonly guideIndex?: MelAuthorGuideIndex;
  readonly lifecycle?: MelAuthorLifecycle;
};

export function createMelAuthorTools(
  workspace: MelAuthorWorkspace,
  options: CreateMelAuthorToolsOptions = {},
): readonly MelAuthorTool<unknown, unknown>[] {
  const tools: readonly MelAuthorTool<unknown, unknown>[] = [
    {
      name: "readSource",
      description:
        "Fallback: read the complete ephemeral workspace MEL source. Prefer inspectSourceOutline, findSource, readDeclaration, or readSourceRange first.",
      jsonSchema: READ_SOURCE_SCHEMA,
      run: async () => {
        const output = workspace.readSource();
        await options.lifecycle?.recordReadSource();
        return { ok: true, output };
      },
    } satisfies MelAuthorTool<unknown, MelAuthorSourceOutput>,
    {
      name: "replaceSource",
      description:
        "Replace the entire ephemeral workspace source. This does not touch the user's real source.",
      jsonSchema: REPLACE_SOURCE_SCHEMA,
      run: async (input) => {
        const source = readStringProperty(input, "source");
        if (source === null) {
          await options.lifecycle?.recordToolError("replaceSource");
          return {
            ok: false,
            kind: "invalid_input",
            message: "replaceSource requires { source: string }.",
          };
        }
        const result = workspace.replaceSource(source);
        if (result.ok) {
          await options.lifecycle?.recordMutationAttempt(
            "replaceSource",
            result.output.changed,
          );
        } else {
          await options.lifecycle?.recordToolError("replaceSource");
        }
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorMutationOutput>,
    {
      name: "patchSource",
      description:
        "Patch a 1-based line/column range inside the ephemeral workspace source.",
      jsonSchema: PATCH_SOURCE_SCHEMA,
      run: async (input) => {
        const result = workspace.patchSource(input as MelAuthorPatchInput);
        if (result.ok) {
          await options.lifecycle?.recordMutationAttempt(
            "patchSource",
            result.output.changed,
          );
        } else {
          await options.lifecycle?.recordToolError("patchSource");
        }
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorMutationOutput>,
    {
      name: "build",
      description:
        "Build the current workspace source and return Manifesto diagnostics. Call after every source mutation.",
      jsonSchema: EMPTY_OBJECT_SCHEMA,
      run: async () => {
        const output = await workspace.build();
        await options.lifecycle?.recordBuild(output.status, output.errorCount);
        return { ok: true, output };
      },
    } satisfies MelAuthorTool<unknown, MelAuthorBuildOutput>,
    {
      name: "inspectSourceOutline",
      description:
        "Inspect a compact source-map outline of domain, type, state, computed, and action declarations. Requires a clean build. Prefer this before reading source.",
      jsonSchema: EMPTY_OBJECT_SCHEMA,
      run: async () => {
        const result = workspace.inspectSourceOutline();
        await recordObservation(
          options.lifecycle,
          "inspectSourceOutline",
          result.ok,
        );
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorSourceOutlineOutput>,
    {
      name: "readSourceRange",
      description:
        "Read a bounded line range from the workspace source. Prefer this over readSource when a declaration span is known.",
      jsonSchema: SOURCE_RANGE_SCHEMA,
      run: async (input) => {
        const result = workspace.readSourceRange(input as never);
        await recordObservation(options.lifecycle, "readSourceRange", result.ok);
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorSourceRangeOutput>,
    {
      name: "readDeclaration",
      description:
        "Read only one declaration by target, using the current source map. Requires a clean build.",
      jsonSchema: READ_DECLARATION_SCHEMA,
      run: async (input) => {
        const result = workspace.readDeclaration(input as never);
        await recordObservation(options.lifecycle, "readDeclaration", result.ok);
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorReadDeclarationOutput>,
    {
      name: "findSource",
      description:
        "Find source declarations by name, target, kind, or nearby text. Requires a clean build.",
      jsonSchema: FIND_SOURCE_SCHEMA,
      run: async (input) => {
        const result = workspace.findSource(input as never);
        await recordObservation(options.lifecycle, "findSource", result.ok);
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorFindSourceOutput>,
    {
      name: "patchDeclaration",
      description:
        "Replace a single source-map declaration target. Prefer this over full replaceSource for scoped MEL edits. Requires a clean build before patching.",
      jsonSchema: PATCH_DECLARATION_SCHEMA,
      run: async (input) => {
        const result = workspace.patchDeclaration(input as never);
        if (result.ok) {
          await options.lifecycle?.recordMutationAttempt(
            "patchDeclaration",
            result.output.changed,
          );
        } else {
          await options.lifecycle?.recordToolError("patchDeclaration");
        }
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorPatchDeclarationOutput>,
    ...(options.guideIndex === undefined
      ? []
      : [
          {
            name: "searchAuthorGuide",
            description:
              "Search the bundled MEL authoring guide for syntax, reference, and compiler-error guidance. Use compiler diagnostics as queries after a failed build.",
            jsonSchema: SEARCH_AUTHOR_GUIDE_SCHEMA,
            run: async (input) =>
              searchAuthorGuide(
                options.guideIndex as MelAuthorGuideIndex,
                input,
                options.lifecycle,
              ),
          } satisfies MelAuthorTool<unknown, MelAuthorGuideSearchOutput>,
        ]),
    {
      name: "inspectGraph",
      description:
        "Inspect the built schema graph for actions, state, computed nodes, and relationships. Requires a clean build of the current source.",
      jsonSchema: INSPECT_GRAPH_SCHEMA,
      run: async (input) => {
        const result = workspace.inspectGraph(readGraphOptions(input));
        await recordObservation(options.lifecycle, "inspectGraph", result.ok);
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorGraphOutput>,
    {
      name: "locateDeclaration",
      description:
        "Locate a declaration in the built source map and return span plus preview. Requires a clean build.",
      jsonSchema: LOCATE_SCHEMA,
      run: async (input) => {
        const target = readStringProperty(input, "target");
        if (target === null) {
          await options.lifecycle?.recordToolError("locateDeclaration");
          return {
            ok: false,
            kind: "invalid_input",
            message: "locateDeclaration requires { target: string }.",
          };
        }
        const result = workspace.locateDeclaration(target);
        await recordObservation(options.lifecycle, "locateDeclaration", result.ok);
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorLocateOutput>,
    {
      name: "why",
      description:
        "Explain whether a bound action intent is admitted on the current workspace runtime. Requires a clean build.",
      jsonSchema: INTENT_SCHEMA,
      run: async (input) => {
        const result = workspace.why(input as MelAuthorIntentInput);
        await recordObservation(options.lifecycle, "why", result.ok);
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorExplanationOutput>,
    {
      name: "whyNot",
      description:
        "Return blockers for a bound action intent on the current workspace runtime. Requires a clean build.",
      jsonSchema: INTENT_SCHEMA,
      run: async (input) => {
        const result = workspace.whyNot(input as MelAuthorIntentInput);
        await recordObservation(options.lifecycle, "whyNot", result.ok);
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorWhyNotOutput>,
    {
      name: "simulate",
      description:
        "Dry-run a bound action intent against the current workspace runtime without dispatching. Requires a clean build.",
      jsonSchema: INTENT_SCHEMA,
      run: async (input) => {
        const result = workspace.simulate(input as MelAuthorIntentInput);
        if (result.ok) {
          await options.lifecycle?.recordSimulation();
        } else {
          await options.lifecycle?.recordToolError("simulate");
        }
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorIntentOutput>,
    {
      name: "finalize",
      description:
        "Finalize the current workspace source as the proposed MEL draft. This builds once more and returns the full proposed source plus diagnostics.",
      jsonSchema: FINALIZE_SCHEMA,
      run: async (input) => {
        const result = await workspace.finalize(
          input as MelAuthorFinalizeInput | undefined,
        );
        if (!result.ok) {
          await options.lifecycle?.recordToolError("finalize");
          return result;
        }
        await options.lifecycle?.recordBuild(
          result.output.status === "verified" ? "ok" : "fail",
          result.output.diagnostics.filter(
            (diagnostic) => diagnostic.severity === "error",
          ).length,
        );
        if (result.output.status === "verified") {
          const lifecycleResult = await options.lifecycle?.recordFinalize(
            result.output.schemaHash ?? result.output.title,
          );
          if (lifecycleResult !== undefined && !lifecycleResult.ok) {
            return {
              ok: false,
              kind: "runtime_error",
              message:
                "finalize requires at least one source mutation and a clean build in the Author lifecycle.",
              detail: {
                lifecycleResult,
                authorLineage: options.lifecycle?.getLineage(),
              },
            };
          }
        }
        return result;
      },
    } satisfies MelAuthorTool<unknown, MelAuthorFinalDraft>,
  ];
  return tools;
}

async function searchAuthorGuide(
  guideIndex: MelAuthorGuideIndex,
  input: unknown,
  lifecycle: MelAuthorLifecycle | undefined,
): Promise<MelAuthorToolRunResult<MelAuthorGuideSearchOutput>> {
  const query = readStringProperty(input, "query");
  if (query === null || query.trim() === "") {
    await lifecycle?.recordToolError("searchAuthorGuide");
    return {
      ok: false,
      kind: "invalid_input",
      message: "searchAuthorGuide requires { query: string }.",
    };
  }

  const source = readOptionalGuideSource(input);
  if (source === "invalid") {
    await lifecycle?.recordToolError("searchAuthorGuide");
    return {
      ok: false,
      kind: "invalid_input",
      message:
        'searchAuthorGuide source must be one of "reference", "syntax", or "error".',
    };
  }

  const output = searchMelAuthorGuide(guideIndex, {
    query,
    source,
    limit: readOptionalNumberProperty(input, "limit"),
  } satisfies MelAuthorGuideSearchInput);
  await lifecycle?.recordGuideSearch();
  return {
    ok: true,
    output,
  };
}

async function recordObservation(
  lifecycle: MelAuthorLifecycle | undefined,
  toolName: string,
  ok: boolean,
): Promise<void> {
  if (ok) {
    await lifecycle?.recordInspection(toolName);
  } else {
    await lifecycle?.recordToolError(toolName);
  }
}

function readStringProperty(input: unknown, key: string): string | null {
  if (input === null || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readOptionalNumberProperty(
  input: unknown,
  key: string,
): number | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function readOptionalGuideSource(
  input: unknown,
): MelAuthorGuideSource | "invalid" | undefined {
  const value = readStringProperty(input, "source");
  if (value === null) return undefined;
  if (value === "reference" || value === "syntax" || value === "error") {
    return value;
  }
  return "invalid";
}

function readGraphOptions(
  input: unknown,
): { readonly nodeLimit?: number; readonly edgeLimit?: number } {
  if (input === null || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  return {
    nodeLimit:
      typeof record.nodeLimit === "number" ? record.nodeLimit : undefined,
    edgeLimit:
      typeof record.edgeLimit === "number" ? record.edgeLimit : undefined,
  };
}
