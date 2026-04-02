import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createDomainPlugin, generate } from "@manifesto-ai/codegen";
import { melPlugin } from "@manifesto-ai/compiler/vite";
import { defineConfig } from "vite";

function createMelCodegen() {
  return async ({
    schema,
    sourceId
  }: {
    schema: Parameters<typeof generate>[0]["schema"];
    sourceId: string;
  }) => {
    const normalized = sourceId.replaceAll("\\", "/");
    const relativePath = normalized.startsWith("src/domain/")
      ? normalized.slice("src/domain/".length)
      : normalized.split("/").at(-1) ?? normalized;

    return generate({
      schema,
      sourceId,
      outDir: "src/generated",
      plugins: [
        createDomainPlugin({
          fileName: relativePath.replace(/\.mel$/, ".domain.ts")
        })
      ]
    });
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    melPlugin({
      codegen: createMelCodegen()
    })
  ],
  resolve: {
    alias: {
      "@manifesto-ai/studio-ui": fileURLToPath(
        new URL("../../packages/studio-ui/src/index.ts", import.meta.url)
      ),
      "@manifesto-ai/ui-core": fileURLToPath(
        new URL("../../packages/ui-core/src/index.ts", import.meta.url)
      ),
      "@manifesto-ai/studio-core": fileURLToPath(
        new URL("../../packages/studio-core/src/index.ts", import.meta.url)
      ),
      "@manifesto-ai/mel-editor": fileURLToPath(
        new URL("../../packages/mel-editor/src/index.ts", import.meta.url)
      ),
      "@manifesto-ai/studio-ui/styles.css": fileURLToPath(
        new URL("../../packages/studio-ui/src/styles.css", import.meta.url)
      ),
      "@manifesto-ai/ui-core/styles.css": fileURLToPath(
        new URL("../../packages/ui-core/src/styles.css", import.meta.url)
      )
    }
  },
  worker: {
    format: "es"
  }
});
