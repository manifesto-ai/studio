import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { IncomingMessage, ServerResponse } from "node:http";

/**
 * Dev-only middleware: serves `/api/agent/chat` locally using the
 * same `handleAgentChat(Request)` the Vercel serverless function
 * uses in production. Keeps one source of truth for the handler
 * and means "works in dev, works in prod" is enforced by sharing
 * code, not by parallel implementations.
 */
function agentChatDevPlugin(): Plugin {
  return {
    name: "manifesto:agent-chat-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/api/agent/chat",
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            // Load handler via the dev server's SSR runtime so edits
            // hot-reload without restarting Vite.
            const mod = (await server.ssrLoadModule(
              "/src/server/agent-chat-handler.ts",
            )) as typeof import("./src/server/agent-chat-handler.js");
            const webRequest = await nodeRequestToWebRequest(req);
            const webResponse = await mod.handleAgentChat(webRequest);
            await writeWebResponseToNode(webResponse, res);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error:
                  err instanceof Error ? err.message : String(err),
              }),
            );
          }
        },
      );
    },
  };
}

async function nodeRequestToWebRequest(
  req: IncomingMessage,
): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;
  // Propagate client disconnect into the Web Request's signal so the
  // AI SDK streamText call cancels when the browser aborts. Without
  // this, a stopped generation on the client keeps billing tokens on
  // the gateway until the model finishes on its own.
  const controller = new AbortController();
  req.once("close", () => {
    if (!req.complete) controller.abort();
  });
  return new Request(url, {
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, Array.isArray(v) ? v.join(",") : v]],
      ),
    ),
    body,
    signal: controller.signal,
  });
}

async function writeWebResponseToNode(
  webRes: Response,
  nodeRes: ServerResponse,
): Promise<void> {
  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((v, k) => nodeRes.setHeader(k, v));
  if (webRes.body === null) {
    nodeRes.end();
    return;
  }
  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      nodeRes.write(value);
    }
  } finally {
    nodeRes.end();
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Mirror AI_GATEWAY_API_KEY into process.env so the shared handler
  // (which reads process.env) sees it in dev. The prod serverless
  // runtime gets the same var from Vercel's project settings.
  if (
    env.AI_GATEWAY_API_KEY !== undefined &&
    process.env.AI_GATEWAY_API_KEY === undefined
  ) {
    process.env.AI_GATEWAY_API_KEY = env.AI_GATEWAY_API_KEY;
  }
  if (
    env.AI_GATEWAY_MODEL !== undefined &&
    process.env.AI_GATEWAY_MODEL === undefined
  ) {
    process.env.AI_GATEWAY_MODEL = env.AI_GATEWAY_MODEL;
  }

  return {
    plugins: [react(), tailwindcss(), agentChatDevPlugin()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@manifesto-ai/studio-react": fileURLToPath(
          new URL("../../packages/studio-react/src/index.ts", import.meta.url),
        ),
      },
    },
    build: {
      target: "es2022",
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            // Isolate the Monaco chunk so route-level lazy loading can defer it
            // until the editor surface is actually mounted.
            monaco: ["monaco-editor"],
          },
        },
      },
    },
    server: {
      port: 5180,
      strictPort: true,
    },
    assetsInclude: ["**/*.mel"],
  };
});
