/**
 * Enforces the package-extraction discipline spelled out in
 * `src/agent/README.md` and `docs/studio-agent-roadmap.md §0.3`:
 *
 *   tools/   agents/   session/
 *   ^^^^^^^^^^^^^^^^^^^^^^^^^^ future `studio-agent-core` — no React,
 *                              no Monaco, no webapp-local modules, no
 *                              relative imports into `ui/` or
 *                              `provider/`. LLM provider is hit via
 *                              a narrow injected interface.
 *
 *   provider/  ui/
 *   ^^^^^^^^^^^^^ webapp-only (provider) or future
 *                 `studio-agent-react` (ui). Free to import anything.
 *
 * The rule is enforced by reading every .ts / .tsx file under the
 * three restricted dirs and scanning its import specifiers against a
 * blocklist. No AST parse — a line-based grep is accurate enough for
 * ES module imports and catches the classes of mistakes we actually
 * worry about (accidental React leak, pulling `@/...` webapp aliases,
 * cross-dir into `ui/` etc.). If a valid import gets flagged, add it
 * to `ALLOWED_EXCEPTIONS` with a justifying comment.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = join(here, "..");

const RESTRICTED_DIRS = ["tools", "agents", "session"] as const;

/**
 * Import specifiers (or specifier prefixes) that `tools/ | agents/ |
 * session/` are not allowed to use. Each entry is matched against the
 * import's module string with either an exact-equals or
 * `.startsWith("<entry>/")` / `.startsWith("<entry>")` check based on
 * the `match` field.
 */
const BLOCKED: readonly { readonly spec: string; readonly reason: string }[] = [
  { spec: "react", reason: "React runtime — UI concern, keep out of future-core." },
  { spec: "react-dom", reason: "React DOM — UI concern." },
  { spec: "react/jsx-runtime", reason: "JSX — UI concern." },
  { spec: "motion/react", reason: "Motion — UI concern." },
  { spec: "monaco-editor", reason: "Monaco — webapp editor, keep out of future-core." },
  { spec: "@manifesto-ai/studio-adapter-monaco", reason: "Monaco adapter — webapp-only." },
  { spec: "@/", reason: "Webapp alias — leak across boundary." },
  { spec: "../ui", reason: "Cross-dir into ui/ — ui depends on core, not the other way." },
  { spec: "../provider", reason: "Direct provider import — pass via injected arg instead." },
];

/**
 * Specifiers that are always allowed even if a blocklist entry matches.
 * Intentionally narrow — this is for type-only shared contracts that
 * have to cross dirs (e.g. the `ChatMessage` / `LlmProvider` interface
 * the orchestrator talks to). Runtime code must still route through an
 * injected argument.
 */
const ALWAYS_ALLOWED: readonly string[] = [
  // The provider interface module is a pure contract; every caller
  // inside the future-core still receives the provider as an argument
  // (see `runOrchestrator({ provider })`), but we need to share the
  // `ChatMessage` / `ToolCall` shapes somewhere central.
  "../provider/types.js",
];

/**
 * Per-file exceptions. Key is the relative path from AGENT_ROOT, value
 * is the set of allowed-here specifiers that would otherwise match the
 * blocklist. Kept empty initially; add with a justifying comment if
 * genuinely needed.
 */
const ALLOWED_EXCEPTIONS: Record<string, readonly string[]> = {};

function collectSourceFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(name)) out.push(full);
  }
}

function extractImports(source: string): string[] {
  const specs: string[] = [];
  // Static `import X from "spec"` / `import "spec"` / `import type X from "spec"`.
  const importRe = /\bimport\s+(?:type\s+)?(?:[^'"]*from\s+)?["']([^"']+)["']/g;
  // Dynamic `import("spec")`.
  const dynamicRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  // `export ... from "spec"`.
  const exportFromRe = /\bexport\s+(?:type\s+)?\{[^}]*\}\s+from\s+["']([^"']+)["']/g;
  const exportStarRe = /\bexport\s+\*\s+from\s+["']([^"']+)["']/g;
  for (const re of [importRe, dynamicRe, exportFromRe, exportStarRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      specs.push(m[1]);
    }
  }
  return specs;
}

function violatesBlock(spec: string, blocked: { readonly spec: string }): boolean {
  const b = blocked.spec;
  if (spec === b) return true;
  // Prefix forms: `@/xxx` or `../ui/xxx` etc.
  if (b.endsWith("/") && spec.startsWith(b)) return true;
  if (spec.startsWith(`${b}/`)) return true;
  return false;
}

describe("agent package-extraction boundaries", () => {
  for (const dir of RESTRICTED_DIRS) {
    it(`${dir}/ — no disallowed imports`, () => {
      const files: string[] = [];
      collectSourceFiles(join(AGENT_ROOT, dir), files);
      const violations: string[] = [];
      for (const file of files) {
        const rel = relative(AGENT_ROOT, file);
        const source = readFileSync(file, "utf8");
        const imports = extractImports(source);
        const exceptions = ALLOWED_EXCEPTIONS[rel] ?? [];
        for (const spec of imports) {
          if (ALWAYS_ALLOWED.includes(spec)) continue;
          if (exceptions.includes(spec)) continue;
          for (const block of BLOCKED) {
            if (violatesBlock(spec, block)) {
              violations.push(
                `  ${rel} imports "${spec}" — ${block.reason}`,
              );
              break;
            }
          }
        }
      }
      if (violations.length > 0) {
        throw new Error(
          `agent boundary violations in ${dir}/:\n${violations.join("\n")}\n\n` +
            `If an import is genuinely required, add an entry to ` +
            `ALLOWED_EXCEPTIONS in this test file with a justifying comment.`,
        );
      }
    });
  }
});
