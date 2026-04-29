/**
 * AnchorStore — host-side index of all anchors with their full
 * bodies (topic + summary), plus an Ant Colony Optimisation
 * pheromone graph over anchor-to-anchor edges.
 *
 * Why host-side?
 *
 * Anchors are dispatched events in lineage (anchorWindow worlds), but
 * their bodies (topic, summary, recordedAt) are too heavy for MEL
 * snapshot per world. Instead the anchor effect writes the record
 * here keyed by anchorId; agents query through `searchAnchors` /
 * `recallAnchor` tools which read this store. Snapshot keeps only
 * the latest anchor's skeleton (lastAnchorId, lastAnchorTopic, etc.).
 *
 * Pheromone graph:
 *
 * When the agent recalls anchors A and then B in the same retrieval
 * session, an edge between (A, B) gets a small deposit. Over time:
 *   - frequently co-recalled anchors strengthen their edge
 *   - unused edges evaporate via `evaporateAll(factor)`
 *   - searchAnchors blends edge weight into ranking, biasing toward
 *     anchors connected to recently-recalled ones
 *
 * This is stigmergic learning — agent behaviour leaves marks in the
 * environment that future searches follow. Stable anchor ids let the
 * trails persist across sessions when the store is persisted.
 *
 * Boundary discipline: lives in agent/session/ (future-core). No
 * React, no webapp aliases. Pure data structure with subscribe seam.
 */

export type AnchorRecord = {
  readonly anchorId: string;
  readonly fromWorldId: string;
  readonly toWorldId: string;
  readonly topic: string;
  readonly summary: string;
  /** Unix epoch ms when the anchor was created. */
  readonly recordedAt: number;
  /** turnCount value when the window began (exclusive of prior anchor). */
  readonly turnRangeStart: number;
  /** turnCount value when the window ended (inclusive). */
  readonly turnRangeEnd: number;
};

export type PheromoneEdge = {
  readonly anchorIdA: string;
  readonly anchorIdB: string;
  readonly weight: number;
};

export type AnchorStoreOptions = {
  /** Deposit per consecutive recall pair. Default 1.0. */
  readonly initialDeposit?: number;
  /** Cap to prevent runaway accumulation. Default 10.0. */
  readonly maxEdgeWeight?: number;
  /** Edge weight floor — below this on evaporation, the edge is dropped. */
  readonly evaporationFloor?: number;
};

export type AnchorStore = {
  // Anchor records
  readonly putAnchor: (record: AnchorRecord) => void;
  readonly getAnchor: (anchorId: string) => AnchorRecord | null;
  readonly listAnchors: () => readonly AnchorRecord[];
  readonly hasAnchor: (anchorId: string) => boolean;
  readonly anchorCount: () => number;

  // Pheromone graph
  /**
   * Deposit pheromone on edges between consecutive ids in the sequence.
   * For [a, b, c, d] it deposits on (a,b), (b,c), (c,d). Same-id
   * neighbours are skipped. Caller is responsible for ordering.
   */
  readonly recordRecallSequence: (recalledIds: readonly string[]) => void;
  readonly getPheromoneWeight: (anchorIdA: string, anchorIdB: string) => number;
  readonly listPheromoneEdges: () => readonly PheromoneEdge[];
  /**
   * Multiply every edge weight by `factor` (0..1). Edges that drop
   * below `evaporationFloor` are removed.
   */
  readonly evaporateAll: (factor: number) => void;

  // Lifecycle
  readonly subscribe: (listener: () => void) => () => void;
  readonly clear: () => void;
};

export function createAnchorStore(
  options: AnchorStoreOptions = {},
): AnchorStore {
  const initialDeposit = options.initialDeposit ?? 1.0;
  const maxEdgeWeight = options.maxEdgeWeight ?? 10.0;
  const evaporationFloor = options.evaporationFloor ?? 0.05;

  const anchors = new Map<string, AnchorRecord>();
  // Edge key is canonical "min|max" of the two anchor ids so the
  // edge is undirected (recall a→b and b→a deposit on the same edge).
  const pheromones = new Map<string, number>();
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const l of listeners) l();
  }

  function edgeKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function parseEdgeKey(key: string): { a: string; b: string } | null {
    const idx = key.indexOf("|");
    if (idx < 0) return null;
    return { a: key.slice(0, idx), b: key.slice(idx + 1) };
  }

  return {
    putAnchor: (record) => {
      anchors.set(record.anchorId, record);
      emit();
    },
    getAnchor: (id) => anchors.get(id) ?? null,
    listAnchors: () => Array.from(anchors.values()),
    hasAnchor: (id) => anchors.has(id),
    anchorCount: () => anchors.size,

    recordRecallSequence: (recalledIds) => {
      if (recalledIds.length < 2) return;
      let changed = false;
      for (let i = 0; i < recalledIds.length - 1; i += 1) {
        const a = recalledIds[i]!;
        const b = recalledIds[i + 1]!;
        if (a === b) continue;
        const key = edgeKey(a, b);
        const current = pheromones.get(key) ?? 0;
        const next = Math.min(current + initialDeposit, maxEdgeWeight);
        if (next !== current) {
          pheromones.set(key, next);
          changed = true;
        }
      }
      if (changed) emit();
    },

    getPheromoneWeight: (a, b) => {
      if (a === b) return 0;
      return pheromones.get(edgeKey(a, b)) ?? 0;
    },

    listPheromoneEdges: () => {
      const out: PheromoneEdge[] = [];
      for (const [key, weight] of pheromones) {
        const parsed = parseEdgeKey(key);
        if (parsed === null) continue;
        out.push({ anchorIdA: parsed.a, anchorIdB: parsed.b, weight });
      }
      return out;
    },

    evaporateAll: (factor) => {
      if (pheromones.size === 0) return;
      const toDelete: string[] = [];
      for (const [key, weight] of pheromones) {
        const next = weight * factor;
        if (next < evaporationFloor) {
          toDelete.push(key);
        } else {
          pheromones.set(key, next);
        }
      }
      for (const key of toDelete) pheromones.delete(key);
      emit();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    clear: () => {
      anchors.clear();
      pheromones.clear();
      emit();
    },
  };
}
