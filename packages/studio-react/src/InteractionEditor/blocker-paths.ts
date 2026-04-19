import type { DispatchBlocker } from "@manifesto-ai/studio-core";

export function collectBlockerPaths(
  blockers: readonly DispatchBlocker[] | null,
): ReadonlySet<string> {
  if (blockers === null) return new Set();
  const out = new Set<string>();
  for (const blocker of blockers) {
    const candidate = blocker as {
      readonly field?: unknown;
      readonly path?: unknown;
    };
    if (typeof candidate.field === "string") out.add(candidate.field);
    if (typeof candidate.path === "string") out.add(candidate.path);
  }
  return out;
}
