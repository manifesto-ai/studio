import { describe, expect, it } from "vitest";
import {
  createMemoryTranscriptStore,
  projectRecentTurns,
  type AgentMessage,
} from "../index.js";

describe("transcript helpers", () => {
  it("returns a copy from the memory store", async () => {
    const store = createMemoryTranscriptStore();
    await store.append({ role: "user", content: "first" });

    const read = store.read() as AgentMessage[];
    read.push({ role: "user", content: "mutated" });

    expect(store.read()).toEqual([{ role: "user", content: "first" }]);
  });

  it("projects the latest settled turns newest-first", () => {
    const turns = projectRecentTurns(
      [
        { role: "user", content: "first" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "inspect", input: {} }],
        },
        {
          role: "tool",
          toolCallId: "c1",
          toolName: "inspect",
          output: { ok: true },
        },
        { role: "assistant", content: "first answer", toolCalls: [] },
        { role: "user", content: "second" },
        { role: "assistant", content: "second answer", toolCalls: [] },
        { role: "user", content: "third" },
        { role: "assistant", content: "third answer", toolCalls: [] },
      ],
      { limit: 2 },
    );

    expect(turns).toEqual([
      {
        turnId: "turn-3",
        userPrompt: "third",
        assistantExcerpt: "third answer",
        toolCount: 0,
      },
      {
        turnId: "turn-2",
        userPrompt: "second",
        assistantExcerpt: "second answer",
        toolCount: 0,
      },
    ]);
  });
});
