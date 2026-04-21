import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphEdge, GraphModel, GraphNode, GraphNodeId } from "./graph-model.js";

export type NodePosition = { readonly x: number; readonly y: number };

export type PositionMap = ReadonlyMap<GraphNodeId, NodePosition>;

export type LayoutOptions = {
  readonly width: number;
  readonly height: number;
  /** Seed existing nodes from a prior run. New nodes are placed fresh. */
  readonly prevPositions?: PositionMap;
  /**
   * Tick count for the synchronous simulation. d3-force's default alpha
   * decay reaches ~0.001 around 300 ticks; 250 is a good balance of
   * stability vs cost for < 200 nodes.
   */
  readonly iterations?: number;
  /**
   * When true, nodes seeded from `prevPositions` are pinned (`fx`/`fy`)
   * so they don't drift, and only new nodes move. Defaults to `false`
   * so the whole graph can relax slightly after a schema change.
   * INV-P1-3 only requires position *reuse*, not pin.
   */
  readonly pinSeeded?: boolean;
};

type MutableNode = SimulationNodeDatum & {
  id: GraphNodeId;
  kind: GraphNode["kind"];
};

type MutableLink = SimulationLinkDatum<MutableNode> & {
  relation: GraphEdge["relation"];
};

/**
 * Mulberry32 — a fast, high-quality seeded 32-bit PRNG. Used as the
 * d3-force `randomSource` so successive runs with identical inputs are
 * byte-identical (required for INV-P1-3 determinism tests and stable
 * snapshots in CI).
 *
 * The seed is derived from the model's `schemaHash` so different schemas
 * get different starting jitter, but the same schema is reproducible.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromHash(hash: string): number {
  // FNV-1a 32-bit over the hash string — cheap and avalanche-ish.
  let h = 0x811c9dc5;
  for (let i = 0; i < hash.length; i += 1) {
    h ^= hash.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Synchronously run a d3-force simulation to a resting position map.
 * Pure / deterministic given the same inputs — safe for tests.
 */
export function runLayout(
  model: GraphModel,
  options: LayoutOptions,
): PositionMap {
  const { width, height, prevPositions, pinSeeded = false } = options;
  // Larger graphs need more ticks to settle. Scale linearly up to a cap.
  const iterations =
    options.iterations ?? Math.min(800, 200 + model.nodes.length * 8);
  const cx = width / 2;
  const cy = height / 2;

  const nodes: MutableNode[] = model.nodes.map((n) => {
    const prev = prevPositions?.get(n.id);
    const seeded = prev !== undefined;
    const node: MutableNode = {
      id: n.id,
      kind: n.kind,
      x: seeded ? prev.x : cx,
      y: seeded ? prev.y : cy,
    };
    if (seeded && pinSeeded) {
      node.fx = prev.x;
      node.fy = prev.y;
    }
    return node;
  });

  const nodeIndex = new Map<GraphNodeId, MutableNode>(
    nodes.map((n) => [n.id, n]),
  );

  const links: MutableLink[] = [];
  for (const e of model.edges) {
    const s = nodeIndex.get(e.source);
    const t = nodeIndex.get(e.target);
    if (s === undefined || t === undefined) continue;
    links.push({ source: s, target: t, relation: e.relation });
  }

  const random = mulberry32(seedFromHash(model.schemaHash));

  // Force tuning is scaled to container size so tall/narrow panes don't
  // explode outward. We target a "good spread" of √area / nodeCount per
  // node cell, then derive link distance and charge from that.
  const area = Math.max(100, width * height);
  const cell = Math.sqrt(area / Math.max(1, nodes.length));
  const linkDistance = Math.max(48, Math.min(140, cell * 0.9));
  const chargeStrength = -Math.max(80, Math.min(360, cell * 5));
  // Collision radius scales down for dense graphs so nodes can pack
  // tighter without the layout collapsing.
  const collideRadius = Math.max(22, Math.min(36, cell * 0.42));

  const linkForce: ForceLink<MutableNode, MutableLink> = forceLink<
    MutableNode,
    MutableLink
  >(links)
    .id((n) => n.id)
    .distance(linkDistance)
    .strength(0.5);

  // Keep nodes inside a padded canvas rectangle — gradient force that
  // ramps up near the edge. Prevents runaway drift on narrow panes.
  const padding = collideRadius + 8;
  const boundaryForce = (alpha: number): void => {
    for (const n of nodes) {
      if (n.fx !== undefined && n.fx !== null) continue;
      const nx = n.x ?? cx;
      const ny = n.y ?? cy;
      const loX = padding;
      const hiX = width - padding;
      const loY = padding;
      const hiY = height - padding;
      if (nx < loX) n.vx = (n.vx ?? 0) + (loX - nx) * alpha * 0.3;
      else if (nx > hiX) n.vx = (n.vx ?? 0) + (hiX - nx) * alpha * 0.3;
      if (ny < loY) n.vy = (n.vy ?? 0) + (loY - ny) * alpha * 0.3;
      else if (ny > hiY) n.vy = (n.vy ?? 0) + (hiY - ny) * alpha * 0.3;
    }
  };

  const sim: Simulation<MutableNode, MutableLink> = forceSimulation<
    MutableNode,
    MutableLink
  >(nodes)
    .randomSource(random)
    .force("link", linkForce)
    .force("charge", forceManyBody<MutableNode>().strength(chargeStrength))
    .force("center", forceCenter<MutableNode>(cx, cy).strength(0.12))
    .force("collide", forceCollide<MutableNode>(collideRadius).strength(0.95))
    .force("boundary", boundaryForce)
    .alpha(1)
    .alphaDecay(1 - Math.pow(0.001, 1 / iterations))
    .stop();

  for (let i = 0; i < iterations; i += 1) {
    sim.tick();
    // Hard clamp after each tick so a single huge step can't escape the
    // canvas even while alpha is high.
    for (const n of nodes) {
      if (n.fx !== undefined && n.fx !== null) continue;
      if (typeof n.x === "number") n.x = clamp(n.x, padding, width - padding);
      if (typeof n.y === "number") n.y = clamp(n.y, padding, height - padding);
    }
  }

  const result = new Map<GraphNodeId, NodePosition>();
  for (const n of nodes) {
    result.set(n.id, {
      x: typeof n.x === "number" ? n.x : cx,
      y: typeof n.y === "number" ? n.y : cy,
    });
  }
  return result;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Schema-hash keyed cache of layout positions.
 *
 * INV-P1-3: on rebuild, the positions of nodes that survived are
 * reused; the simulation only has to relax new nodes.
 *
 * Stores the last *N* schema hashes (LRU) so a rapid back-and-forth
 * edit doesn't churn away useful positions.
 */
export class GraphLayoutCache {
  private readonly byHash = new Map<string, PositionMap>();
  private readonly maxEntries: number;

  constructor(maxEntries = 8) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(schemaHash: string): PositionMap | null {
    const hit = this.byHash.get(schemaHash);
    if (hit === undefined) return null;
    // Touch for LRU.
    this.byHash.delete(schemaHash);
    this.byHash.set(schemaHash, hit);
    return hit;
  }

  set(schemaHash: string, positions: PositionMap): void {
    if (this.byHash.has(schemaHash)) this.byHash.delete(schemaHash);
    this.byHash.set(schemaHash, positions);
    while (this.byHash.size > this.maxEntries) {
      const oldestKey = this.byHash.keys().next().value;
      if (oldestKey === undefined) break;
      this.byHash.delete(oldestKey);
    }
  }

  /**
   * Stitch a previous position map onto a new model so nodes that
   * still exist keep their coordinates. Used as `prevPositions` input
   * to {@link runLayout}.
   *
   * Returns the *subset* of `prev` whose ids are still in `model`.
   */
  static carryOver(model: GraphModel, prev: PositionMap): PositionMap {
    const carried = new Map<GraphNodeId, NodePosition>();
    for (const n of model.nodes) {
      const p = prev.get(n.id);
      if (p !== undefined) carried.set(n.id, p);
    }
    return carried;
  }

  size(): number {
    return this.byHash.size;
  }

  clear(): void {
    this.byHash.clear();
  }
}
