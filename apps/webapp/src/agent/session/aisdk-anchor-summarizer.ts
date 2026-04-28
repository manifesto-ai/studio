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
  type AnchorSummary,
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
      return parseAnchorResponse(accumulated.trim());
    },
  };
}

/**
 * Parse the model's structured response. Expected shape (per the
 * system prompt): two sections separated by labels —
 *   TOPIC: <one-line headline>
 *   SUMMARY: <2-4 sentences>
 *
 * Models occasionally drift (extra preamble, reordered labels,
 * markdown). The parser is lenient: it pulls labelled lines first,
 * falling back to "first line is topic, rest is summary" if labels
 * are missing.
 */
export function parseAnchorResponse(raw: string): AnchorSummary {
  const text = raw.trim();
  if (text === "") return { topic: "", summary: "" };

  const topicMatch = /^\s*TOPIC\s*:\s*(.+?)\s*$/im.exec(text);
  const summaryMatch = /^\s*SUMMARY\s*:\s*([\s\S]+?)\s*$/im.exec(text);

  if (topicMatch !== null && summaryMatch !== null) {
    return {
      topic: topicMatch[1]!.trim(),
      summary: summaryMatch[1]!.trim(),
    };
  }

  // Fallback: first non-empty line as topic, remainder as summary.
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { topic: "", summary: "" };
  if (lines.length === 1) {
    // Truncate as topic; reuse same text as summary so the agent has
    // something to read either way.
    const topic = lines[0]!.slice(0, 80);
    return { topic, summary: lines[0]! };
  }
  return {
    topic: lines[0]!.slice(0, 80),
    summary: lines.slice(1).join(" ").trim(),
  };
}

export const ANCHOR_SUMMARIZATION_SYSTEM_PROMPT = `
You are a memory-anchor builder for an agent's long-term recall.

Your job: produce a navigable index entry for a window of past
conversation turns. The output has TWO labelled sections.

Output format (LITERAL — return only these two lines, no preamble):

TOPIC: <one-line headline phrase, 3-8 words, captures the search
keyword most likely to retrieve this anchor later>
SUMMARY: <2-4 sentences capturing the substance — main topics or
goals, decisions reached, tools used, open threads — written so
the agent can read it later and decide whether the topic is
relevant to a new query>

Style:
- Plain prose, no bullet points.
- Refer to the user as "the user" and the agent in third person.
- Preserve names of MEL entities (actions, fields, computed) verbatim.

If a "prior anchor" section is provided, INCORPORATE its content
into the new summary so the new anchor supersedes the old one
rather than fragmenting memory. The output must be self-contained.
`.trim();
