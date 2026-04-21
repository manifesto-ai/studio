import { defineConfig } from "tsup";

const release = process.env.MANIFESTO_RELEASE === "1";

export default defineConfig({
  entry: ["src/index.ts", "src/sqlite.ts"],
  format: "esm",
  tsconfig: "tsconfig.build.json",
  dts: true,
  clean: true,
  sourcemap: !release,
  minify: false,
  external: ["better-sqlite3"],
});
