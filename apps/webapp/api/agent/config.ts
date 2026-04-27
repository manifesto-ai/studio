/**
 * Vercel Function entry for `/api/agent/config`.
 * Returns the non-secret model selection the agent server will use.
 */
import { handleAgentConfig } from "../../src/server/agent-chat-handler.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
  return handleAgentConfig(req);
}
