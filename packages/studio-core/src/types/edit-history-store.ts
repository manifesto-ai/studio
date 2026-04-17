import type { EditIntentEnvelope } from "./edit-intent.js";

export type EditHistoryQuery = {
  readonly sinceTimestamp?: number;
  readonly untilTimestamp?: number;
  readonly payloadKind?: EditIntentEnvelope["payloadKind"];
  readonly nextSchemaHash?: string;
  readonly limit?: number;
};

/**
 * EditHistoryStore — append-only ledger of envelopes.
 *
 * SE-HIST-2: stores must reject updates/deletes to individual records.
 * `clear()` exists for test harnesses and fresh-project bootstrapping; it is
 * NOT an append-only violation because it affects the whole ledger, not a
 * single record.
 *
 * `list(query?)` ordering contract (Phase 1 W1): results are ordered by
 * `(timestamp ASC, id ASC)`. Timestamps may tie at millisecond resolution
 * (see Phase 0 review §5 (j)); the secondary `id ASC` tiebreaker guarantees
 * a total order for deterministic replay. `getByCorrelation` follows the
 * same ordering.
 *
 * All methods are async so that disk-backed implementations (SQLite,
 * Lineage) share the same contract as in-memory.
 */
export type EditHistoryStore = {
  readonly append: (envelope: EditIntentEnvelope) => Promise<void>;
  readonly list: (
    query?: EditHistoryQuery,
  ) => Promise<readonly EditIntentEnvelope[]>;
  readonly getById: (id: string) => Promise<EditIntentEnvelope | null>;
  readonly getByCorrelation: (
    correlationId: string,
  ) => Promise<readonly EditIntentEnvelope[]>;
  readonly clear: () => Promise<void>;
  readonly close?: () => Promise<void>;
};
