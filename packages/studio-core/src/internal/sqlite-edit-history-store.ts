import Database, { type Database as DatabaseInstance } from "better-sqlite3";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type {
  EditHistoryQuery,
  EditHistoryStore,
} from "../types/edit-history-store.js";
import type { EditIntentEnvelope } from "../types/edit-intent.js";

const CURRENT_SCHEMA_VERSION = 1;

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS edit_intents (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    envelope_version INTEGER NOT NULL,
    payload_kind TEXT NOT NULL,
    payload_version INTEGER NOT NULL,
    prev_schema_hash TEXT,
    next_schema_hash TEXT NOT NULL,
    author TEXT NOT NULL,
    correlation_id TEXT,
    causation_id TEXT,
    payload TEXT NOT NULL,
    plan TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_edit_intents_timestamp
    ON edit_intents(timestamp);
  CREATE INDEX IF NOT EXISTS idx_edit_intents_next_schema_hash
    ON edit_intents(next_schema_hash);
  CREATE INDEX IF NOT EXISTS idx_edit_intents_correlation_id
    ON edit_intents(correlation_id);
  CREATE TABLE IF NOT EXISTS studio_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,
];

function ensureDirectory(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(filePath);
  if (dir === "" || dir === ".") return;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readSchemaVersion(db: DatabaseInstance): number | null {
  const row = db
    .prepare(
      "SELECT value FROM studio_meta WHERE key = 'schema_version'",
    )
    .get() as { value: string } | undefined;
  if (row === undefined) return null;
  return Number.parseInt(row.value, 10);
}

function runMigrations(db: DatabaseInstance): void {
  db.exec(MIGRATIONS[0] as string);
  const existing = readSchemaVersion(db);
  if (existing === null) {
    db.prepare(
      "INSERT INTO studio_meta (key, value) VALUES ('schema_version', ?)",
    ).run(String(CURRENT_SCHEMA_VERSION));
  } else if (existing !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `[studio-core] unsupported edit-history schema version: ${existing}`,
    );
  }
}

type Row = {
  readonly id: string;
  readonly timestamp: number;
  readonly envelope_version: number;
  readonly payload_kind: string;
  readonly payload_version: number;
  readonly prev_schema_hash: string | null;
  readonly next_schema_hash: string;
  readonly author: string;
  readonly correlation_id: string | null;
  readonly causation_id: string | null;
  readonly payload: string;
  readonly plan: string;
};

function rowToEnvelope(row: Row): EditIntentEnvelope {
  return {
    id: row.id,
    timestamp: row.timestamp,
    envelopeVersion: row.envelope_version as 1,
    payloadKind: row.payload_kind as EditIntentEnvelope["payloadKind"],
    payloadVersion: row.payload_version as 1,
    prevSchemaHash: row.prev_schema_hash,
    nextSchemaHash: row.next_schema_hash,
    author: row.author as EditIntentEnvelope["author"],
    ...(row.correlation_id !== null ? { correlationId: row.correlation_id } : {}),
    ...(row.causation_id !== null ? { causationId: row.causation_id } : {}),
    payload: JSON.parse(row.payload),
    plan: JSON.parse(row.plan),
  };
}

export type SqliteStoreOptions = {
  readonly path: string;
};

/**
 * Resolve the default edit-history database path for a project root.
 * e.g. `.studio/edit-history.db` under the project directory.
 */
export function defaultEditHistoryDbPath(projectRoot: string): string {
  return `${projectRoot.replace(/\/$/, "")}/.studio/edit-history.db`;
}

export function createSqliteEditHistoryStore(
  options: SqliteStoreOptions,
): EditHistoryStore {
  ensureDirectory(options.path);
  const db = new Database(options.path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const insertStmt = db.prepare(`
    INSERT INTO edit_intents (
      id, timestamp, envelope_version, payload_kind, payload_version,
      prev_schema_hash, next_schema_hash, author,
      correlation_id, causation_id, payload, plan
    ) VALUES (
      @id, @timestamp, @envelope_version, @payload_kind, @payload_version,
      @prev_schema_hash, @next_schema_hash, @author,
      @correlation_id, @causation_id, @payload, @plan
    )
  `);

  const selectByIdStmt = db.prepare(
    "SELECT * FROM edit_intents WHERE id = ? LIMIT 1",
  );
  const selectByCorrStmt = db.prepare(
    "SELECT * FROM edit_intents WHERE correlation_id = ? ORDER BY timestamp ASC, id ASC",
  );
  const deleteAllStmt = db.prepare("DELETE FROM edit_intents");

  return {
    async append(envelope) {
      try {
        insertStmt.run({
          id: envelope.id,
          timestamp: envelope.timestamp,
          envelope_version: envelope.envelopeVersion,
          payload_kind: envelope.payloadKind,
          payload_version: envelope.payloadVersion,
          prev_schema_hash: envelope.prevSchemaHash,
          next_schema_hash: envelope.nextSchemaHash,
          author: envelope.author,
          correlation_id: envelope.correlationId ?? null,
          causation_id: envelope.causationId ?? null,
          payload: JSON.stringify(envelope.payload),
          plan: JSON.stringify(envelope.plan),
        });
      } catch (err) {
        if (
          err instanceof Error &&
          /UNIQUE constraint failed/i.test(err.message)
        ) {
          throw new Error(
            `[studio-core] duplicate envelope id: ${envelope.id}`,
          );
        }
        throw err;
      }
    },
    async list(query) {
      const q: EditHistoryQuery = query ?? {};
      const clauses: string[] = [];
      const params: Record<string, unknown> = {};
      if (q.sinceTimestamp !== undefined) {
        clauses.push("timestamp >= @sinceTimestamp");
        params.sinceTimestamp = q.sinceTimestamp;
      }
      if (q.untilTimestamp !== undefined) {
        clauses.push("timestamp <= @untilTimestamp");
        params.untilTimestamp = q.untilTimestamp;
      }
      if (q.payloadKind !== undefined) {
        clauses.push("payload_kind = @payloadKind");
        params.payloadKind = q.payloadKind;
      }
      if (q.nextSchemaHash !== undefined) {
        clauses.push("next_schema_hash = @nextSchemaHash");
        params.nextSchemaHash = q.nextSchemaHash;
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const limit = q.limit !== undefined ? "LIMIT @limit" : "";
      if (q.limit !== undefined) params.limit = q.limit;
      const sql = `SELECT * FROM edit_intents ${where} ORDER BY timestamp ASC, id ASC ${limit}`;
      const rows = db.prepare(sql).all(params) as Row[];
      return rows.map(rowToEnvelope);
    },
    async getById(id) {
      const row = selectByIdStmt.get(id) as Row | undefined;
      return row !== undefined ? rowToEnvelope(row) : null;
    },
    async getByCorrelation(correlationId) {
      const rows = selectByCorrStmt.all(correlationId) as Row[];
      return rows.map(rowToEnvelope);
    },
    async clear() {
      deleteAllStmt.run();
    },
    async close() {
      db.close();
    },
  };
}