/**
 * Single-turn orchestrator.
 *
 * Loop shape (Phase α):
 *   1. Build a `ChatRequest` from the user prompt + optional system +
 *      the registered tools' `ToolSpec[]`.
 *   2. Call `provider.chat(request)` once.
 *   3. If the assistant replies with `toolCalls`, look each up in the
 *      registry, parse `argumentsJson`, run the tool, and append a
 *      `ToolMessage` carrying the JSON-encoded result. Repeat step 2
 *      with the extended messages array.
 *   4. Terminate when either:
 *        - the assistant reply has no `toolCalls` (final answer), OR
 *        - `maxToolUses` is exceeded (hard stop — we surface a terminal
 *          assistant message describing the cap).
 *
 * Why not stream? Phase α privileges determinism and legibility over
 * latency — tool calls arrive as complete JSON, so streaming would
 * only help for the terminal message. We'll revisit in Phase β when
 * the Critic agent needs a token-by-token commentary UX.
 *
 * This module is React-free and SDK-free. The caller is responsible
 * for providing:
 *   - a `ToolRegistry<TCtx>` (see `../tools/types.ts`)
 *   - a `TCtx` value appropriate to those tools (usually a StudioCore
 *     slice — see `../tools/legality.ts`)
 *   - an `LlmProvider` (see `../provider/types.ts`)
 */
import type {
  AssistantMessage,
  ChatMessage,
  ChatResponse,
  ChatStreamEvent,
  LlmProvider,
  ToolCall,
  ToolMessage,
} from "../provider/types.js";
import type { ToolRegistry } from "../tools/types.js";

export type OrchestratorRequest = {
  /** System prompt — tone, role, domain background. Optional. */
  readonly system?: string;
  /** The user's turn. Single string for Phase α (multi-turn later). */
  readonly userPrompt: string;
  /**
   * Tools the LLM may request. Each tool in the registry is already
   * bound to its own context (see `bindTool` in tools/types), so the
   * orchestrator doesn't carry any tool-specific context types.
   */
  readonly registry: ToolRegistry;
  /** Underlying LLM adapter — Ollama in practice. */
  readonly provider: LlmProvider;
  /**
   * Hard cap on tool calls per turn. Defaults to 4. A model that
   * exceeds this gets a terminal assistant reply describing the cap
   * — prevents infinite tool-loops from hung runs.
   */
  readonly maxToolUses?: number;
  readonly temperature?: number;
  /** Optional callback for observability / transcript UIs. */
  readonly onStep?: (step: OrchestratorStep) => void;
  /**
   * Streaming sink. When set, the orchestrator turns on provider
   * streaming and forwards each chunk (content/reasoning delta) to
   * this callback along with the originating step index, so the UI
   * can paint partial assistant messages before the full turn
   * resolves. Tool-call deltas buffer inside the provider and surface
   * only as fully-formed `ToolCall`s — no partial JSON hits the UI.
   */
  readonly onStream?: (
    event: ChatStreamEvent,
    meta: { readonly stepIndex: number },
  ) => void;
  /**
   * Abort signal. Wired into the provider's fetch so a user-initiated
   * Stop propagates through the entire loop (including between tool
   * calls — we check it before starting the next chat()).
   */
  readonly signal?: AbortSignal;
};

export type OrchestratorStep =
  | {
      readonly kind: "llm";
      readonly message: AssistantMessage;
      readonly reasoning?: string;
      readonly diagnostics?: ChatResponse["diagnostics"];
    }
  | {
      readonly kind: "tool";
      readonly toolCall: ToolCall;
      readonly resultJson: string;
    };

export type OrchestratorResult = {
  /** The final assistant message that has no tool calls. */
  readonly finalMessage: AssistantMessage;
  /** Full ordered trace of LLM + tool steps. Useful for UI + audits. */
  readonly trace: readonly OrchestratorStep[];
  /** Number of tool invocations actually run. */
  readonly toolUses: number;
  /** `true` when we hit `maxToolUses` and stopped early. */
  readonly stoppedAtCap: boolean;
};

const DEFAULT_MAX_TOOL_USES = 4;

export async function runOrchestrator(
  req: OrchestratorRequest,
): Promise<OrchestratorResult> {
  const maxToolUses = req.maxToolUses ?? DEFAULT_MAX_TOOL_USES;
  const trace: OrchestratorStep[] = [];
  const messages: ChatMessage[] = [
    { role: "user", content: req.userPrompt },
  ];
  let toolUses = 0;

  while (true) {
    if (req.signal?.aborted === true) {
      const abortedMessage: AssistantMessage = {
        role: "assistant",
        content: "[orchestrator] aborted by user",
      };
      trace.push({ kind: "llm", message: abortedMessage });
      return {
        finalMessage: abortedMessage,
        trace,
        toolUses,
        stoppedAtCap: false,
      };
    }
    // Snapshot the step index BEFORE the chat call so streaming
    // chunks can be attributed to the right (future) llm step.
    const stepIndex = trace.length;
    const streamSink = req.onStream;
    const resp = await req.provider.chat({
      system: req.system,
      messages,
      tools: req.registry.toToolSpecs(),
      temperature: req.temperature,
      maxToolUses,
      signal: req.signal,
      onStream:
        streamSink === undefined
          ? undefined
          : (event) => streamSink(event, { stepIndex }),
    });
    const msg = resp.message;
    const llmStep: OrchestratorStep = {
      kind: "llm",
      message: msg,
      reasoning: resp.reasoning,
      diagnostics: resp.diagnostics,
    };
    trace.push(llmStep);
    req.onStep?.(llmStep);

    const calls = msg.toolCalls ?? [];
    if (calls.length === 0) {
      return { finalMessage: msg, trace, toolUses, stoppedAtCap: false };
    }

    // Assistant turn carrying the tool-call request is preserved
    // verbatim — most providers require the subsequent tool replies
    // to be correlated back to this assistant turn by tool-call id.
    messages.push(msg);

    for (const call of calls) {
      if (toolUses >= maxToolUses) {
        const cappedMessage: AssistantMessage = {
          role: "assistant",
          content:
            `[orchestrator] stopped: tool-use cap of ${maxToolUses} reached. ` +
            "Returning the last partial answer so the user can intervene.",
        };
        trace.push({ kind: "llm", message: cappedMessage });
        return {
          finalMessage: cappedMessage,
          trace,
          toolUses,
          stoppedAtCap: true,
        };
      }
      const resultJson = await dispatchToolCall(call, req);
      toolUses += 1;
      const toolStep: OrchestratorStep = {
        kind: "tool",
        toolCall: call,
        resultJson,
      };
      trace.push(toolStep);
      req.onStep?.(toolStep);

      const toolMsg: ToolMessage = {
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: resultJson,
      };
      messages.push(toolMsg);
    }
  }
}

async function dispatchToolCall(
  call: ToolCall,
  req: OrchestratorRequest,
): Promise<string> {
  const tool = req.registry.get(call.name);
  if (tool === undefined) {
    return JSON.stringify({
      ok: false,
      kind: "runtime_error",
      message: `no tool registered with name "${call.name}"`,
    });
  }

  let parsed: unknown;
  try {
    parsed =
      call.argumentsJson === undefined || call.argumentsJson === ""
        ? {}
        : JSON.parse(call.argumentsJson);
  } catch (err) {
    return JSON.stringify({
      ok: false,
      kind: "invalid_input",
      message:
        "failed to parse tool arguments as JSON: " +
        (err instanceof Error ? err.message : String(err)),
      detail: { raw: call.argumentsJson },
    });
  }

  try {
    const result = await tool.run(parsed);
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({
      ok: false,
      kind: "runtime_error",
      message:
        err instanceof Error
          ? err.message
          : "tool threw a non-Error value: " + String(err),
    });
  }
}
