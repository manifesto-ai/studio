/**
 * Tool contract shared between the orchestrator and all deterministic
 * wrappers under `agent/tools/`. Kept React-free and SDK-free so this
 * module stays extractable into a standalone package when AG-S1 fires.
 *
 * Design notes
 * ------------
 * A tool is the *provider-visible* side of a Manifesto capability. The
 * orchestrator advertises a list of tool names + JSON schemas to the
 * LLM via `ToolSpec[]` (see `../provider/types.ts`). When the model
 * emits a `tool_call`, the orchestrator looks up the `AgentTool` by
 * name, parses `argumentsJson` into `TIn`, and calls `run(input, ctx)`.
 * The tool returns a plain JSON-serialisable value — the orchestrator
 * JSON-encodes it into a `ToolMessage` and hands control back to the
 * LLM.
 *
 * The tool implementation must be:
 *   - pure w.r.t. DOM/React (no `window`, no hooks, no refs),
 *   - deterministic given `ctx` (we pass the StudioCore surface in),
 *   - safe to stringify (every field in `TOut` must be JSON-roundtrippable).
 *
 * `ctx` is the narrow read-only seam. We deliberately do *not* pass
 * the full StudioCore here — only the methods a tool needs. Each tool
 * re-declares the slice it depends on via its own `Context` type so
 * a test stub can mock the minimum surface. See `./legality.ts` for
 * the first example.
 */
/**
 * JSON-schema shape advertised to the LLM. Mirrors the OpenAI
 * function-tool payload so the AI SDK's `tool()` factory can accept
 * it directly. Kept here (not imported from a provider module)
 * because the provider layer moved to the Vercel AI SDK and we no
 * longer maintain our own transport types.
 */
export type ToolSpec = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
};

/**
 * A JSON-shaped result from a tool run. We allow the loose shape
 * (`unknown`) at the contract boundary and rely on each tool's
 * `TOut` generic to pin the concrete shape for callers.
 */
export type ToolRunOk<TOut> = {
  readonly ok: true;
  readonly output: TOut;
};

export type ToolRunErr = {
  readonly ok: false;
  /**
   * Error kind the orchestrator should surface to the LLM verbatim.
   * Split into input-validation errors vs. unexpected runtime errors
   * so the model can self-correct on the former (e.g. by re-issuing
   * the call with a repaired argument shape) without giving up.
   */
  readonly kind: "invalid_input" | "runtime_error";
  readonly message: string;
  /** Optional structured detail — also JSON-serialisable. */
  readonly detail?: unknown;
};

export type ToolRunResult<TOut> = ToolRunOk<TOut> | ToolRunErr;

/**
 * A tool definition. `name` must match the string the LLM sees in
 * `ToolSpec.function.name`. `jsonSchema` describes `TIn` — the
 * orchestrator ships it to the provider and also uses it to validate
 * the model's emitted arguments before calling `run`. `TCtx` is the
 * tool's private context type: each tool may declare its own slice
 * independently of other tools in the registry, since tools are
 * **bound** to a concrete context at registration time (see
 * `bindTool` below). This lets two tools reference different runtimes
 * (e.g. `dispatch` on the user core vs. `studioDispatch` on the
 * studio core) without forcing a merged context union that would
 * collide on field names.
 */
export type AgentTool<TIn, TOut, TCtx> = {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly run: (input: TIn, ctx: TCtx) => Promise<ToolRunResult<TOut>>;
};

/**
 * A tool after its context has been captured. The orchestrator sees
 * only this shape — context-free `run(input)` — so adding new tools
 * with their own unrelated contexts doesn't ripple through the
 * orchestrator's type parameters.
 */
export type BoundAgentTool = {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly run: (input: unknown) => Promise<ToolRunResult<unknown>>;
};

/**
 * Bind a tool to its context, yielding a `BoundAgentTool` the
 * registry can accept. Call once at construction time — the captured
 * ctx is fixed for the bound tool's lifetime. Use a new binding if
 * the underlying core changes identity (e.g. on project switch);
 * React consumers can do this inside a `useMemo` keyed on the core.
 */
export function bindTool<TIn, TOut, TCtx>(
  tool: AgentTool<TIn, TOut, TCtx>,
  ctx: TCtx,
): BoundAgentTool {
  return {
    name: tool.name,
    description: tool.description,
    jsonSchema: tool.jsonSchema,
    // Narrow the input via the tool's own validation inside `run`; the
    // orchestrator already JSON-parses the model's `argumentsJson` and
    // does a shallow shape check, so treating `input` as `unknown` at
    // the boundary is honest.
    run: (input) => tool.run(input as TIn, ctx),
  };
}

/**
 * A registry is a lookup by tool name + a projection into the
 * provider-visible `ToolSpec[]`.
 */
export type ToolRegistry = {
  readonly list: () => readonly BoundAgentTool[];
  readonly get: (name: string) => BoundAgentTool | undefined;
  readonly toToolSpecs: () => readonly ToolSpec[];
};

export function createToolRegistry(
  tools: readonly BoundAgentTool[],
): ToolRegistry {
  const byName = new Map<string, BoundAgentTool>();
  for (const t of tools) {
    if (byName.has(t.name)) {
      throw new Error(
        `[agent/tools] duplicate tool name: "${t.name}" — tool names must be unique`,
      );
    }
    byName.set(t.name, t);
  }
  const specs: readonly ToolSpec[] = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.jsonSchema,
    },
  }));
  return {
    list: () => tools,
    get: (name) => byName.get(name),
    toToolSpecs: () => specs,
  };
}
