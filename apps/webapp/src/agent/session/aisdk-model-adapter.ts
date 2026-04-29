/**
 * AI SDK-backed ModelAdapter.
 *
 * Wraps the AI SDK's `DefaultChatTransport.sendMessages` so the
 * AgentSession driver can reach the existing `/api/agent/chat`
 * server route (which still uses `streamText` server-side) without
 * pulling in `useChat` on the client.
 *
 * Translation layer:
 *   AI SDK UIMessageChunk          → ModelStreamEvent
 *   ────────────────────────────   ───────────────────
 *   `text-delta`                   → `text-delta`
 *   `tool-input-available`         → `tool-call` (terminal)
 *   `tool-input-error`             → `failed`   (terminal)
 *   `error`                        → `failed`   (terminal)
 *   `abort`                        → `failed`   (terminal)
 *   `finish` (no prior tool call)  → `settled`  (terminal)
 *   text-start / text-end /
 *   reasoning-* / source-* / file  → ignored
 *
 * "Terminal" means the adapter stops yielding once that event fires
 * because the driver translates each terminal into a single MEL
 * dispatch and then either chains forward (tool-call → awaitingTool)
 * or ends the turn (settled / failed → settled phase).
 *
 * Boundary note: this file lives in `agent/session/` (future-core
 * territory). The `ai` package isn't on the boundary blocklist —
 * once we replace the transport with a hand-rolled SSE parser in a
 * later PR, this file is the only thing that needs swapping.
 */
import type {
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai";
import type {
  ModelAdapter,
  ModelStreamArgs,
  ModelStreamEvent,
} from "./agent-session-effects.js";
import type { AgentSessionSnapshot } from "./agent-session-types.js";

export type AiSdkModelAdapterDeps = {
  /** Transport already wired with `prepareSendMessagesRequest` for body building. */
  readonly transport: ChatTransport<UIMessage>;
  /**
   * Build the message history to send for this invocation. The
   * adapter doesn't know how the host turns AgentSession lineage
   * into UIMessages; the host injects this so the future-core part
   * stays pure.
   */
  readonly buildMessages: (snapshot: AgentSessionSnapshot) => readonly UIMessage[];
  /** Optional override of the chat id passed to the transport. Defaults to invocationId. */
  readonly buildChatId?: (snapshot: AgentSessionSnapshot, invocationId: string) => string;
};

export function createAiSdkModelAdapter(
  deps: AiSdkModelAdapterDeps,
): ModelAdapter {
  return {
    stream: ({ snapshot, invocationId, signal }) =>
      streamModelEvents(deps, { snapshot, invocationId, signal }),
  };
}

async function* streamModelEvents(
  deps: AiSdkModelAdapterDeps,
  args: Omit<ModelStreamArgs, "tier">,
): AsyncGenerator<ModelStreamEvent, void, void> {
  const messages = [...deps.buildMessages(args.snapshot)] as UIMessage[];
  const chatId = deps.buildChatId?.(args.snapshot, args.invocationId) ?? args.invocationId;

  let stream: ReadableStream<UIMessageChunk>;
  try {
    stream = await deps.transport.sendMessages({
      chatId,
      messages,
      abortSignal: args.signal,
      trigger: "submit-message",
      messageId: undefined,
    });
  } catch (err) {
    yield { kind: "failed", reason: errorMessage(err) };
    return;
  }

  let accumulatedText = "";
  let emittedTerminal = false;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      const event = translateChunk(chunk);
      if (event === null) continue;
      if (event.kind === "text-delta") {
        accumulatedText += event.delta;
        yield event;
        continue;
      }
      // tool-call / failed / settled — terminal events.
      yield event;
      emittedTerminal = true;
      return;
    }
  } catch (err) {
    yield { kind: "failed", reason: errorMessage(err) };
    return;
  } finally {
    reader.releaseLock();
  }

  // Stream ended without a terminal chunk. Emit settled with whatever
  // text the model produced (driver covers the truly-empty case by
  // routing to recordModelInvocationFailed).
  if (!emittedTerminal) {
    yield { kind: "settled", finalText: accumulatedText };
  }
}

function translateChunk(chunk: UIMessageChunk): ModelStreamEvent | null {
  switch (chunk.type) {
    case "text-delta":
      return { kind: "text-delta", delta: chunk.delta };
    case "tool-input-available":
      return {
        kind: "tool-call",
        callId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
      };
    case "tool-input-error":
      return {
        kind: "failed",
        reason: `tool input rejected: ${chunk.errorText}`,
      };
    case "error":
      return { kind: "failed", reason: chunk.errorText };
    case "abort":
      return { kind: "failed", reason: chunk.reason ?? "aborted" };
    case "finish":
      // Settle only happens here when no prior tool-call was yielded;
      // the generator's consumer logic handles that distinction.
      return null;
    default:
      // text-start, text-end, reasoning-*, source-*, file, start*, etc.
      return null;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
