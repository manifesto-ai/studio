import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
    port: 5173,
    strictPort: false,
  },
  assetsInclude: ["**/*.mel"],
});
