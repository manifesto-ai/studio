import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  // `VITE_OLLAMA_URL` is used by `src/agent/provider/ollama.ts` at
  // runtime. We also mirror it into a dev-server proxy rooted at
  // `/ollama-api` so the agent can bypass CORS when the Ollama server
  // hasn't configured `OLLAMA_ORIGINS` for our origin. Opt-in: set the
  // provider's URL to `/ollama-api` instead of the absolute URL.
  const env = loadEnv(mode, process.cwd(), "");
  const ollamaTarget = env.VITE_OLLAMA_URL?.trim();

  return {
    plugins: [react(), tailwindcss()],
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
      proxy:
        ollamaTarget !== undefined && ollamaTarget !== ""
          ? {
              "/ollama-api": {
                target: ollamaTarget,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/ollama-api/, ""),
                // Streaming responses need no transform; keep timeout
                // generous to cover cold model loads.
                timeout: 120_000,
              },
            }
          : undefined,
    },
    assetsInclude: ["**/*.mel"],
  };
});
