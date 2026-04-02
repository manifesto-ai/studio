import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  outDir: "dist",
  platform: "node",
  banner: {
    js: "#!/usr/bin/env node"
  },
  external: ["@manifesto-ai/studio-node", "@modelcontextprotocol/sdk", "zod"]
});
