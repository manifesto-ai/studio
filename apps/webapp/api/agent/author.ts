/**
 * Vercel Function entry for `/api/agent/author`.
 * Runs the delegated headless MEL Author Agent.
 */
import { handleAgentAuthor } from "../../src/server/agent-author-handler.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
  return handleAgentAuthor(req);
}
