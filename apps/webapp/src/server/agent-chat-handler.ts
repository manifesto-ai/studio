/**
 * Agent chat handler — the server-side half of the agent transport.
 * Receives a chat request from the browser, forwards it to the
 * configured AI SDK provider, streams the response back as an AI SDK
 * data stream.
 *
 * ## Why a server handler
 *
 * The browser never calls model providers directly. This handler owns
 * the model transport and the client sees only the streaming response
 * body. Keep Gateway and Ollama credentials / URLs server-only.
 *
 * ## Client-side tool execution
 *
 * We deliberately pass tool SCHEMAS (parameters only, no `execute`)
 * to `streamText`. When the model issues a tool call, the AI SDK
 * data stream emits it to the client; the client executes the tool
 * locally (because tools touch the Manifesto runtime, which lives
 * in the browser) and POSTs the result back as the next message.
 * That round-trip keeps the runtime firmly on the client while the
 * model transport stays on the server.
 *
 * Environment:
 *   - AGENT_MODEL_PROVIDER   (optional) — "gateway" or "ollama".
 *   - AI_GATEWAY_API_KEY     (gateway) — Vercel AI Gateway token.
 *   - AI_GATEWAY_MODEL       (gateway) — default "google/gemma-4-26b-a4b-it".
 *   - OLLAMA_BASE_URL        (ollama) — default "http://localhost:11434/v1".
 *   - OLLAMA_HOST            (ollama) — accepted as an alias for base URL.
 *   - OLLAMA_MODEL           (ollama) — default "gemma4:e4b".
 *   - OLLAMA_API_KEY         (ollama) — only for protected proxies.
 *
 * This module is transport-neutral: both the Vite dev middleware and
 * the Vercel serverless entry (`/api/agent/chat.ts`) call
 * `handleAgentChat(req)` with a standard `Request` and return its
 * `Response`. See `apps/webapp/api/agent/chat.ts` (serverless) and
 * `vite.config.ts` dev middleware.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  jsonSchema,
  streamText,
  type ToolChoice,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { enforceChatRateLimit, identifyRequest } from "./rate-limit.js";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
const DEFAULT_GATEWAY_MODEL = "google/gemma-4-26b-a4b-it";
type AgentModelProvider = "gateway" | "ollama";

/**
 * Tool schema the client sends over. We hold only the JSON schema
 * here (no `execute`) — the client runs the tool and responds with
 * its result. See `../agent/adapters/ai-sdk-tools.ts` for the
 * client-side shape these mirror.
 */
const toolSchemaShape = z
  .object({
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();

// `.passthrough()` rather than `.strict()` — AI SDK's useChat ships
// extra fields (id, trigger, etc.) that aren't ours to validate.
// We only care about the four we read; anything else rides along.
const chatBodyShape = z
  .object({
    messages: z.array(z.unknown()),
    system: z.string().optional(),
    tools: z.record(z.string(), toolSchemaShape).optional(),
    toolChoice: z
      .union([
        z.literal("auto"),
        z.literal("none"),
        z.literal("required"),
        z
          .object({
            type: z.literal("tool"),
            toolName: z.string(),
          })
          .strict(),
      ])
      .optional(),
    temperature: z.number().optional(),
    maxSteps: z.number().optional(),
  })
  .passthrough();

export async function handleAgentChat(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonError(405, "method not allowed; use POST");
  }

  const resolvedModel = resolveAgentModel();
  if (resolvedModel.kind === "error") {
    return jsonError(500, resolvedModel.message);
  }

  // Rate-limit BEFORE doing any model work. Upstash check is one
  // round-trip to Redis — cheaper than a rejected model call, and
  // blocks abusive loops before they burn tokens.
  const identifier = identifyRequest(req);
  const rl = await enforceChatRateLimit(identifier);
  if (rl.kind === "limited") {
    return new Response(
      JSON.stringify({
        error: "rate limit exceeded",
        retryAfterSeconds: rl.retryAfterSeconds,
        limit: rl.limit,
        remaining: rl.remaining,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rl.retryAfterSeconds),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "request body must be JSON");
  }

  const parsed = chatBodyShape.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      `invalid request body: ${parsed.error.message}`,
    );
  }

  const {
    messages,
    system,
    tools,
    toolChoice,
    temperature,
    maxSteps,
  } = parsed.data;

  // Translate the client's tool schemas into AI SDK `tool` shape
  // with NO `execute`. AI SDK's data-stream protocol will forward
  // the model's tool-call requests to the client, which runs them
  // against the live Manifesto runtime and posts the result back
  // in a follow-up request.
  //
  // AI SDK v6 expects `inputSchema` to be a `Schema<T>` — not a raw
  // JSON Schema object. `jsonSchema(raw)` wraps a plain JSON schema
  // into the right shape; without it the SDK tries to call the
  // schema as a function ("schema is not a function").
  const sdkTools: ToolSet = tools
    ? Object.fromEntries(
        Object.entries(tools).map(([name, spec]) => [
          name,
          {
            description: spec.description,
            inputSchema: jsonSchema(spec.parameters as never),
          },
        ]),
      )
    : {};
  const sdkToolChoice = normalizeToolChoice(toolChoice, sdkTools);
  if (sdkToolChoice.kind === "error") {
    return jsonError(400, sdkToolChoice.message);
  }

  // useChat sends UIMessage[] (parts-based, rich); streamText wants
  // ModelMessage[] (content-based, model-native). Convert once here.
  // `convertToModelMessages` is async in AI SDK v6.
  const modelMessages = await convertToModelMessages(messages as UIMessage[]);

  const result = streamText({
    model: resolvedModel.model,
    system,
    messages: modelMessages,
    tools: sdkTools,
    toolChoice: sdkToolChoice.value,
    temperature,
    // stopWhen instead of maxSteps in AI SDK v6.
    stopWhen:
      maxSteps !== undefined
        ? ({ steps }) => steps.length >= maxSteps
        : undefined,
    abortSignal: req.signal,
  });

  // AI SDK's data-stream format includes text deltas, tool-call
  // requests, step boundaries, and usage — everything the client
  // needs to drive its transcript UI.
  return result.toUIMessageStreamResponse();
}

export async function handleAgentConfig(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return jsonError(405, "method not allowed; use GET");
  }

  return new Response(JSON.stringify(readAgentModelConfig()), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return null;
}

function normalizeToolChoice(
  value:
    | "auto"
    | "none"
    | "required"
    | { readonly type: "tool"; readonly toolName: string }
    | undefined,
  tools: ToolSet,
):
  | { readonly kind: "ok"; readonly value: ToolChoice<ToolSet> | undefined }
  | { readonly kind: "error"; readonly message: string } {
  if (value === undefined) return { kind: "ok", value: undefined };
  if (typeof value === "string") return { kind: "ok", value };
  if (tools[value.toolName] === undefined) {
    return {
      kind: "error",
      message: `invalid toolChoice: unknown tool "${value.toolName}".`,
    };
  }
  return { kind: "ok", value };
}

export function resolveAgentModel():
  | { kind: "ok"; model: Parameters<typeof streamText>[0]["model"] }
  | { kind: "error"; message: string } {
  const config = readAgentModelConfig();
  if (config.status === "misconfigured") {
    return {
      kind: "error",
      message: config.message ?? "server model provider is misconfigured.",
    };
  }

  if (config.provider === "gateway") {
    return {
      kind: "ok",
      model: config.model,
    };
  }

  const ollamaBaseURL = normalizeOllamaBaseURL(
    readEnv("OLLAMA_BASE_URL") ??
      readEnv("OLLAMA_HOST") ??
      DEFAULT_OLLAMA_BASE_URL,
  );
  const ollama = createOpenAICompatible({
    name: "ollama",
    baseURL: ollamaBaseURL,
    apiKey: readEnv("OLLAMA_API_KEY") ?? undefined,
  });

  return {
    kind: "ok",
    model: ollama.chatModel(config.model),
  };
}

type PublicAgentModelConfig = {
  readonly provider: AgentModelProvider;
  readonly model: string;
  readonly label: string;
  readonly status: "ready" | "misconfigured";
  readonly message?: string;
};

function readAgentModelConfig(): PublicAgentModelConfig {
  const provider = resolveAgentModelProvider();
  if (provider.kind === "error") {
    return {
      provider: "ollama",
      model: DEFAULT_OLLAMA_MODEL,
      label: `ollama/${DEFAULT_OLLAMA_MODEL}`,
      status: "misconfigured",
      message: provider.message,
    };
  }

  if (provider.value === "gateway") {
    const model = readEnv("AI_GATEWAY_MODEL") ?? DEFAULT_GATEWAY_MODEL;
    if (readEnv("AI_GATEWAY_API_KEY") === null) {
      return {
        provider: "gateway",
        model,
        label: `gateway/${model}`,
        status: "misconfigured",
        message:
          "server misconfigured — AI_GATEWAY_API_KEY not set for " +
          'AGENT_MODEL_PROVIDER="gateway".',
      };
    }
    return {
      provider: "gateway",
      model,
      label: `gateway/${model}`,
      status: "ready",
    };
  }

  const model = readEnv("OLLAMA_MODEL") ?? DEFAULT_OLLAMA_MODEL;
  return {
    provider: "ollama",
    model,
    label: `ollama/${model}`,
    status: "ready",
  };
}

function resolveAgentModelProvider():
  | { kind: "ok"; value: AgentModelProvider }
  | { kind: "error"; message: string } {
  const explicit = readEnv("AGENT_MODEL_PROVIDER");
  if (explicit !== null) {
    if (explicit === "gateway" || explicit === "ollama") {
      return { kind: "ok", value: explicit };
    }
    return {
      kind: "error",
      message:
        'server misconfigured — AGENT_MODEL_PROVIDER must be "gateway" ' +
        'or "ollama".',
    };
  }

  if (
    readEnv("OLLAMA_BASE_URL") !== null ||
    readEnv("OLLAMA_HOST") !== null ||
    readEnv("OLLAMA_MODEL") !== null
  ) {
    return { kind: "ok", value: "ollama" };
  }

  if (
    readEnv("AI_GATEWAY_API_KEY") !== null ||
    readEnv("AI_GATEWAY_MODEL") !== null
  ) {
    return { kind: "ok", value: "gateway" };
  }

  return { kind: "ok", value: "ollama" };
}

function normalizeOllamaBaseURL(raw: string): string {
  const withoutTrailingSlash = raw.trim().replace(/\/+$/, "");
  const withProtocol = /^https?:\/\//.test(withoutTrailingSlash)
    ? withoutTrailingSlash
    : `http://${withoutTrailingSlash}`;
  if (withProtocol.endsWith("/v1")) return withProtocol;
  return `${withProtocol}/v1`;
}
