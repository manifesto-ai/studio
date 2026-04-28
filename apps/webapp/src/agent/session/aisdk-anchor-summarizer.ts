/**
 * AI SDK-backed AnchorSummarizer.
 *
 * Wraps a DefaultChatTransport (configured with a summarization
 * system prompt and no tools) into the AnchorSummarizer interface
 * the AgentSessionAnchorEffect consumes.
 *
 * Why a separate transport? The agent's main transport is wired
 * with `prepareSendMessagesRequest` that produces the FULL agent
 * system prompt + admitted tool schema map. Summarization needs
 * neither — it's a one-shot text completion against a focused
 * summarization prompt. The host gives this summarizer its own
 * narrow transport so the request shape stays clean.
 *
 * Boundary discipline: lives in agent/session/ (future-core). The
 * `ai` package is allowed by the boundary check.
 */
import type { ChatTransport, UIMessage } from "ai";
import {
  buildAnchorSummaryPrompt,
  type AnchorSummarizer,
} from "./agent-session-anchor.js";

export type AiSdkAnchorSummarizerDeps = {
  readonly transport: ChatTransport<UIMessage>;
  /** Override the user-prompt builder. Defaults to buildAnchorSummaryPrompt. */
  readonly buildPrompt?: typeof buildAnchorSummaryPrompt;
  readonly idPrefix?: string;
};

export function createAiSdkAnchorSummarizer(
  deps: AiSdkAnchorSummarizerDeps,
): AnchorSummarizer {
  const buildPrompt = deps.buildPrompt ?? buildAnchorSummaryPrompt;
  const idPrefix = deps.idPrefix ?? "anchor";
  return {
    summarize: async ({ turns, priorAnchor, signal }) => {
      const promptText = buildPrompt(turns, priorAnchor);
      const requestId = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const messages: UIMessage[] = [
        {
          id: requestId,
          role: "user",
          parts: [{ type: "text", text: promptText }],
        },
      ];
      const stream = await deps.transport.sendMessages({
        chatId: requestId,
        messages,
        abortSignal: signal,
        trigger: "submit-message",
        messageId: undefined,
      });

      let accumulated = "";
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (chunk.type === "text-delta") {
            accumulated += chunk.delta;
            continue;
          }
          if (chunk.type === "error") {
            throw new Error(chunk.errorText);
          }
          if (chunk.type === "abort") {
            throw new Error(chunk.reason ?? "anchor summarization aborted");
          }
          // ignore non-text chunks (text-start/end, reasoning, etc.)
        }
      } finally {
        reader.releaseLock();
      }
      return accumulated.trim();
    },
  };
}

export const ANCHOR_SUMMARIZATION_SYSTEM_PROMPT = `
You are a conversation summarizer for an agent's long-term memory.

Your job: produce ONE concise paragraph (2-4 sentences) capturing the
SUBSTANCE of the conversation window provided. Focus on:
- Main topics or goals the user is exploring
- Decisions reached, actions taken, or tools the agent used to meaningful effect
- Open threads, unresolved questions, or recurring themes

Style:
- Plain prose, no bullet points, no preamble.
- Refer to the user as "the user" and the agent in third person.
- Preserve names of MEL entities (actions, fields, computed) verbatim
  when they appear, since the agent's later turns will recognise them.

If a "prior anchor" section is provided, INCORPORATE its content into
your summary so the new summary supersedes the old one (rather than
listing both). The output must be self-contained.

Return ONLY the summary text. No headings, no labels.
`.trim();
