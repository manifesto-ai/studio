#!/usr/bin/env node
// INV-SE-1: studio packages must not depend on any widget/UI framework library.
// Runs over packages/*/package.json and fails if any forbidden dependency is declared.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pkgDir = join(repoRoot, "packages");

const DENY_EXACT = new Set([
  "react",
  "react-dom",
  "react-native",
  "vue",
  "svelte",
  "solid-js",
  "preact",
  "lit",
  "lit-element",
  "lit-html",
  "monaco-editor",
  "codemirror",
]);

const DENY_PREFIX = [
  "@monaco-editor/",
  "@codemirror/",
  "@vue/",
  "@lit/",
  "@preact/",
  "@types/react",
];

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function isForbidden(depName) {
  if (DENY_EXACT.has(depName)) return true;
  return DENY_PREFIX.some((prefix) => depName.startsWith(prefix));
}

let failed = false;

if (!existsSync(pkgDir)) {
  console.log("[check-no-widget-deps] packages/ not present yet, nothing to check.");
  process.exit(0);
}

for (const pkg of readdirSync(pkgDir)) {
  const pkgJsonPath = join(pkgDir, pkg, "package.json");
  if (!existsSync(pkgJsonPath) || !statSync(pkgJsonPath).isFile()) continue;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  } catch (err) {
    console.error(`[check-no-widget-deps] failed to parse ${pkgJsonPath}: ${err.message}`);
    failed = true;
    continue;
  }
  for (const section of DEP_SECTIONS) {
    const deps = manifest[section] ?? {};
    for (const dep of Object.keys(deps)) {
      if (isForbidden(dep)) {
        console.error(
          `[check-no-widget-deps] ${pkgJsonPath} ${section} contains forbidden dependency: ${dep}`,
        );
        failed = true;
      }
    }
  }
}

if (failed) {
  console.error("\nINV-SE-1 violated: widget library dependency detected in studio packages.");
  process.exit(1);
}
console.log("[check-no-widget-deps] OK — INV-SE-1 satisfied.");
