/**
 * Vercel serverless function entry — thin wrapper over the shared
 * handler so both the Vite dev middleware (see `vite.config.ts`)
 * and the deployed `/api/agent/chat` endpoint run the exact same
 * code path.
 *
 * Deployed URL: https://<domain>/api/agent/chat
 * Local dev URL: http://localhost:5173/api/agent/chat
 *
 * Runtime: Edge would work, but we use Node runtime so the AI SDK's
 * default streaming behaviour (without `experimental_*` flags)
 * matches exactly what the dev middleware serves.
 */
import { handleAgentChat } from "../../src/server/agent-chat-handler.js";

export const config = {
  // Vercel autodetects runtime; keep explicit for clarity.
  runtime: "nodejs",
};

export default async function handler(req: Request): Promise<Response> {
  return handleAgentChat(req);
}
