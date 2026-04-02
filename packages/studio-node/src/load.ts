import { dirname, extname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  compileMelDomain,
  type Diagnostic
} from "@manifesto-ai/compiler";
import type {
  AnalysisBundle,
  DomainSchema
} from "@manifesto-ai/studio-core";

import type { StudioBundleFile, StudioFileInput } from "./contracts.js";

function resolveInputPath(cwd: string, inputPath: string): string {
  return resolve(cwd, inputPath);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const contents = await readFile(filePath, "utf8");
  return JSON.parse(contents) as T;
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.location;

  if (!location) {
    return `[${diagnostic.code}] ${diagnostic.message}`;
  }

  return `[${diagnostic.code}] ${diagnostic.message} (${location.start.line}:${location.start.column})`;
}

async function loadSchemaFromPath(schemaPath: string): Promise<DomainSchema> {
  const extension = extname(schemaPath).toLowerCase();

  if (extension === ".mel") {
    const source = await readFile(schemaPath, "utf8");
    const result = compileMelDomain(source, { mode: "domain" });

    if (result.errors.length > 0) {
      const details = result.errors.map(formatDiagnostic).join("\n");
      throw new Error(`MEL compilation failed for ${schemaPath}\n${details}`);
    }

    if (!result.schema) {
      throw new Error(`MEL compilation produced no schema for ${schemaPath}`);
    }

    return result.schema;
  }

  if (extension === ".json") {
    return readJsonFile<DomainSchema>(schemaPath);
  }

  throw new Error(
    `Unsupported schema input "${schemaPath}". Expected .mel or .json.`
  );
}

async function maybeReadJsonFile<T>(
  baseDir: string,
  inlineValue: T | undefined,
  referencedPath: string | undefined
): Promise<T | undefined> {
  if (inlineValue !== undefined) {
    return inlineValue;
  }

  if (!referencedPath) {
    return undefined;
  }

  return readJsonFile<T>(resolveInputPath(baseDir, referencedPath));
}

async function loadBundleFile(bundlePath: string): Promise<AnalysisBundle> {
  const bundle = await readJsonFile<StudioBundleFile>(bundlePath);
  const baseDir = dirname(bundlePath);

  const schema =
    bundle.schema ??
    (bundle.schemaPath
      ? await loadSchemaFromPath(resolveInputPath(baseDir, bundle.schemaPath))
      : undefined);

  if (!schema) {
    throw new Error(
      `Bundle "${bundlePath}" must include either "schema" or "schemaPath".`
    );
  }

  return {
    schema,
    snapshot: await maybeReadJsonFile(baseDir, bundle.snapshot, bundle.snapshotPath),
    trace: await maybeReadJsonFile(baseDir, bundle.trace, bundle.tracePath),
    lineage: await maybeReadJsonFile(baseDir, bundle.lineage, bundle.lineagePath),
    governance: await maybeReadJsonFile(
      baseDir,
      bundle.governance,
      bundle.governancePath
    )
  };
}

export async function loadAnalysisBundleFromFiles(
  input: StudioFileInput
): Promise<AnalysisBundle> {
  const cwd = input.cwd ?? process.cwd();
  const hasBundlePath = Boolean(input.bundlePath);
  const hasPerFileInput =
    Boolean(input.schemaPath) ||
    Boolean(input.snapshotPath) ||
    Boolean(input.tracePath) ||
    Boolean(input.lineagePath) ||
    Boolean(input.governancePath);

  if (hasBundlePath && hasPerFileInput) {
    throw new Error(
      "Use either bundlePath or per-file schema/snapshot/trace/lineage/governance paths, not both."
    );
  }

  if (input.bundlePath) {
    return loadBundleFile(resolveInputPath(cwd, input.bundlePath));
  }

  if (!input.schemaPath) {
    throw new Error(
      "schemaPath is required when bundlePath is not provided."
    );
  }

  const schema = await loadSchemaFromPath(resolveInputPath(cwd, input.schemaPath));

  return {
    schema,
    snapshot: input.snapshotPath
      ? await readJsonFile(resolveInputPath(cwd, input.snapshotPath))
      : undefined,
    trace: input.tracePath
      ? await readJsonFile(resolveInputPath(cwd, input.tracePath))
      : undefined,
    lineage: input.lineagePath
      ? await readJsonFile(resolveInputPath(cwd, input.lineagePath))
      : undefined,
    governance: input.governancePath
      ? await readJsonFile(resolveInputPath(cwd, input.governancePath))
      : undefined
  };
}
