/**
 * Provider-visible tool contract for headless agent runtimes.
 *
 * A tool definition is pure metadata + a deterministic runner. Runtime
 * handles are injected by binding a narrow context, so the core runner
 * never needs to know whether a tool touches Manifesto, a file system,
 * a database, or an in-memory test double.
 */

export type JsonSchema = Record<string, unknown>;

export type ToolSpec = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchema;
  };
};

export type AgentToolSchema = {
  readonly description: string;
  readonly parameters: JsonSchema;
};

export type AgentToolSchemaMap = Record<string, AgentToolSchema>;

export type ToolRunOk<TOut> = {
  readonly ok: true;
  readonly output: TOut;
};

export type ToolRunErr = {
  readonly ok: false;
  readonly kind: "invalid_input" | "runtime_error";
  readonly message: string;
  readonly detail?: unknown;
};

export type ToolRunResult<TOut> = ToolRunOk<TOut> | ToolRunErr;

export type AgentTool<TIn, TOut, TCtx> = {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: JsonSchema;
  readonly run: (input: TIn, ctx: TCtx) => Promise<ToolRunResult<TOut>>;
};

export type BoundAgentTool = {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: JsonSchema;
  readonly run: (input: unknown) => Promise<ToolRunResult<unknown>>;
};

export type ToolRegistry = {
  readonly list: () => readonly BoundAgentTool[];
  readonly get: (name: string) => BoundAgentTool | undefined;
  readonly toToolSpecs: () => readonly ToolSpec[];
};

export function bindTool<TIn, TOut, TCtx>(
  tool: AgentTool<TIn, TOut, TCtx>,
  ctx: TCtx,
): BoundAgentTool {
  return {
    name: tool.name,
    description: tool.description,
    jsonSchema: tool.jsonSchema,
    run: (input) => tool.run(input as TIn, ctx),
  };
}

export function createToolRegistry(
  tools: readonly BoundAgentTool[],
): ToolRegistry {
  const list = [...tools];
  const byName = new Map<string, BoundAgentTool>();
  for (const tool of list) {
    if (byName.has(tool.name)) {
      throw new Error(
        `[agent-core] duplicate tool name: "${tool.name}"`,
      );
    }
    byName.set(tool.name, tool);
  }
  const specs: readonly ToolSpec[] = list.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema,
    },
  }));
  return {
    list: () => list,
    get: (name) => byName.get(name),
    toToolSpecs: () => specs,
  };
}

export function buildToolSchemaMap(
  registry: ToolRegistry,
): AgentToolSchemaMap {
  const out: AgentToolSchemaMap = {};
  for (const tool of registry.list()) {
    out[tool.name] = {
      description: tool.description,
      parameters: tool.jsonSchema,
    };
  }
  return out;
}

export async function executeToolLocally(
  registry: ToolRegistry,
  toolName: string,
  input: unknown,
): Promise<ToolRunResult<unknown>> {
  const tool = registry.get(toolName);
  if (tool === undefined) {
    return {
      ok: false,
      kind: "runtime_error",
      message: `unknown tool: ${toolName}`,
    };
  }
  try {
    return await tool.run(input);
  } catch (err) {
    return {
      ok: false,
      kind: "runtime_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function mergeToolRegistries(
  ...registries: readonly ToolRegistry[]
): ToolRegistry {
  return createToolRegistry(registries.flatMap((registry) => registry.list()));
}
