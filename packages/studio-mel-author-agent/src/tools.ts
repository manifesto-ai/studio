import type {
  MelAuthorBuildOutput,
  MelAuthorExplanationOutput,
  MelAuthorFinalDraft,
  MelAuthorFinalizeInput,
  MelAuthorGraphOutput,
  MelAuthorIntentInput,
  MelAuthorIntentOutput,
  MelAuthorLocateOutput,
  MelAuthorMutationOutput,
  MelAuthorPatchInput,
  MelAuthorSourceOutput,
  MelAuthorTool,
  MelAuthorWhyNotOutput,
  MelAuthorWorkspace,
} from "./types.js";

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

export function createMelAuthorTools(
  workspace: MelAuthorWorkspace,
): readonly MelAuthorTool<unknown, unknown>[] {
  const tools: readonly MelAuthorTool<unknown, unknown>[] = [
    {
      name: "readSource",
      description:
        "Read the current ephemeral workspace MEL source. Call this before editing.",
      jsonSchema: READ_SOURCE_SCHEMA,
      run: async () => ({ ok: true, output: workspace.readSource() }),
    } satisfies MelAuthorTool<unknown, MelAuthorSourceOutput>,
    {
      name: "replaceSource",
      description:
        "Replace the entire ephemeral workspace source. This does not touch the user's real source.",
      jsonSchema: REPLACE_SOURCE_SCHEMA,
      run: async (input) => {
        const source = readStringProperty(input, "source");
        if (source === null) {
          return {
            ok: false,
            kind: "invalid_input",
            message: "replaceSource requires { source: string }.",
          };
        }
        return workspace.replaceSource(source);
      },
    } satisfies MelAuthorTool<unknown, MelAuthorMutationOutput>,
    {
      name: "patchSource",
      description:
        "Patch a 1-based line/column range inside the ephemeral workspace source.",
      jsonSchema: PATCH_SOURCE_SCHEMA,
      run: async (input) => workspace.patchSource(input as MelAuthorPatchInput),
    } satisfies MelAuthorTool<unknown, MelAuthorMutationOutput>,
    {
      name: "build",
      description:
        "Build the current workspace source and return Manifesto diagnostics. Call after every source mutation.",
      jsonSchema: EMPTY_OBJECT_SCHEMA,
      run: async () => ({ ok: true, output: await workspace.build() }),
    } satisfies MelAuthorTool<unknown, MelAuthorBuildOutput>,
    {
      name: "inspectGraph",
      description:
        "Inspect the built schema graph for actions, state, computed nodes, and relationships. Requires a clean build of the current source.",
      jsonSchema: INSPECT_GRAPH_SCHEMA,
      run: async (input) => workspace.inspectGraph(readGraphOptions(input)),
    } satisfies MelAuthorTool<unknown, MelAuthorGraphOutput>,
    {
      name: "locateDeclaration",
      description:
        "Locate a declaration in the built source map and return span plus preview. Requires a clean build.",
      jsonSchema: LOCATE_SCHEMA,
      run: async (input) => {
        const target = readStringProperty(input, "target");
        if (target === null) {
          return {
            ok: false,
            kind: "invalid_input",
            message: "locateDeclaration requires { target: string }.",
          };
        }
        return workspace.locateDeclaration(target);
      },
    } satisfies MelAuthorTool<unknown, MelAuthorLocateOutput>,
    {
      name: "why",
      description:
        "Explain whether a bound action intent is admitted on the current workspace runtime. Requires a clean build.",
      jsonSchema: INTENT_SCHEMA,
      run: async (input) => workspace.why(input as MelAuthorIntentInput),
    } satisfies MelAuthorTool<unknown, MelAuthorExplanationOutput>,
    {
      name: "whyNot",
      description:
        "Return blockers for a bound action intent on the current workspace runtime. Requires a clean build.",
      jsonSchema: INTENT_SCHEMA,
      run: async (input) => workspace.whyNot(input as MelAuthorIntentInput),
    } satisfies MelAuthorTool<unknown, MelAuthorWhyNotOutput>,
    {
      name: "simulate",
      description:
        "Dry-run a bound action intent against the current workspace runtime without dispatching. Requires a clean build.",
      jsonSchema: INTENT_SCHEMA,
      run: async (input) => workspace.simulate(input as MelAuthorIntentInput),
    } satisfies MelAuthorTool<unknown, MelAuthorIntentOutput>,
    {
      name: "finalize",
      description:
        "Finalize the current workspace source as the proposed MEL draft. This builds once more and returns the full proposed source plus diagnostics.",
      jsonSchema: FINALIZE_SCHEMA,
      run: async (input) =>
        workspace.finalize(input as MelAuthorFinalizeInput | undefined),
    } satisfies MelAuthorTool<unknown, MelAuthorFinalDraft>,
  ];
  return tools;
}

function readStringProperty(input: unknown, key: string): string | null {
  if (input === null || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
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
