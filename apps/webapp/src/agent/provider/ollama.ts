/**
 * Ollama LLM provider adapter.
 *
 * Primary path: the OpenAI-compatible `/v1/chat/completions` endpoint.
 * That spec documents `tools` / `tool_calls` / `tool_choice` in a way
 * our `types.ts` contract already mirrors, so the mapping is near-1:1.
 *
 * Fallback path: if the OpenAI route 404s or returns an obvious
 * spec-mismatch error, fall back to Ollama's native `/api/chat` and
 * translate the shape. Gemma-class models served by Ollama generally
 * accept both, but native has historically been more forgiving for
 * `tools` emissions on smaller models.
 *
 * No vendor abstraction beyond `LlmProvider`. Swapping to a hosted API
 * later means replacing this file, not restructuring the orchestrator.
 */
import {
  type AssistantMessage,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ChatStreamEvent,
  type LlmProvider,
  LlmProviderError,
  type ToolCall,
  type ToolSpec,
} from "./types.js";

export type ThinkLevel = boolean | "low" | "medium" | "high";

export type OllamaConfig = {
  readonly baseUrl: string;
  readonly model: string;
  /**
   * Forwarded to Ollama as `options.num_ctx`. Default Ollama context is
   * small (2048–8192 depending on model); the studio agent's system
   * prompt (MEL source + snapshot + tool schemas) trivially exceeds
   * that, so raise this when the model's tail of the prompt appears
   * truncated (e.g. model ignores UI focus block).
   */
  readonly numCtx?: number;
  /**
   * Forwarded to Ollama as `think`. `true` enables thinking-model
   * reasoning; `"low" | "medium" | "high"` selects a budget on models
   * that support it (gpt-oss, qwen3-thinking). Ignored by models that
   * don't support thinking — Ollama returns an error if you try, so
   * only set when you know the model is thinking-capable.
   */
  readonly think?: ThinkLevel;
  /** Per-request HTTP timeout. Covers cold model loads on first ping. */
  readonly timeoutMs?: number;
  /** Inject for tests. Defaults to global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
};

/**
 * Resolve the Ollama config from Vite env with sensible fallback. Call
 * at provider construction time so the error is clear when the env is
 * missing, not later when a request fires.
 */
export function readOllamaConfigFromEnv(): OllamaConfig {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const baseUrl = env.VITE_OLLAMA_URL?.trim() ?? "";
  const model = env.VITE_OLLAMA_MODEL?.trim() ?? "";
  if (baseUrl === "" || model === "") {
    throw new LlmProviderError(
      "Ollama config missing — set VITE_OLLAMA_URL and VITE_OLLAMA_MODEL in " +
        "apps/webapp/.env.local (or .env). See src/agent/README.md.",
    );
  }
  const numCtxRaw = env.VITE_OLLAMA_NUM_CTX?.trim();
  const numCtx =
    numCtxRaw !== undefined && numCtxRaw !== ""
      ? Number.parseInt(numCtxRaw, 10)
      : undefined;
  if (numCtx !== undefined && (!Number.isFinite(numCtx) || numCtx <= 0)) {
    throw new LlmProviderError(
      `VITE_OLLAMA_NUM_CTX must be a positive integer, got "${numCtxRaw}"`,
    );
  }
  const thinkRaw = env.VITE_OLLAMA_THINK?.trim().toLowerCase();
  const think: ThinkLevel | undefined =
    thinkRaw === undefined || thinkRaw === ""
      ? undefined
      : thinkRaw === "true"
        ? true
        : thinkRaw === "false"
          ? false
          : thinkRaw === "low" || thinkRaw === "medium" || thinkRaw === "high"
            ? thinkRaw
            : (() => {
                throw new LlmProviderError(
                  `VITE_OLLAMA_THINK must be one of true/false/low/medium/high, got "${thinkRaw}"`,
                );
              })();
  return {
    baseUrl: stripTrailingSlash(baseUrl),
    model,
    numCtx,
    think,
  };
}

export function createOllamaProvider(config: OllamaConfig): LlmProvider {
  const f = config.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = config.timeoutMs ?? 60_000;

  async function chat(request: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    // Try OpenAI-compat first. If it surfaces a 404 or a response the
    // parser can't understand, fall back to native. Transport errors
    // bubble as LlmProviderError and surface in the UI.
    try {
      const out = await callOpenAiCompat(config, f, request, timeoutMs);
      return withLatency(out, started);
    } catch (err) {
      if (err instanceof FallbackSignal) {
        const out = await callNative(config, f, request, timeoutMs);
        return withLatency(out, started);
      }
      throw err;
    }
  }

  return { name: "ollama", modelId: config.model, chat };
}

// --------------------------------------------------------------------
// OpenAI-compatible path
// --------------------------------------------------------------------

class FallbackSignal extends Error {
  constructor(public readonly reason: string) {
    super(`fallback-to-native: ${reason}`);
    this.name = "FallbackSignal";
  }
}

/**
 * gemma4 family detection. The model-tag format on Ollama is
 * `gemma4:<variant>` (e.g. `gemma4:e4b`, `gemma4:e4b-it-q8_0`,
 * `gemma4:26b`). We treat anything with that prefix as the family so
 * future quant tags don't need code updates. Case-insensitive because
 * Modelfile tags are canonicalized to lowercase by Ollama but users
 * sometimes type them with mixed case in env vars.
 */
function isGemma4Family(model: string): boolean {
  return model.toLowerCase().startsWith("gemma4");
}

/**
 * gemma4 enables reasoning by prepending the `<|think|>` content
 * token at the start of the system message — not via an API flag.
 * See https://ai.google.dev/gemma/docs/capabilities/thinking.
 * Returns the (possibly-modified) system text, or `undefined` if the
 * caller didn't pass one in. For non-gemma4 models the text is
 * returned unchanged and thinking activation happens via the Ollama
 * `think` flag on the request payload.
 */
function applyGemma4ThinkingPrefix(
  config: OllamaConfig,
  systemText: string | undefined,
): string | undefined {
  if (!isGemma4Family(config.model)) return systemText;
  if (config.think === undefined || config.think === false) return systemText;
  const base = systemText ?? "";
  if (base.startsWith("<|think|>")) return base;
  return `<|think|>\n${base}`;
}

async function callOpenAiCompat(
  config: OllamaConfig,
  f: typeof globalThis.fetch,
  request: ChatRequest,
  timeoutMs: number,
): Promise<ChatResponse> {
  const endpoint = `${config.baseUrl}/v1/chat/completions`;
  const effectiveSystem = applyGemma4ThinkingPrefix(config, request.system);
  const wantsStream = request.onStream !== undefined;
  const payload: Record<string, unknown> = {
    model: config.model,
    messages: toOpenAiMessages({ ...request, system: effectiveSystem }),
    stream: wantsStream,
  };
  if (request.temperature !== undefined) {
    payload.temperature = request.temperature;
  }
  if (request.tools && request.tools.length > 0) {
    payload.tools = request.tools.map(toolSpecToOpenAi);
    payload.tool_choice = "auto";
  }
  // `options` is an Ollama extension on the OpenAI-compat route.
  // Unknown keys are silently ignored by strict OpenAI proxies, so
  // this is safe if VITE_OLLAMA_URL is ever pointed at vanilla OpenAI.
  if (config.numCtx !== undefined) {
    payload.options = { num_ctx: config.numCtx };
  }
  // Thinking activation has two different mechanisms depending on the
  // model family. gemma4 uses a content-token at the start of the
  // system prompt (we handled that in toOpenAiMessages/toNativeMessages);
  // other thinking-capable models (qwen3-thinking, gpt-oss,
  // deepseek-r1) accept the Ollama `think` API flag. We only forward
  // the flag for non-gemma4 models so we don't confuse the server.
  if (config.think !== undefined && !isGemma4Family(config.model)) {
    payload.think = config.think;
  }

  const res = await fetchWithTimeout(
    f,
    endpoint,
    payload,
    timeoutMs,
    request.signal,
  );
  if (res.status === 404) {
    throw new FallbackSignal("/v1/chat/completions not found");
  }
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new LlmProviderError(
      `Ollama OpenAI-compat request failed: ${res.status} ${res.statusText}`,
      { status: res.status, endpoint, cause: body },
    );
  }

  if (wantsStream) {
    return parseOpenAiStream(res, endpoint, request.onStream!);
  }

  const data = (await res.json()) as {
    readonly choices?: readonly {
      readonly message?: {
        readonly content?: string | null;
        readonly reasoning?: string | null;
        readonly tool_calls?: readonly {
          readonly id?: string;
          readonly function?: { readonly name?: string; readonly arguments?: string };
        }[];
      };
    }[];
    readonly usage?: { readonly total_tokens?: number };
  };
  const choice = data.choices?.[0]?.message;
  if (choice === undefined) {
    throw new FallbackSignal("OpenAI-compat response missing choices[0].message");
  }
  const toolCalls: ToolCall[] = [];
  for (const raw of choice.tool_calls ?? []) {
    const name = raw.function?.name;
    const id = raw.id ?? `call-${toolCalls.length}`;
    const argumentsJson = raw.function?.arguments ?? "{}";
    if (typeof name === "string") {
      toolCalls.push({ id, name, argumentsJson });
    }
  }
  const message: AssistantMessage = {
    role: "assistant",
    content: typeof choice.content === "string" ? choice.content : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
  return {
    message,
    reasoning: typeof choice.reasoning === "string" ? choice.reasoning : undefined,
    diagnostics: {
      totalTokens: data.usage?.total_tokens,
      endpoint,
    },
  };
}

/**
 * SSE parser for `/v1/chat/completions` with stream=true. Each event
 * is a `data: { "choices": [{"delta": {...}, "finish_reason": null}] }`
 * line, terminated by `data: [DONE]`. Tool calls arrive piecewise:
 *   first delta: { tool_calls: [{ index, id, type, function: { name } }] }
 *   subsequent:  { tool_calls: [{ index, function: { arguments: "..." } }] }
 * We accumulate by index and emit one `tool_call` event per completed
 * index once the stream ends (or when a new index replaces the slot —
 * OpenAI-compat convention is monotonic indices).
 */
async function parseOpenAiStream(
  res: Response,
  endpoint: string,
  onStream: (event: ChatStreamEvent) => void,
): Promise<ChatResponse> {
  if (res.body === null) {
    throw new LlmProviderError("Ollama stream response missing body", { endpoint });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoning = "";
  const toolAcc = new Map<
    number,
    { id?: string; name?: string; args: string }
  >();
  let totalTokens: number | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on blank-line event boundaries per SSE spec. Ollama
    // emits `data: ...\n\n` events; we also handle bare `\n`
    // separators as some proxies strip the doubled newline.
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line === "") continue;
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let parsed: {
        readonly choices?: readonly {
          readonly delta?: {
            readonly content?: string | null;
            readonly reasoning?: string | null;
            readonly tool_calls?: readonly {
              readonly index?: number;
              readonly id?: string;
              readonly function?: {
                readonly name?: string;
                readonly arguments?: string;
              };
            }[];
          };
        }[];
        readonly usage?: { readonly total_tokens?: number };
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        // Malformed chunk — skip. Ollama occasionally emits
        // partial keepalive lines that aren't JSON.
        continue;
      }
      if (parsed.usage?.total_tokens !== undefined) {
        totalTokens = parsed.usage.total_tokens;
      }
      const delta = parsed.choices?.[0]?.delta;
      if (delta === undefined) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        content += delta.content;
        onStream({ kind: "content", delta: delta.content });
      }
      if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
        reasoning += delta.reasoning;
        onStream({ kind: "reasoning", delta: delta.reasoning });
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const slot =
          toolAcc.get(idx) ?? { args: "" };
        if (tc.id !== undefined) slot.id = tc.id;
        if (tc.function?.name !== undefined) slot.name = tc.function.name;
        if (tc.function?.arguments !== undefined) {
          slot.args += tc.function.arguments;
        }
        toolAcc.set(idx, slot);
      }
    }
  }

  const toolCalls: ToolCall[] = [];
  for (const [idx, slot] of [...toolAcc.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    if (slot.name === undefined) continue;
    const call: ToolCall = {
      id: slot.id ?? `call-${idx}`,
      name: slot.name,
      argumentsJson: slot.args === "" ? "{}" : slot.args,
    };
    toolCalls.push(call);
    onStream({ kind: "tool_call", toolCall: call });
  }

  const message: AssistantMessage = {
    role: "assistant",
    content: content === "" ? undefined : content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
  return {
    message,
    reasoning: reasoning === "" ? undefined : reasoning,
    diagnostics: { totalTokens, endpoint },
  };
}

function toolSpecToOpenAi(spec: ToolSpec): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: spec.function.name,
      description: spec.function.description,
      parameters: spec.function.parameters,
    },
  };
}

function toOpenAiMessages(request: ChatRequest): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (request.system !== undefined && request.system.trim() !== "") {
    out.push({ role: "system", content: request.system });
  }
  for (const m of request.messages) {
    out.push(mapMessage(m));
  }
  return out;
}

function mapMessage(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case "system":
    case "user":
      return { role: m.role, content: m.content };
    case "assistant": {
      const base: Record<string, unknown> = { role: "assistant" };
      if (m.content !== undefined && m.content !== null) {
        base.content = m.content;
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        base.tool_calls = m.toolCalls.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.argumentsJson },
        }));
      }
      return base;
    }
    case "tool":
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        name: m.name,
        content: m.content,
      };
  }
}

// --------------------------------------------------------------------
// Native /api/chat fallback
// --------------------------------------------------------------------
//
// Ollama's native shape differs in two ways that matter here:
//   1. `messages` is flatter (no `tool_call_id`); tool results get
//      posted back with `role: "tool"` and `name` only.
//   2. Function-calling uses `tools` the same way but returns
//      `message.tool_calls` with the arguments already parsed (object,
//      not stringified JSON). We stringify to keep the ToolCall shape
//      uniform across paths.

async function callNative(
  config: OllamaConfig,
  f: typeof globalThis.fetch,
  request: ChatRequest,
  timeoutMs: number,
): Promise<ChatResponse> {
  const endpoint = `${config.baseUrl}/api/chat`;
  const effectiveSystem = applyGemma4ThinkingPrefix(config, request.system);
  const nativeRequest = { ...request, system: effectiveSystem };
  const wantsStream = request.onStream !== undefined;
  const options: Record<string, unknown> = {};
  if (request.temperature !== undefined) {
    options.temperature = request.temperature;
  }
  if (config.numCtx !== undefined) {
    options.num_ctx = config.numCtx;
  }
  const payload: Record<string, unknown> = {
    model: config.model,
    messages: toNativeMessages(nativeRequest),
    stream: wantsStream,
  };
  if (Object.keys(options).length > 0) {
    payload.options = options;
  }
  // See the matching block in callOpenAiCompat — gemma4's thinking
  // mode is activated via a system-prompt content token
  // (toNativeMessages handles that), not Ollama's `think` API flag.
  if (config.think !== undefined && !isGemma4Family(config.model)) {
    payload.think = config.think;
  }
  if (request.tools && request.tools.length > 0) {
    payload.tools = request.tools.map(toolSpecToOpenAi);
  }

  const res = await fetchWithTimeout(
    f,
    endpoint,
    payload,
    timeoutMs,
    request.signal,
  );
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new LlmProviderError(
      `Ollama native request failed: ${res.status} ${res.statusText}`,
      { status: res.status, endpoint, cause: body },
    );
  }

  if (wantsStream) {
    return parseNativeStream(res, endpoint, request.onStream!);
  }

  const data = (await res.json()) as {
    readonly message?: {
      readonly content?: string;
      readonly thinking?: string;
      readonly tool_calls?: readonly {
        readonly function?: {
          readonly name?: string;
          readonly arguments?: unknown;
        };
      }[];
    };
    readonly eval_count?: number;
  };
  const native = data.message;
  if (native === undefined) {
    throw new LlmProviderError(
      "Ollama native response missing `message`",
      { endpoint },
    );
  }
  const toolCalls: ToolCall[] = [];
  for (const [i, raw] of (native.tool_calls ?? []).entries()) {
    const name = raw.function?.name;
    const args = raw.function?.arguments;
    if (typeof name === "string") {
      toolCalls.push({
        id: `call-${i}`,
        name,
        argumentsJson: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      });
    }
  }
  const message: AssistantMessage = {
    role: "assistant",
    content: native.content ?? undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
  return {
    message,
    reasoning: native.thinking ?? undefined,
    diagnostics: { totalTokens: data.eval_count, endpoint },
  };
}

/**
 * NDJSON parser for Ollama's native `/api/chat` stream. Each line is
 * a self-contained JSON object: `{message: {content, thinking?,
 * tool_calls?}, done: boolean, eval_count?: number}`. Content tokens
 * arrive as incremental `message.content` strings; tool_calls may
 * appear on a single line (with full arguments object) or stream in
 * later Ollama versions — we accept both shapes.
 */
async function parseNativeStream(
  res: Response,
  endpoint: string,
  onStream: (event: ChatStreamEvent) => void,
): Promise<ChatResponse> {
  if (res.body === null) {
    throw new LlmProviderError("Ollama native stream missing body", { endpoint });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoning = "";
  let totalTokens: number | undefined;
  const pendingToolCalls: ToolCall[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === "") continue;
      let parsed: {
        readonly message?: {
          readonly content?: string;
          readonly thinking?: string;
          readonly tool_calls?: readonly {
            readonly function?: {
              readonly name?: string;
              readonly arguments?: unknown;
            };
          }[];
        };
        readonly eval_count?: number;
        readonly done?: boolean;
      };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.eval_count !== undefined) totalTokens = parsed.eval_count;
      const msg = parsed.message;
      if (msg === undefined) continue;
      if (typeof msg.content === "string" && msg.content.length > 0) {
        content += msg.content;
        onStream({ kind: "content", delta: msg.content });
      }
      if (typeof msg.thinking === "string" && msg.thinking.length > 0) {
        reasoning += msg.thinking;
        onStream({ kind: "reasoning", delta: msg.thinking });
      }
      for (const [i, raw] of (msg.tool_calls ?? []).entries()) {
        const name = raw.function?.name;
        const args = raw.function?.arguments;
        if (typeof name !== "string") continue;
        const call: ToolCall = {
          id: `call-${pendingToolCalls.length + i}`,
          name,
          argumentsJson:
            typeof args === "string" ? args : JSON.stringify(args ?? {}),
        };
        pendingToolCalls.push(call);
        onStream({ kind: "tool_call", toolCall: call });
      }
    }
  }

  const message: AssistantMessage = {
    role: "assistant",
    content: content === "" ? undefined : content,
    toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
  };
  return {
    message,
    reasoning: reasoning === "" ? undefined : reasoning,
    diagnostics: { totalTokens, endpoint },
  };
}

function toNativeMessages(request: ChatRequest): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (request.system !== undefined && request.system.trim() !== "") {
    out.push({ role: "system", content: request.system });
  }
  for (const m of request.messages) {
    switch (m.role) {
      case "user":
      case "system":
        out.push({ role: m.role, content: m.content });
        break;
      case "assistant":
        out.push({
          role: "assistant",
          content: m.content ?? "",
          ...(m.toolCalls && m.toolCalls.length > 0
            ? {
                tool_calls: m.toolCalls.map((t) => ({
                  function: { name: t.name, arguments: t.argumentsJson },
                })),
              }
            : {}),
        });
        break;
      case "tool":
        out.push({
          role: "tool",
          name: m.name,
          content: m.content,
        });
        break;
    }
  }
  return out;
}

// --------------------------------------------------------------------
// Shared transport helpers
// --------------------------------------------------------------------

async function fetchWithTimeout(
  f: typeof globalThis.fetch,
  endpoint: string,
  body: unknown,
  timeoutMs: number,
  userSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromUser = (): void => controller.abort();
  if (userSignal !== undefined) {
    if (userSignal.aborted) controller.abort();
    else userSignal.addEventListener("abort", abortFromUser, { once: true });
  }
  try {
    return await f(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      // Distinguish user-initiated abort from timeout. When a user
      // hits Stop, userSignal is the cause and we want a cleaner
      // error the UI can recognize.
      if (userSignal?.aborted === true) {
        throw new LlmProviderError("aborted by user", {
          endpoint,
          cause: err,
        });
      }
      throw new LlmProviderError(
        `Ollama request timed out after ${timeoutMs}ms`,
        { endpoint, cause: err },
      );
    }
    throw new LlmProviderError(
      `Ollama network error: ${(err as Error).message}`,
      { endpoint, cause: err },
    );
  } finally {
    clearTimeout(timer);
    if (userSignal !== undefined) {
      userSignal.removeEventListener("abort", abortFromUser);
    }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function withLatency(res: ChatResponse, started: number): ChatResponse {
  const latencyMs = Date.now() - started;
  return {
    ...res,
    diagnostics: { ...res.diagnostics, latencyMs },
  };
}

/**
 * Lightweight health probe. Does not hit the model — just confirms
 * the endpoint is reachable and the configured model is listed. Used
 * by the Agent lens' "Agent available?" indicator.
 */
export async function probeOllama(
  config: OllamaConfig,
): Promise<
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly error: string }
> {
  const f = config.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    const res = await f(`${config.baseUrl}/api/tags`);
    if (!res.ok) {
      return { ok: false, error: `tags responded ${res.status}` };
    }
    const data = (await res.json()) as {
      readonly models?: readonly { readonly name?: string }[];
    };
    const names = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string");
    return { ok: true, models: names };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
