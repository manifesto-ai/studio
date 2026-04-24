import { describe, expect, it } from "vitest";
import {
  buildRecentTurnsFromMessages,
  type AgentMessageLike,
} from "../recent-turns.js";

function user(id: string, text: string): AgentMessageLike {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistant(
  id: string,
  text: string,
  toolCount = 0,
): AgentMessageLike {
  return {
    id,
    role: "assistant",
    parts: [
      ...Array.from({ length: toolCount }, (_, i) => ({
        type: `tool-inspect${i}`,
      })),
      { type: "text", text },
    ],
  };
}

describe("buildRecentTurnsFromMessages", () => {
  it("keeps the latest settled turns, newest first", () => {
    const messages: AgentMessageLike[] = [];
    for (let i = 1; i <= 7; i++) {
      messages.push(user(`u${i}`, `prompt ${i}`));
      messages.push(assistant(`a${i}`, `answer ${i}`, i % 2));
    }

    const turns = buildRecentTurnsFromMessages(messages, { limit: 5 });

    expect(turns.map((t) => t.turnId)).toEqual(["u7", "u6", "u5", "u4", "u3"]);
    expect(turns.map((t) => t.userPrompt)).toEqual([
      "prompt 7",
      "prompt 6",
      "prompt 5",
      "prompt 4",
      "prompt 3",
    ]);
  });

  it("ignores in-flight user messages without a following assistant reply", () => {
    const turns = buildRecentTurnsFromMessages([
      user("u1", "done"),
      assistant("a1", "settled"),
      user("u2", "in flight"),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.turnId).toBe("u1");
  });

  it("caps assistant excerpts and counts tool parts", () => {
    const turns = buildRecentTurnsFromMessages(
      [user("u1", "question"), assistant("a1", "one two three four", 2)],
      { excerptCap: 8 },
    );

    expect(turns[0]).toMatchObject({
      assistantExcerpt: "one t...",
      toolCount: 2,
    });
  });
});
