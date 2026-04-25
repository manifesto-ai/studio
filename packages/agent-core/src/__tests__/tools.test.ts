import { describe, expect, it } from "vitest";
import {
  bindTool,
  buildToolSchemaMap,
  createToolRegistry,
  executeToolLocally,
  type AgentTool,
} from "../tools.js";

const echoTool: AgentTool<
  { readonly value: string },
  { readonly echoed: string },
  { readonly prefix: string }
> = {
  name: "echo",
  description: "Echo a value.",
  jsonSchema: {
    type: "object",
    required: ["value"],
    properties: { value: { type: "string" } },
  },
  run: async (input, context) => ({
    ok: true,
    output: { echoed: `${context.prefix}${input.value}` },
  }),
};

describe("ToolRegistry", () => {
  it("rejects duplicate tool names", () => {
    const bound = bindTool(echoTool, { prefix: "" });
    expect(() => createToolRegistry([bound, bound])).toThrow(/duplicate/);
  });

  it("projects schema maps and executes bound tools", async () => {
    const registry = createToolRegistry([
      bindTool(echoTool, { prefix: ">" }),
    ]);

    expect(buildToolSchemaMap(registry).echo?.description).toBe(
      "Echo a value.",
    );

    const result = await executeToolLocally(registry, "echo", {
      value: "hello",
    });
    expect(result).toEqual({
      ok: true,
      output: { echoed: ">hello" },
    });
  });

  it("returns structured runtime errors for unknown tools", async () => {
    const registry = createToolRegistry([]);
    const result = await executeToolLocally(registry, "missing", {});
    expect(result).toEqual({
      ok: false,
      kind: "runtime_error",
      message: "unknown tool: missing",
    });
  });
});
