import type { CanonicalSnapshot } from "@manifesto-ai/sdk";

/**
 * Synthetic lineage tracker.
 *
 * Studio Core's Pillar 4 ("Time is first-class") needs a Merkle-ish
 * chain of worlds so the UI can show tip / head / parentWorldId /
 * dispatch provenance without waiting for the full `@manifesto-ai/lineage`
 * integration. This module constructs the chain from already-available
 * signals: canonical snapshot on every successful dispatch, a stable
 * content hash per snapshot, and the caller-supplied intent metadata.
 *
 * This is NOT the SDK lineage — snapshots aren't content-addressed by
 * the kernel, seal attempts aren't tracked, and branches don't exist.
 * It is a UI projection. Type shapes mirror `@manifesto-ai/lineage`
 * (World, WorldHead, WorldLineage) so a future swap to the real
 * lineage runtime changes only this tracker, not consumers.
 */

export type WorldId = string & { readonly __brand: "WorldId" };
export type BranchId = string & { readonly __brand: "BranchId" };

export const MAIN_BRANCH: BranchId = "main" as BranchId;

export type WorldOrigin = {
  readonly kind: "build" | "dispatch";
  readonly intentType?: string;
  readonly buildId?: string;
};

/** A single dispatch / build point in the lineage chain. */
export type World = {
  readonly id: WorldId;
  readonly parentId: WorldId | null;
  readonly branchId: BranchId;
  readonly schemaHash: string;
  readonly snapshotHash: string;
  readonly origin: WorldOrigin;
  readonly recordedAt: number;
  readonly changedPaths: readonly string[];
};

export type WorldHead = {
  readonly branchId: BranchId;
  readonly worldId: WorldId;
  readonly recordedAt: number;
};

export type WorldLineage = {
  readonly worlds: readonly World[];
  readonly head: WorldHead | null;
  readonly branches: readonly BranchId[];
};

export type LineageTracker = {
  readonly record: (input: WorldRecordInput) => World;
  readonly reset: () => void;
  readonly resetForSchema: (schemaHash: string) => void;
  readonly getLineage: () => WorldLineage;
  readonly getLatestHead: () => WorldHead | null;
  readonly getWorld: (id: WorldId) => World | null;
};

export type WorldRecordInput = {
  readonly schemaHash: string;
  readonly origin: WorldOrigin;
  readonly canonicalSnapshot: CanonicalSnapshot<unknown> | null;
  readonly changedPaths?: readonly string[];
};

const MAX_WORLDS = 500;

export function createLineageTracker(): LineageTracker {
  let worlds: World[] = [];
  let head: WorldHead | null = null;

  function record(input: WorldRecordInput): World {
    const parentId = head?.worldId ?? null;
    const snapshotHash = stableSnapshotHash(input.canonicalSnapshot);
    // WorldId folds parent+schema+snapshot+origin+seq so two dispatches
    // producing the same snapshot still get distinct ids (important for
    // idempotent actions).
    const seq = worlds.length;
    const id = computeWorldId(
      parentId,
      input.schemaHash,
      snapshotHash,
      input.origin,
      seq,
    );
    const world: World = {
      id,
      parentId,
      branchId: MAIN_BRANCH,
      schemaHash: input.schemaHash,
      snapshotHash,
      origin: input.origin,
      recordedAt: Date.now(),
      changedPaths: input.changedPaths ?? [],
    };
    worlds.push(world);
    if (worlds.length > MAX_WORLDS) {
      // Keep the tail — the UI always cares about recent history.
      worlds = worlds.slice(-MAX_WORLDS);
    }
    head = {
      branchId: MAIN_BRANCH,
      worldId: id,
      recordedAt: world.recordedAt,
    };
    return world;
  }

  function reset(): void {
    worlds = [];
    head = null;
  }

  function resetForSchema(schemaHash: string): void {
    // On a schema change the prior world chain is no longer comparable
    // under the new schema's hashes. Drop everything that doesn't
    // belong to the new schema. The next successful build/dispatch
    // seeds a new genesis world.
    worlds = worlds.filter((w) => w.schemaHash === schemaHash);
    const tail = worlds[worlds.length - 1];
    head = tail
      ? { branchId: tail.branchId, worldId: tail.id, recordedAt: tail.recordedAt }
      : null;
  }

  function getLineage(): WorldLineage {
    return {
      worlds: worlds.slice(),
      head,
      branches: [MAIN_BRANCH],
    };
  }

  function getLatestHead(): WorldHead | null {
    return head;
  }

  function getWorld(id: WorldId): World | null {
    return worlds.find((w) => w.id === id) ?? null;
  }

  return {
    record,
    reset,
    resetForSchema,
    getLineage,
    getLatestHead,
    getWorld,
  };
}

function stableSnapshotHash(snapshot: CanonicalSnapshot<unknown> | null): string {
  if (snapshot === null || snapshot === undefined) return emptyHash();
  const serialized = JSON.stringify(sortForHash(snapshot));
  return shortHash(serialized);
}

function computeWorldId(
  parent: WorldId | null,
  schemaHash: string,
  snapshotHash: string,
  origin: WorldOrigin,
  seq: number,
): WorldId {
  const key = `${parent ?? "∅"}|${schemaHash}|${snapshotHash}|${origin.kind}|${origin.intentType ?? ""}|${origin.buildId ?? ""}|${seq}`;
  return shortHash(key) as WorldId;
}

function shortHash(s: string): string {
  // djb2 hash, 32-bit unsigned, 8 hex chars. Enough entropy for a
  // UI-only world id — not collision-proof for durable storage.
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return `w_${h.toString(16).padStart(8, "0")}`;
}

function emptyHash(): string {
  return "sh_empty";
}

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForHash);
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, sortForHash(input[key])]),
    );
  }
  return value;
}
