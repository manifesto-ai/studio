#!/usr/bin/env node
// INV-SE-1: the widget-INDEPENDENT core package must not depend on any
// widget / UI framework library. Adapter packages (e.g. studio-adapter-monaco,
// studio-react) are by design allowed to bring their widget of choice.
//
// The gate scans only packages listed in STUDIO_CORE_PACKAGES. New packages
// appended to that list automatically inherit the widget ban.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pkgDir = join(repoRoot, "packages");

const STUDIO_CORE_PACKAGES = [
  "studio-core",
];

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

let checked = 0;
for (const pkg of STUDIO_CORE_PACKAGES) {
  const pkgJsonPath = join(pkgDir, pkg, "package.json");
  if (!existsSync(pkgJsonPath) || !statSync(pkgJsonPath).isFile()) {
    console.error(
      `[check-no-widget-deps] missing core package manifest: ${pkgJsonPath}`,
    );
    failed = true;
    continue;
  }
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
  checked += 1;
}

if (failed) {
  console.error(
    "\nINV-SE-1 violated: widget library dependency detected in a widget-independent core package.",
  );
  process.exit(1);
}
console.log(
  `[check-no-widget-deps] OK — INV-SE-1 satisfied (${checked} core package${checked === 1 ? "" : "s"} scanned).`,
);
