/**
 * Agent chat handler — the server-side half of the production
 * deployment. Receives a chat request from the browser, forwards it
 * to the Vercel AI Gateway, streams the response back as an AI SDK
 * data stream.
 *
 * ## Why a server handler
 *
 * The Vercel AI Gateway API key (AI_GATEWAY_API_KEY) must NEVER
 * reach the browser bundle. This handler is the one place the key
 * is in scope; the client sees only the streaming response body.
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
 *   - AI_GATEWAY_API_KEY     (required) — Vercel AI Gateway token.
 *   - AI_GATEWAY_MODEL       (optional) — default "google/gemma-4-26b-a4b-it".
 *
 * This module is transport-neutral: both the Vite dev middleware and
 * the Vercel serverless entry (`/api/agent/chat.ts`) call
 * `handleAgentChat(req)` with a standard `Request` and return its
 * `Response`. See `apps/webapp/api/agent/chat.ts` (serverless) and
 * `vite.config.ts` dev middleware.
 */
import { streamText, type ToolSet } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { enforceChatRateLimit, identifyRequest } from "./rate-limit.js";

const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it";

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

const chatBodyShape = z
  .object({
    messages: z.array(z.unknown()),
    system: z.string().optional(),
    tools: z.record(z.string(), toolSchemaShape).optional(),
    temperature: z.number().optional(),
    maxSteps: z.number().optional(),
  })
  .strict();

export async function handleAgentChat(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonError(405, "method not allowed; use POST");
  }
  const apiKey = readEnv("AI_GATEWAY_API_KEY");
  if (apiKey === null) {
    return jsonError(
      500,
      "server misconfigured — AI_GATEWAY_API_KEY not set. " +
        "See apps/webapp/.env.example.",
    );
  }

  // Rate-limit BEFORE doing any gateway work. Upstash check is one
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

  const { messages, system, tools, temperature, maxSteps } = parsed.data;
  const modelId = readEnv("AI_GATEWAY_MODEL") ?? DEFAULT_MODEL;

  // Gateway reads the key from env implicitly. We verified presence
  // above so a missing key surfaces here as a 500 rather than the
  // provider's less-helpful error.
  process.env.AI_GATEWAY_API_KEY = apiKey;

  // Translate the client's tool schemas into AI SDK `tool` shape
  // with NO `execute`. AI SDK's data-stream protocol will forward
  // the model's tool-call requests to the client, which runs them
  // against the live Manifesto runtime and posts the result back
  // in a follow-up request.
  const sdkTools: ToolSet = tools
    ? Object.fromEntries(
        Object.entries(tools).map(([name, spec]) => [
          name,
          {
            description: spec.description,
            // AI SDK expects a JSON Schema or a zod/valibot schema
            // under `inputSchema`. We pass the JSON Schema through
            // as-is (that's what our client-side adapter produces).
            inputSchema: spec.parameters as never,
          },
        ]),
      )
    : {};

  const result = streamText({
    model: gateway(modelId),
    system,
    messages: messages as never,
    tools: sdkTools,
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
