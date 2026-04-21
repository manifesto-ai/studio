import type {
  EditHistoryQuery,
  EditHistoryStore,
} from "../types/edit-history-store.js";
import type { EditIntentEnvelope } from "../types/edit-intent.js";

function matches(
  envelope: EditIntentEnvelope,
  query: EditHistoryQuery,
): boolean {
  if (
    query.sinceTimestamp !== undefined &&
    envelope.timestamp < query.sinceTimestamp
  ) {
    return false;
  }
  if (
    query.untilTimestamp !== undefined &&
    envelope.timestamp > query.untilTimestamp
  ) {
    return false;
  }
  if (
    query.payloadKind !== undefined &&
    envelope.payloadKind !== query.payloadKind
  ) {
    return false;
  }
  if (
    query.nextSchemaHash !== undefined &&
    envelope.nextSchemaHash !== query.nextSchemaHash
  ) {
    return false;
  }
  return true;
}

function compareEnvelopes(a: EditIntentEnvelope, b: EditIntentEnvelope): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Default in-memory store. Append-only (SE-HIST-2).
 * Ordering contract (see `EditHistoryStore` doc): `list()` and
 * `getByCorrelation()` return `(timestamp ASC, id ASC)`.
 */
export function createInMemoryEditHistoryStore(): EditHistoryStore {
  const records: EditIntentEnvelope[] = [];

  return {
    async append(envelope) {
      if (records.some((r) => r.id === envelope.id)) {
        throw new Error(
          `[studio-core] duplicate envelope id: ${envelope.id}`,
        );
      }
      records.push(envelope);
    },
    async list(query) {
      const q = query ?? {};
      const filtered = records.filter((r) => matches(r, q));
      filtered.sort(compareEnvelopes);
      if (q.limit !== undefined) return filtered.slice(0, q.limit);
      return filtered;
    },
    async getById(id) {
      return records.find((r) => r.id === id) ?? null;
    },
    async getByCorrelation(correlationId) {
      return records
        .filter((r) => r.correlationId === correlationId)
        .sort(compareEnvelopes);
    },
    async clear() {
      records.length = 0;
    },
  };
}
