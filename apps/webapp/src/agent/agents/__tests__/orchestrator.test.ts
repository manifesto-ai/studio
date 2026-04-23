/**
 * Orchestrator tests — stub the provider with a scripted reply
 * sequence and watch the loop:
 *
 *   1. Plain terminal reply (no tool use).
 *   2. Single tool call → tool reply → terminal reply.
 *   3. Two tool calls in one assistant turn (batched) → two tool
 *      replies in one pass → terminal reply.
 *   4. maxToolUses cap triggers a synthetic terminal message.
 *   5. Unknown tool name returns a runtime_error ToolMessage.
 *   6. Malformed JSON arguments return invalid_input ToolMessage.
 */
import { describe, expect, it } from "vitest";
import { runOrchestrator, type OrchestratorStep } from "../orchestrator.js";
import type {
  ChatRequest,
  ChatResponse,
  LlmProvider,
} from "../../provider/types.js";
import {
  bindTool,
  createToolRegistry,
  type AgentTool,
} from "../../tools/types.js";

type CtxStub = { readonly traced: string[] };

function scripted(responses: readonly ChatResponse[]): {
  readonly provider: LlmProvider;
  readonly calls: ChatRequest[];
} {
  let i = 0;
  const calls: ChatRequest[] = [];
  const provider: LlmProvider = {
    name: "scripted",
    modelId: "test-model",
    chat: async (req) => {
      calls.push(req);
      const r = responses[i];
      i += 1;
      if (r === undefined) {
        throw new Error(`scripted provider ran out of responses at call ${i}`);
      }
      return r;
    },
  };
  return { provider, calls };
}

function echoTool(): AgentTool<{ readonly tag: string }, { echoed: string }, CtxStub> {
  return {
    name: "echo",
    description: "Echo back a tag.",
    jsonSchema: {
      type: "object",
      required: ["tag"],
      properties: { tag: { type: "string" } },
    },
    run: async (input, ctx) => {
      ctx.traced.push(input.tag);
      return { ok: true, output: { echoed: input.tag } };
    },
  };
}

function makeRegistry(
  ctx: CtxStub,
): ReturnType<typeof createToolRegistry> {
  return createToolRegistry([bindTool(echoTool(), ctx)]);
}

describe("orchestrator — terminal reply without tool use", () => {
  it("returns the first assistant message with no tool calls", async () => {
    const { provider, calls } = scripted([
      {
        message: { role: "assistant", content: "hi there" },
      },
    ]);
    const res = await runOrchestrator({
      userPrompt: "hello",
      provider,
      registry: makeRegistry({ traced: [] }),
    });
    expect(res.toolUses).toBe(0);
    expect(res.stoppedAtCap).toBe(false);
    expect(res.finalMessage.content).toBe("hi there");
    expect(calls).toHaveLength(1);
    expect(calls[0].tools?.length).toBe(1);
    expect(calls[0].tools?.[0]?.function.name).toBe("echo");
  });
});

describe("orchestrator — single tool call round trip", () => {
  it("runs the tool, appends a ToolMessage, re-queries the LLM", async () => {
    const { provider, calls } = scripted([
      {
        message: {
          role: "assistant",
          toolCalls: [
            {
              id: "call_1",
              name: "echo",
              argumentsJson: '{"tag":"alpha"}',
            },
          ],
        },
      },
      { message: { role: "assistant", content: "got it" } },
    ]);
    const ctx: CtxStub = { traced: [] };
    const res = await runOrchestrator({
      userPrompt: "say alpha",
      provider,
      registry: makeRegistry(ctx),
    });
    expect(res.finalMessage.content).toBe("got it");
    expect(res.toolUses).toBe(1);
    expect(ctx.traced).toEqual(["alpha"]);

    // Second LLM call should carry: user → assistant(tool_call) → tool
    const secondCall = calls[1];
    expect(secondCall.messages).toHaveLength(3);
    const toolMsg = secondCall.messages[2];
    expect(toolMsg.role).toBe("tool");
    if (toolMsg.role !== "tool") return;
    expect(toolMsg.toolCallId).toBe("call_1");
    const parsed = JSON.parse(toolMsg.content) as {
      ok: boolean;
      output: { echoed: string };
    };
    expect(parsed).toEqual({ ok: true, output: { echoed: "alpha" } });

    const kinds = res.trace.map((s) => s.kind);
    expect(kinds).toEqual(["llm", "tool", "llm"]);
  });
});

describe("orchestrator — batched tool calls in one assistant turn", () => {
  it("dispatches all calls before issuing the next LLM request", async () => {
    const { provider, calls } = scripted([
      {
        message: {
          role: "assistant",
          toolCalls: [
            { id: "c1", name: "echo", argumentsJson: '{"tag":"a"}' },
            { id: "c2", name: "echo", argumentsJson: '{"tag":"b"}' },
          ],
        },
      },
      { message: { role: "assistant", content: "done" } },
    ]);
    const ctx: CtxStub = { traced: [] };
    const res = await runOrchestrator({
      userPrompt: "two",
      provider,
      registry: makeRegistry(ctx),
    });
    expect(res.toolUses).toBe(2);
    expect(ctx.traced).toEqual(["a", "b"]);
    // Only 2 LLM calls: one for the batched request, one terminal.
    expect(calls).toHaveLength(2);
    // Second call carries user + assistant(2 tool_calls) + 2 tool msgs
    expect(calls[1].messages).toHaveLength(4);
  });
});

describe("orchestrator — cap", () => {
  it("stops at maxToolUses and returns a synthetic terminal message", async () => {
    const toolCallSeq = {
      message: {
        role: "assistant" as const,
        toolCalls: [
          { id: "c", name: "echo", argumentsJson: '{"tag":"x"}' },
        ],
      },
    };
    const { provider } = scripted([
      toolCallSeq,
      toolCallSeq,
      toolCallSeq, // never reached
    ]);
    const ctx: CtxStub = { traced: [] };
    const res = await runOrchestrator({
      userPrompt: "loop",
      provider,
      registry: makeRegistry(ctx),
      maxToolUses: 2,
    });
    expect(res.stoppedAtCap).toBe(true);
    expect(res.toolUses).toBe(2);
    expect(res.finalMessage.content).toContain("tool-use cap of 2");
  });
});

describe("orchestrator — error paths inside a tool call", () => {
  it("returns a structured runtime_error ToolMessage for unknown tool", async () => {
    const { provider, calls } = scripted([
      {
        message: {
          role: "assistant",
          toolCalls: [
            { id: "c1", name: "missingTool", argumentsJson: "{}" },
          ],
        },
      },
      { message: { role: "assistant", content: "ok" } },
    ]);
    await runOrchestrator({
      userPrompt: "?",
      provider,
      registry: makeRegistry({ traced: [] }),
    });
    const toolMsg = calls[1].messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    if (toolMsg?.role !== "tool") return;
    const parsed = JSON.parse(toolMsg.content) as { kind?: string };
    expect(parsed.kind).toBe("runtime_error");
  });

  it("returns invalid_input ToolMessage for unparsable JSON arguments", async () => {
    const { provider, calls } = scripted([
      {
        message: {
          role: "assistant",
          toolCalls: [
            { id: "c1", name: "echo", argumentsJson: "not json" },
          ],
        },
      },
      { message: { role: "assistant", content: "ok" } },
    ]);
    await runOrchestrator({
      userPrompt: "?",
      provider,
      registry: makeRegistry({ traced: [] }),
    });
    const toolMsg = calls[1].messages.find((m) => m.role === "tool");
    if (toolMsg?.role !== "tool") return;
    const parsed = JSON.parse(toolMsg.content) as { kind?: string };
    expect(parsed.kind).toBe("invalid_input");
  });
});

describe("orchestrator — onStep observer", () => {
  it("emits llm + tool steps in order", async () => {
    const { provider } = scripted([
      {
        message: {
          role: "assistant",
          toolCalls: [
            { id: "c1", name: "echo", argumentsJson: '{"tag":"a"}' },
          ],
        },
      },
      { message: { role: "assistant", content: "final" } },
    ]);
    const observed: OrchestratorStep[] = [];
    await runOrchestrator({
      userPrompt: "?",
      provider,
      registry: makeRegistry({ traced: [] }),
      onStep: (s) => observed.push(s),
    });
    expect(observed.map((s) => s.kind)).toEqual(["llm", "tool", "llm"]);
  });
});
