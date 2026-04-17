import type { CanonicalSnapshot } from "@manifesto-ai/sdk";
import type { LocalTargetKey, ReconciliationPlan } from "../types/reconciliation.js";

const STATE_FIELD_PREFIX = "state_field:";

function extractStateFieldName(key: LocalTargetKey): string | null {
  if (!key.startsWith(STATE_FIELD_PREFIX)) return null;
  return key.slice(STATE_FIELD_PREFIX.length);
}

export function buildOverlaySnapshot(
  prev: CanonicalSnapshot<unknown>,
  next: CanonicalSnapshot<unknown>,
  plan: ReconciliationPlan,
): CanonicalSnapshot<unknown> {
  const preservedFields = plan.snapshotPlan.preserved;
  if (preservedFields.length === 0) return next;

  const prevData = (prev as { readonly data?: Record<string, unknown> }).data ?? {};
  const nextData = (next as { readonly data?: Record<string, unknown> }).data ?? {};

  const mergedData: Record<string, unknown> = { ...nextData };
  for (const key of preservedFields) {
    const name = extractStateFieldName(key);
    if (name === null) continue;
    if (Object.prototype.hasOwnProperty.call(prevData, name)) {
      mergedData[name] = prevData[name];
    }
  }

  return {
    ...next,
    data: mergedData,
  } as CanonicalSnapshot<unknown>;
}
