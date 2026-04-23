/**
 * Bridge between our `AgentTool` registry and the AI SDK.
 *
 * The split:
 *
 *   - Server receives **schemas** (description + JSON-schema
 *     parameters) and includes them in the `streamText` call so the
 *     model knows which tools exist. Server DOES NOT execute tools.
 *   - Client receives the same registry + **execute** functions.
 *     When the model issues a tool call, AI SDK's `onToolCall` fires
 *     on the client; this module dispatches the call against the
 *     local registry and returns the result. AI SDK then re-posts
 *     to the server with the tool result appended.
 *
 * Why the split: our tools mutate / read the Manifesto runtime,
 * which lives in the browser. If tools executed on the server we'd
 * have to ship the runtime up too. Keeping execute client-side is
 * the right abstraction.
 */
import type { BoundAgentTool, ToolRegistry } from "../tools/types.js";

/**
 * Server-safe schema shape. Sent in the POST body of every turn so
 * the server can pass it into `streamText({tools})`. Mirrors the
 * subset of AI SDK's tool shape that we actually need — description
 * + JSON schema for parameters. `execute` intentionally absent.
 */
export type AgentToolSchema = {
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

export type AgentToolSchemaMap = Record<string, AgentToolSchema>;

export function buildToolSchemaMap(registry: ToolRegistry): AgentToolSchemaMap {
  const out: AgentToolSchemaMap = {};
  for (const tool of registry.list()) {
    out[tool.name] = {
      description: tool.description,
      parameters: tool.jsonSchema,
    };
  }
  return out;
}

/**
 * Execute a tool locally against the bound registry, returning the
 * JSON-serializable result AI SDK expects. Failures are flattened
 * into an `{ok:false,...}` payload so the model still sees a valid
 * tool result and can adjust — rather than a thrown error that
 * aborts the whole stream.
 */
export async function executeToolLocally(
  registry: ToolRegistry,
  toolName: string,
  input: unknown,
): Promise<unknown> {
  const tool: BoundAgentTool | undefined = registry.get(toolName);
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
