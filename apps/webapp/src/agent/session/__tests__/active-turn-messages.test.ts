import { describe, expect, it } from "vitest";
import {
  buildActiveTurnMessages,
} from "../active-turn-messages.js";
import type {
  AgentMessageLike,
  AgentMessagePartLike,
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
  parts: readonly AgentMessagePartLike[] = [{ type: "text", text: "" }],
): AgentMessageLike {
  return {
    id,
    role: "assistant",
    parts,
  };
}

describe("buildActiveTurnMessages", () => {
  it("sends only the latest user turn", () => {
    const messages = [
      user("u1", "old"),
      assistant("a1", [{ type: "text", text: "old answer" }]),
      user("u2", "current"),
    ];

    expect(buildActiveTurnMessages(messages).map((m) => m.id)).toEqual(["u2"]);
  });

  it("keeps assistant tool parts from the active turn for continuation", () => {
    const messages = [
      user("u1", "old"),
      assistant("a1", [{ type: "text", text: "old answer" }]),
      user("u2", "current"),
      assistant("a2", [
        { type: "tool-inspectFocus" },
        { type: "text", text: "working" },
      ]),
    ];

    expect(buildActiveTurnMessages(messages).map((m) => m.id)).toEqual([
      "u2",
      "a2",
    ]);
  });

  it("falls back to the original messages when no user turn exists", () => {
    const messages = [assistant("a1", [{ type: "text", text: "hello" }])];

    expect(buildActiveTurnMessages(messages)).toEqual(messages);
  });
});
