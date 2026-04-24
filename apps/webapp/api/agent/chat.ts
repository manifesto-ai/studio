/**
 * Vercel Function entry for `/api/agent/chat`. Thin wrapper over the
 * shared `handleAgentChat(Request)` so both Vite dev middleware and
 * this serverless entry hit the same code path.
 *
 * Runtime: **edge**. The handler uses web-standard `Request` /
 * `Response` / `ReadableStream` — all first-class on Edge. The
 * Node runtime's default handler signature is
 * `(req: IncomingMessage, res: ServerResponse)`, which is NOT what
 * we export here, and trying to invoke our Fetch-style handler on
 * Node produces `FUNCTION_INVOCATION_FAILED` in production.
 *
 * Edge also has tangible wins for this workload:
 *   - Streaming responses are the happy path, not an opt-in.
 *   - Cold starts measured in milliseconds — relevant when a
 *     visitor's first question is the one that lands.
 *   - `@upstash/ratelimit`, `@upstash/redis`, `ai`, and the configured
 *     AI SDK providers are Fetch-based and run on Edge without tweaks.
 */
import { handleAgentChat } from "../../src/server/agent-chat-handler.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
  return handleAgentChat(req);
}
