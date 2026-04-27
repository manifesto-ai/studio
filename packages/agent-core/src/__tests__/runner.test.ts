import { describe, expect, it } from "vitest";
import {
  bindTool,
  createAgentRunner,
  createMemoryTranscriptStore,
  createStaticIdentityProvider,
  createToolRegistry,
  ephemeralTurnPolicy,
  type AgentTool,
  type ModelAdapter,
  type ModelEvent,
} from "../index.js";

const addTool: AgentTool<
  { readonly a: number; readonly b: number },
  { readonly sum: number },
  Record<string, never>
> = {
  name: "add",
  description: "Add two numbers.",
  jsonSchema: {
    type: "object",
    required: ["a", "b"],
    properties: {
      a: { type: "number" },
      b: { type: "number" },
    },
  },
  run: async (input) => ({
    ok: true,
    output: { sum: input.a + input.b },
  }),
};

function scriptedModel(
  steps: readonly (readonly ModelEvent[])[],
): ModelAdapter {
  let index = 0;
  return {
    name: "scripted",
    stream: async function* () {
      const events = steps[index] ?? [];
      index += 1;
      for (const event of events) yield event;
    },
  };
}

describe("AgentRunner", () => {
  it("runs a tool step, appends the result, then finishes on text", async () => {
    const transcript = createMemoryTranscriptStore();
    const runner = createAgentRunner({
      id: "test-agent",
      createTurnId: () => "turn-1",
      identity: createStaticIdentityProvider("system"),
      tools: createToolRegistry([bindTool(addTool, {})]),
      model: scriptedModel([
        [
          {
            type: "tool_call",
            call: {
              id: "call-1",
              name: "add",
              input: { a: 2, b: 3 },
            },
          },
          { type: "finish", reason: "tool-calls" },
        ],
        [
          { type: "text_delta", text: "sum is 5" },
          { type: "finish", reason: "stop" },
        ],
      ]),
      turnPolicy: ephemeralTurnPolicy({ maxSteps: 4 }),
      transcript,
    });

    const events = [];
    for await (const event of runner.runTurn({ input: "add these" })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toContain("tool_result");
    expect(events.at(-1)).toEqual({
      type: "turn_end",
      turnId: "turn-1",
      reason: "completed",
    });
    expect(transcript.read()).toEqual([
      { role: "user", content: "add these" },
      {
        role: "assistant",
        content: "",
        reasoning: undefined,
        toolCalls: [
          { id: "call-1", name: "add", input: { a: 2, b: 3 } },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        toolName: "add",
        output: { ok: true, output: { sum: 5 } },
      },
      {
        role: "assistant",
        content: "sum is 5",
        reasoning: undefined,
        toolCalls: [],
      },
    ]);
  });
});
