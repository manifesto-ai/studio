/**
 * @manifesto-ai/studio-core/sqlite — Node-only SQLite-backed EditHistoryStore.
 *
 * Kept out of the main entry so browser builds (apps/webapp) do not pull
 * `better-sqlite3`, `node:fs`, or `node:path` into their bundle. Node
 * consumers (CLI REPL, Vercel server functions, replay tooling) import
 * from this subpath.
 */
export {
  createSqliteEditHistoryStore,
  defaultEditHistoryDbPath,
  type SqliteStoreOptions,
} from "./internal/sqlite-edit-history-store.js";
