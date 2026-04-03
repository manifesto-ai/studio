import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createStudioSession } from "../src/index.js";
import {
  createSampleSnapshot,
  sampleGovernance,
  sampleLineage,
  sampleSchema,
  sampleTrace
} from "./fixtures/sample-domain.js";
import { getRepoRelativePath, listSourceFiles, readText, toSerializable } from "./helpers.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TEST_DIR, "..");
const SRC_ROOT = path.join(PACKAGE_ROOT, "src");
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");
const LAYER_ORDER = [
  "contracts",
  "ingest",
  "graph",
  "analysis",
  "explanation",
  "projection",
  "session"
] as const;
type Layer = (typeof LAYER_ORDER)[number];
const LAYER_INDEX = new Map(LAYER_ORDER.map((layer, index) => [layer, index]));
const ALLOWED_CORE_IMPORTS = new Set([
  "src/contracts/inputs.ts",
  "src/session/core-oracle.ts"
]);
const RENDERER_KEYS = new Set([
  "className",
  "color",
  "height",
  "layout",
  "position",
  "style",
  "transform",
  "width",
  "x",
  "y"
]);
const ONTOLOGY_KEYS = new Set(["commit", "dispatch", "execute", "mutate", "trigger"]);

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

function getLayer(absolutePath: string): Layer | undefined {
  const [first] = path.relative(SRC_ROOT, absolutePath).split(path.sep);
  return LAYER_INDEX.has(first as Layer) ? (first as Layer) : undefined;
}

function resolveImport(sourceFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const basePath = path.resolve(path.dirname(sourceFile), specifier);
  const candidates = specifier.endsWith(".js")
    ? [basePath.slice(0, -3) + ".ts", path.join(basePath.slice(0, -3), "index.ts")]
    : [basePath + ".ts", path.join(basePath, "index.ts")];

  return candidates.find((candidate) => candidate.startsWith(SRC_ROOT));
}

function collectImports(sourceText: string): string[] {
  return [...sourceText.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
}

function collectCoreImports(sourceText: string): Array<{ isTypeOnly: boolean }> {
  return [...sourceText.matchAll(/import\s+(type\s+)?[\s\S]*?from\s+["']@manifesto-ai\/core["']/g)].map(
    (match) => ({
      isTypeOnly: Boolean(match[1])
    })
  );
}

function collectKeys(value: JsonLike, into: Set<string>): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, into);
    }
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    into.add(key);
    collectKeys(entry, into);
  }
}

describe("studio-core boundary and compliance", () => {
  it("preserves the source dependency DAG", () => {
    const violations: string[] = [];

    for (const sourceFile of listSourceFiles(SRC_ROOT)) {
      const sourceLayer = getLayer(sourceFile);
      if (!sourceLayer) {
        continue;
      }

      for (const specifier of collectImports(readText(sourceFile))) {
        const targetFile = resolveImport(sourceFile, specifier);
        if (!targetFile) {
          continue;
        }

        const targetLayer = getLayer(targetFile);
        if (!targetLayer) {
          continue;
        }

        if (LAYER_INDEX.get(sourceLayer)! < LAYER_INDEX.get(targetLayer)!) {
          violations.push(
            `${getRepoRelativePath(sourceFile)} imports higher layer ${getRepoRelativePath(targetFile)}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("limits direct core imports to the contract boundary and session oracle adapter", () => {
    const violations = listSourceFiles(SRC_ROOT)
      .flatMap((absolutePath) =>
        collectCoreImports(readText(absolutePath)).map((coreImport) => ({
          relativePath: getRepoRelativePath(absolutePath),
          ...coreImport
        }))
      )
      .filter(
        ({ isTypeOnly, relativePath }) =>
          !isTypeOnly && !ALLOWED_CORE_IMPORTS.has(relativePath)
      )
      .map(({ relativePath }) => relativePath);

    expect(violations).toEqual([]);
  });

  it("does not parse MEL or depend on private runtime packages", () => {
    const sourceFiles = listSourceFiles(SRC_ROOT);
    const melMentions = sourceFiles
      .filter((absolutePath) =>
        /\b(parseMel|compileMel|evaluateMel|MEL)\b/.test(readText(absolutePath))
      )
      .map((absolutePath) => getRepoRelativePath(absolutePath));

    expect(melMentions).toEqual([]);

    const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).toEqual({
      "@manifesto-ai/core": "^2.9.0",
      "@manifesto-ai/sdk": "^3.4.0"
    });
  });

  it("keeps projections renderer-neutral and ontology-safe", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot(),
      trace: sampleTrace,
      lineage: sampleLineage,
      governance: sampleGovernance
    });
    const payloads = toSerializable([
      session.getGraph("full"),
      session.getFindings(),
      session.getActionAvailability(),
      session.explainActionBlocker("submit"),
      session.inspectSnapshot(),
      session.analyzeTrace(),
      session.getLineageState(),
      session.getGovernanceState()
    ]) as JsonLike;
    const keys = new Set<string>();

    collectKeys(payloads, keys);

    expect([...keys].filter((key) => RENDERER_KEYS.has(key))).toEqual([]);
    expect([...keys].filter((key) => ONTOLOGY_KEYS.has(key))).toEqual([]);
  });
});
