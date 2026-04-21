import type { Snapshot } from "@manifesto-ai/studio-core";

/**
 * Heuristic string-suggestion source for action form inputs. When a
 * field's label looks like an id reference (`*Id`, `*Ref`, etc.), the
 * dropdown offers existing ids pulled out of array-valued state on
 * the current snapshot. This is the same logic that the old
 * ActionDispatchPopover ran inline; lifted up to InteractionEditor so
 * the Interact lens gets the same convenience.
 *
 * Keep the heuristic conservative — we don't want to spam suggestions
 * on unrelated string fields. If it guesses wrong users can still
 * type freely; the dropdown is advisory.
 */

export type StateArrayMap = ReadonlyMap<string, readonly unknown[]>;

export function collectStateArrays(
  snapshot: Snapshot<unknown> | null,
): StateArrayMap {
  const map = new Map<string, readonly unknown[]>();
  const data = (snapshot as { readonly data?: unknown } | null)?.data;
  if (data === null || data === undefined || typeof data !== "object") {
    return map;
  }
  for (const [key, next] of Object.entries(data as Record<string, unknown>)) {
    if (Array.isArray(next)) map.set(key, next);
  }
  return map;
}

/**
 * Given a field label and every array-valued state, return up to 20
 * candidate id strings. Triggers only when the label looks like an id
 * reference — ends with `id` or contains `ref` (case-insensitive).
 */
export function suggestIds(
  fieldName: string,
  arrays: StateArrayMap,
): string[] {
  const lower = fieldName.toLowerCase();
  if (!lower.endsWith("id") && !lower.includes("ref")) return [];
  const out: string[] = [];
  for (const items of arrays.values()) {
    for (const item of items) {
      if (item === null || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      for (const [key, next] of Object.entries(record)) {
        if (
          key.toLowerCase() === "id" ||
          key.toLowerCase() === fieldName.toLowerCase()
        ) {
          if (typeof next === "string") out.push(next);
        }
      }
    }
  }
  return Array.from(new Set(out)).slice(0, 20);
}
