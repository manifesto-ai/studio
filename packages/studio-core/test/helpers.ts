import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

export function toSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readGolden<T>(filename: string): T {
  const absolutePath = path.join(TEST_DIR, "golden", filename);
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

export function listSourceFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(absolutePath);
    }

    if (!entry.isFile() || !absolutePath.endsWith(".ts")) {
      return [];
    }

    return [absolutePath];
  });
}

export function readText(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

export function getRepoRelativePath(absolutePath: string): string {
  return path.relative(path.join(TEST_DIR, ".."), absolutePath);
}

export function exists(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}
