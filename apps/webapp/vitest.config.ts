import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

// `viteConfig` is a callback (see `vite.config.ts` — it needs `loadEnv`
// for the Ollama proxy). Vitest's `mergeConfig` can't merge callbacks,
// so we resolve it against the test-mode env first.
export default defineConfig((env) =>
  mergeConfig(
    typeof viteConfig === "function" ? viteConfig(env) : viteConfig,
    {
      test: {
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
        environment: "jsdom",
        passWithNoTests: true,
      },
    },
  ),
);
