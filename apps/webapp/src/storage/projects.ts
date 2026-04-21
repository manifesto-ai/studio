/**
 * IndexedDB-backed project storage.
 *
 * A "project" is a named MEL source file with minimal metadata. The
 * store is kept simple so the MVP can ship without cloud infra:
 * everything lives in the user's browser via IndexedDB (5-10 MB hard
 * limit on localStorage was the driver for not using it). Bundles
 * (import/export) give users an escape hatch for backup, machine
 * transfer, and informal sharing until a server-side story lands.
 *
 * Schema version 1:
 *   - `projects` store, keyed by id, indexed by lastOpenedAt
 *   - `meta`     store, keyed by string (currently only
 *                       `lastActiveProjectId`)
 *
 * All APIs return plain records (not IDBCursor / IDBRequest) so the
 * React layer can treat them as vanilla async functions.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type ProjectOrigin =
  | { readonly kind: "blank" }
  | { readonly kind: "template"; readonly templateId: string }
  | { readonly kind: "imported"; readonly importedAt: number }
  | { readonly kind: "cloned"; readonly sourceProjectId: string };

export type ProjectRecord = {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastOpenedAt: number;
  readonly origin: ProjectOrigin;
};

interface StudioSchema extends DBSchema {
  projects: {
    key: string;
    value: ProjectRecord;
    indexes: { lastOpenedAt: number };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = "manifesto-studio";
const DB_VERSION = 1;
const META_LAST_ACTIVE = "lastActiveProjectId";

let dbPromise: Promise<IDBPDatabase<StudioSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<StudioSchema>> {
  if (dbPromise === null) {
    dbPromise = openDB<StudioSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("projects")) {
          const projects = db.createObjectStore("projects", {
            keyPath: "id",
          });
          projects.createIndex("lastOpenedAt", "lastOpenedAt");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID !== undefined) return g.crypto.randomUUID();
  // Fallback — not cryptographically random but unique enough for a
  // single-browser store. MDN notes crypto.randomUUID is available in
  // all modern browsers; this branch is belt-and-braces.
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function listProjects(): Promise<readonly ProjectRecord[]> {
  const db = await getDb();
  const all = await db.getAll("projects");
  // Sort by lastOpenedAt desc — the user's most recent work at the top.
  return [...all].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getProject(
  id: string,
): Promise<ProjectRecord | null> {
  const db = await getDb();
  const rec = await db.get("projects", id);
  return rec ?? null;
}

export async function createProject(input: {
  readonly name: string;
  readonly source: string;
  readonly origin?: ProjectOrigin;
}): Promise<ProjectRecord> {
  const db = await getDb();
  const now = Date.now();
  const record: ProjectRecord = {
    id: newId(),
    name: input.name,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    origin: input.origin ?? { kind: "blank" },
  };
  await db.put("projects", record);
  return record;
}

export async function updateProjectSource(
  id: string,
  source: string,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get("projects", id);
  if (existing === undefined) return;
  if (existing.source === source) return; // no-op guard
  const next: ProjectRecord = {
    ...existing,
    source,
    updatedAt: Date.now(),
  };
  await db.put("projects", next);
}

export async function renameProject(
  id: string,
  name: string,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get("projects", id);
  if (existing === undefined) return;
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === existing.name) return;
  const next: ProjectRecord = {
    ...existing,
    name: trimmed,
    updatedAt: Date.now(),
  };
  await db.put("projects", next);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("projects", id);
  const lastActive = await getLastActiveProjectId();
  if (lastActive === id) await setLastActiveProjectId(null);
}

export async function touchProject(id: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get("projects", id);
  if (existing === undefined) return;
  const next: ProjectRecord = { ...existing, lastOpenedAt: Date.now() };
  await db.put("projects", next);
}

export async function getLastActiveProjectId(): Promise<string | null> {
  const db = await getDb();
  const v = await db.get("meta", META_LAST_ACTIVE);
  return typeof v === "string" ? v : null;
}

export async function setLastActiveProjectId(
  id: string | null,
): Promise<void> {
  const db = await getDb();
  if (id === null) {
    await db.delete("meta", META_LAST_ACTIVE);
  } else {
    await db.put("meta", id, META_LAST_ACTIVE);
  }
}

// --------------------------------------------------------------------
// Import / Export bundles
// --------------------------------------------------------------------

/**
 * Bundle format for sharing projects as a single JSON blob. Version
 * stamp + `format` marker let future versions migrate while rejecting
 * unrelated JSON payloads.
 */
export type ProjectBundleV1 = {
  readonly format: "manifesto-studio-bundle";
  readonly version: 1;
  readonly exportedAt: number;
  readonly projects: readonly {
    readonly name: string;
    readonly source: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly origin: ProjectOrigin;
  }[];
};

export function serializeBundle(
  projects: readonly ProjectRecord[],
): string {
  const bundle: ProjectBundleV1 = {
    format: "manifesto-studio-bundle",
    version: 1,
    exportedAt: Date.now(),
    projects: projects.map((p) => ({
      name: p.name,
      source: p.source,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      origin: p.origin,
    })),
  };
  return JSON.stringify(bundle, null, 2);
}

export type ImportResult = {
  readonly imported: readonly ProjectRecord[];
  readonly errors: readonly string[];
};

export async function importBundle(json: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { imported: [], errors: ["Not valid JSON."] };
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    (parsed as { format?: unknown }).format !== "manifesto-studio-bundle"
  ) {
    return {
      imported: [],
      errors: ["Not a Manifesto Studio bundle."],
    };
  }
  const bundle = parsed as Partial<ProjectBundleV1>;
  if (bundle.version !== 1) {
    return {
      imported: [],
      errors: [`Unsupported bundle version: ${String(bundle.version)}.`],
    };
  }
  if (!Array.isArray(bundle.projects)) {
    return { imported: [], errors: ["Bundle is missing `projects` array."] };
  }
  const db = await getDb();
  const now = Date.now();
  const imported: ProjectRecord[] = [];
  const errors: string[] = [];
  const tx = db.transaction("projects", "readwrite");
  for (const [i, raw] of bundle.projects.entries()) {
    if (
      raw === null ||
      typeof raw !== "object" ||
      typeof (raw as { name?: unknown }).name !== "string" ||
      typeof (raw as { source?: unknown }).source !== "string"
    ) {
      errors.push(`Project at index ${i} is malformed — skipped.`);
      continue;
    }
    const p = raw as {
      name: string;
      source: string;
      createdAt?: number;
      updatedAt?: number;
    };
    const record: ProjectRecord = {
      id: newId(),
      name: p.name,
      source: p.source,
      createdAt: typeof p.createdAt === "number" ? p.createdAt : now,
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : now,
      lastOpenedAt: now,
      origin: { kind: "imported", importedAt: now },
    };
    await tx.store.put(record);
    imported.push(record);
  }
  await tx.done;
  return { imported, errors };
}
