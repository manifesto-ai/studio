import type { StudioSimulateResult } from "@manifesto-ai/studio-core";

export type SnapshotLike =
  | {
      readonly data?: unknown;
      readonly computed?: Record<string, unknown>;
    }
  | null;

export type SnapshotDiff = {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
};

export function extractSimulationSnapshot(
  result: StudioSimulateResult,
): SnapshotLike {
  const candidate = result as unknown as {
    readonly snapshot?: SnapshotLike;
    readonly data?: unknown;
    readonly computed?: Record<string, unknown>;
  };
  if (candidate.snapshot !== undefined) return candidate.snapshot;
  if (candidate.data !== undefined || candidate.computed !== undefined) {
    return { data: candidate.data, computed: candidate.computed };
  }
  return null;
}

export function collectSimulationDiffs(
  currentSnapshot: SnapshotLike,
  result: StudioSimulateResult,
): readonly SnapshotDiff[] {
  const candidate = result as unknown as {
    readonly changedPaths?: readonly string[];
  };
  const nextSnapshot = extractSimulationSnapshot(result);
  if (
    Array.isArray(candidate.changedPaths) &&
    candidate.changedPaths.length > 0
  ) {
    return candidate.changedPaths.map((path) => ({
      path,
      before: resolveValueAtPath(currentSnapshot, path),
      after: resolveValueAtPath(nextSnapshot, path),
    }));
  }
  return diffSnapshots(currentSnapshot, nextSnapshot);
}

export function diffSnapshots(
  before: SnapshotLike,
  after: SnapshotLike,
): readonly SnapshotDiff[] {
  const diffs: SnapshotDiff[] = [];
  if (before === null || after === null) return diffs;

  const beforeData = (before.data ?? {}) as Record<string, unknown>;
  const afterData = (after.data ?? {}) as Record<string, unknown>;
  const dataKeys = new Set([
    ...Object.keys(beforeData),
    ...Object.keys(afterData),
  ]);
  for (const key of dataKeys) {
    if (!deepEqual(beforeData[key], afterData[key])) {
      diffs.push({
        path: `data.${key}`,
        before: beforeData[key],
        after: afterData[key],
      });
    }
  }

  const beforeComputed = before.computed ?? {};
  const afterComputed = after.computed ?? {};
  const computedKeys = new Set([
    ...Object.keys(beforeComputed),
    ...Object.keys(afterComputed),
  ]);
  for (const key of computedKeys) {
    if (!deepEqual(beforeComputed[key], afterComputed[key])) {
      diffs.push({
        path: `computed.${key}`,
        before: beforeComputed[key],
        after: afterComputed[key],
      });
    }
  }

  return diffs;
}

export function resolveValueAtPath(root: unknown, path: string): unknown {
  if (root === null || root === undefined) return undefined;
  let current: unknown = root;
  for (const segment of tokenizePath(path)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function tokenizePath(path: string): readonly string[] {
  return path
    .replace(/\[([^\]]+)\]/g, (_, raw: string) => {
      const next = raw.replace(/^["']|["']$/g, "");
      return `.${next}`;
    })
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== "$");
}

export function sortPaths(paths: readonly string[]): readonly string[] {
  return [...paths].sort((left, right) => {
    const leftRank = namespaceRank(left);
    const rightRank = namespaceRank(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });
}

export function summarizePreviewValue(value: unknown, max = 80): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > max
      ? `${serialized.slice(0, max - 1)}...`
      : serialized;
  } catch {
    return "(value)";
  }
}

function namespaceRank(path: string): number {
  const head = tokenizePath(path)[0] ?? "";
  switch (head) {
    case "data":
      return 0;
    case "computed":
      return 1;
    case "system":
      return 2;
    default:
      return 3;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => deepEqual(left[key], right[key]));
}
