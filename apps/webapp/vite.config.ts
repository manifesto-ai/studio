import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
});
