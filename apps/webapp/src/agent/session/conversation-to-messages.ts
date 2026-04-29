/**
 * Convert the AgentSession ConversationProjection into the UIMessage[]
 * shape the AI SDK transport expects.
 *
 * Convention (matches `buildActiveTurnMessages`): only the active
 * (in-flight or just-settled) turn is sent. Older context comes
 * through the system prompt's recent-turn tail or via the
 * `inspectConversation` tool. This keeps prompt size bounded.
 *
 * Within the active turn:
 *   - The user prompt becomes a single user UIMessage with one
 *     text part.
 *   - If any tool steps already settled in this turn, we also emit
 *     an assistant UIMessage with `tool-${name}` parts in
 *     `output-available` state. The model needs these to know which
 *     tools it called and what they returned, so the next step's
 *     response is consistent with the trace.
 *   - We do NOT include the partial assistant text from the
 *     in-flight stream — text deltas are kept host-side only (per
 *     the streaming-text decision in step 5a). On a subsequent
 *     model call after a tool result, the assistant message ends
 *     with tool parts but no text; that's the standard shape the
 *     server-side `streamText` understands.
 *
 * Boundary note: this lives in `agent/session/` and pulls UIMessage
 * from `ai`, which the future-core boundary allows.
 */
import type { UIMessage, UIMessagePart } from "ai";
import type { AgentMessageLike } from "./recent-turns.js";
import type {
  ConversationProjection,
  TurnEntry,
} from "./agent-session-types.js";

export function buildUiMessagesForTransport(
  conversation: ConversationProjection,
): UIMessage[] {
  if (conversation.turns.length === 0) return [];
  const active = conversation.turns[conversation.turns.length - 1]!;
  const messages: UIMessage[] = [];
  messages.push(buildUserMessage(active));
  const assistant = buildAssistantMessageOrNull(active);
  if (assistant !== null) messages.push(assistant);
  return messages;
}

function buildUserMessage(turn: TurnEntry): UIMessage {
  return {
    id: `${turn.turnId}-user`,
    role: "user",
    parts: [{ type: "text", text: turn.userText }],
  };
}

function buildAssistantMessageOrNull(turn: TurnEntry): UIMessage | null {
  const parts: UIMessagePart<never, never>[] = [];
  for (const step of turn.steps) {
    if (step.kind !== "tool-call") continue;
    parts.push(buildToolPart(step));
  }
  if (turn.settledText !== null && turn.settledText !== "") {
    parts.push({ type: "text", text: turn.settledText, state: "done" });
  }
  if (parts.length === 0) return null;
  return {
    id: `${turn.turnId}-assistant`,
    role: "assistant",
    parts: parts as UIMessage["parts"],
  };
}

function buildToolPart(step: {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown | null;
  readonly outcome: "ok" | "blocked" | "error" | null;
}): UIMessagePart<never, never> {
  // Pending tool call — the tool was emitted by the model but the
  // executor hasn't dispatched recordToolResult yet. AI SDK
  // represents this as state="input-available". We never expect to
  // see this in the message we ship to the model — the driver only
  // re-invokes the model after a tool RESULT, so by the time
  // buildMessages runs the step has output. Defensive code just in
  // case.
  if (step.output === null || step.outcome === null) {
    return {
      type: `tool-${step.toolName}`,
      toolCallId: step.callId,
      state: "input-available",
      input: step.input,
    } as unknown as UIMessagePart<never, never>;
  }
  if (step.outcome === "error" || step.outcome === "blocked") {
    return {
      type: `tool-${step.toolName}`,
      toolCallId: step.callId,
      state: "output-error",
      input: step.input,
      errorText: extractErrorText(step.output),
    } as unknown as UIMessagePart<never, never>;
  }
  return {
    type: `tool-${step.toolName}`,
    toolCallId: step.callId,
    state: "output-available",
    input: step.input,
    output: step.output,
  } as unknown as UIMessagePart<never, never>;
}

/**
 * Convert the entire ConversationProjection into the lightweight
 * `AgentMessageLike[]` shape used by `buildRecentTurnsFromMessages`
 * and `inspectConversation`. Unlike the transport converter above,
 * this includes all settled turns so the recent-turn tail and the
 * conversation-inspect tool get the full transcript.
 */
export function conversationToAgentMessages(
  conversation: ConversationProjection,
): AgentMessageLike[] {
  const messages: AgentMessageLike[] = [];
  for (const turn of conversation.turns) {
    messages.push({
      id: `${turn.turnId}-user`,
      role: "user",
      parts: [{ type: "text", text: turn.userText }],
    });
    const assistantParts: { readonly type: string; readonly text?: string }[] = [];
    for (const step of turn.steps) {
      if (step.kind !== "tool-call") continue;
      assistantParts.push({ type: `tool-${step.toolName}` });
    }
    if (turn.settledText !== null && turn.settledText !== "") {
      assistantParts.push({ type: "text", text: turn.settledText });
    }
    if (assistantParts.length > 0) {
      messages.push({
        id: `${turn.turnId}-assistant`,
        role: "assistant",
        parts: assistantParts,
      });
    }
  }
  return messages;
}

function extractErrorText(output: unknown): string {
  if (output === null || typeof output !== "object") return String(output);
  const top = output as Record<string, unknown>;
  if (typeof top.errorText === "string") return top.errorText;
  if (typeof top.message === "string") return top.message;
  const inner = top.output as Record<string, unknown> | undefined;
  if (inner !== undefined) {
    if (typeof inner.summary === "string") return inner.summary;
    if (typeof inner.error === "string") return inner.error;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "tool error";
  }
}
