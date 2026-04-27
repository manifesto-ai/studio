import { describe, expect, it } from "vitest";
import {
  buildAiSdkToolSet,
  normalizeAiSdkToolChoice,
  toAiSdkModelMessages,
} from "../index.js";
import type { AgentMessage, ToolSpec } from "@manifesto-ai/agent-core";

const specs: readonly ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "inspect",
      description: "Inspect something.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

describe("AI SDK adapter helpers", () => {
  it("builds AI SDK tool sets from core tool specs", () => {
    const tools = buildAiSdkToolSet(specs);
    expect(tools.inspect?.description).toBe("Inspect something.");
  });

  it("validates specific toolChoice names", () => {
    const tools = buildAiSdkToolSet(specs);
    expect(
      normalizeAiSdkToolChoice(
        { type: "tool", toolName: "inspect" },
        tools,
      ),
    ).toEqual({
      kind: "ok",
      value: { type: "tool", toolName: "inspect" },
    });
    expect(
      normalizeAiSdkToolChoice({ type: "tool", toolName: "missing" }, tools),
    ).toEqual({
      kind: "error",
      message: 'invalid toolChoice: unknown tool "missing".',
    });
  });

  it("converts core messages to AI SDK model messages", () => {
    const messages: readonly AgentMessage[] = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "inspect", input: {} }],
      },
      {
        role: "tool",
        toolCallId: "c1",
        toolName: "inspect",
        output: { ok: true, output: { value: 1 } },
      },
    ];

    expect(toAiSdkModelMessages(messages)).toEqual([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "inspect",
            input: {},
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "inspect",
            output: { ok: true, output: { value: 1 } },
          },
        ],
      },
    ]);
  });
});
