import type { AgentMessageLike } from "./recent-turns.js";

/**
 * Keep only the currently active user turn for model transport.
 *
 * The UI retains the full transcript for rendering and inspectConversation,
 * while the model request gets the latest user message plus any assistant/tool
 * parts produced after it. Older turns are available through the compact prompt
 * tail and the explicit inspectConversation tool.
 */
export function buildActiveTurnMessages<T extends AgentMessageLike>(
  messages: readonly T[],
): readonly T[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return messages.slice(i);
    }
  }
  return messages;
}
