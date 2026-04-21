import type { GraphModel, GraphNode } from "@manifesto-ai/studio-react";

/**
 * Cluster detection — "what moves together".
 *
 * Heuristic: two `state` nodes are in the same cluster when they share
 * at least one `mutates` action AND their mutator sets have non-trivial
 * Jaccard overlap (≥ THRESHOLD). This prevents a single bridge-action
 * (e.g. `reset`) from collapsing the whole domain into one cluster.
 *
 * Computed and action nodes are assigned by affinity:
 *   - computed → the cluster its `feeds`-source states most belong to
 *   - action   → the cluster its `mutates`-target states most belong to
 *
 * Pure function; input-derived only. No MEL annotations required — the
 * edge relation stream (`feeds` / `mutates` / `unlocks`) from
 * `buildGraphModel` is sufficient.
 */

export type ClusterId = string & { readonly __brand: "ClusterId" };

export type Cluster = {
  readonly id: ClusterId;
  /** Primary state members — cluster "core". */
  readonly states: readonly GraphNode["id"][];
  /** Computed members — assigned by input state affinity. */
  readonly computeds: readonly GraphNode["id"][];
  /** Action members — assigned by mutation target affinity. */
  readonly actions: readonly GraphNode["id"][];
  /** Human-readable label from the dominant state's name. */
  readonly label: string;
};

export type ClusterMap = {
  readonly clusters: readonly Cluster[];
  readonly byNode: ReadonlyMap<GraphNode["id"], ClusterId>;
};

/** Jaccard threshold for merging two state nodes into the same cluster. */
const JACCARD_THRESHOLD = 0.3;

/**
 * Bridge-action heuristic: an action mutating ≥ this fraction of all
 * state nodes is treated as a "universal" action (e.g. `reset`) and
 * excluded from Jaccard comparisons. Without this, one reset-style
 * action collapses every unrelated state into a single cluster.
 * 0.6 chosen empirically — below that, domain-specific actions like
 * `placeShip` that touch several states don't get mis-classified.
 */
const BRIDGE_ACTION_THRESHOLD = 0.6;

export function detectClusters(model: GraphModel): ClusterMap {
  const stateNodes = model.nodes.filter((n) => n.kind === "state");
  const computedNodes = model.nodes.filter((n) => n.kind === "computed");
  const actionNodes = model.nodes.filter((n) => n.kind === "action");

  // mutators(state) = set of action ids that `mutate` the state.
  const mutators = new Map<GraphNode["id"], Set<GraphNode["id"]>>();
  for (const s of stateNodes) mutators.set(s.id, new Set());
  for (const e of model.edges) {
    if (e.relation !== "mutates") continue;
    const set = mutators.get(e.target);
    if (set === undefined) continue;
    set.add(e.source);
  }

  // Identify bridge actions (mutate most/all states). These inflate
  // Jaccard similarity across unrelated domain slices and would
  // collapse the whole schema into one cluster.
  const bridgeActions = new Set<GraphNode["id"]>();
  if (stateNodes.length >= 3) {
    const mutationCount = new Map<GraphNode["id"], number>();
    for (const set of mutators.values()) {
      for (const actionId of set) {
        mutationCount.set(actionId, (mutationCount.get(actionId) ?? 0) + 1);
      }
    }
    const bridgeMin = Math.ceil(stateNodes.length * BRIDGE_ACTION_THRESHOLD);
    for (const [actionId, count] of mutationCount) {
      if (count >= bridgeMin) bridgeActions.add(actionId);
    }
  }
  const exceptBridges = (set: ReadonlySet<GraphNode["id"]>): Set<GraphNode["id"]> => {
    if (bridgeActions.size === 0) return set as Set<GraphNode["id"]>;
    const filtered = new Set<GraphNode["id"]>();
    for (const a of set) if (!bridgeActions.has(a)) filtered.add(a);
    // Fallback: if filtering strips every mutator, the state only had
    // bridge actions driving it — in that case keep the originals so
    // the state still has a signal to cluster on (otherwise states
    // mutated exclusively by a universal action would all become
    // lonely singletons).
    if (filtered.size === 0) return new Set(set);
    return filtered;
  };

  // Union-Find over state ids keyed by shared-mutator affinity.
  const parent = new Map<GraphNode["id"], GraphNode["id"]>();
  for (const s of stateNodes) parent.set(s.id, s.id);
  const find = (x: GraphNode["id"]): GraphNode["id"] => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur);
      if (p === undefined) break;
      parent.set(cur, parent.get(p) ?? p);
      cur = parent.get(cur) ?? cur;
    }
    return cur;
  };
  const union = (a: GraphNode["id"], b: GraphNode["id"]): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Pairwise merge on Jaccard ≥ threshold. O(S²) where S = state count;
  // fine for Studio-scale schemas (<50 states). Bridge actions are
  // filtered out of the similarity comparison so they don't glue
  // unrelated slices together.
  for (let i = 0; i < stateNodes.length; i += 1) {
    const a = stateNodes[i];
    const rawA = mutators.get(a.id);
    if (rawA === undefined || rawA.size === 0) continue;
    const ma = exceptBridges(rawA);
    if (ma.size === 0) continue;
    for (let j = i + 1; j < stateNodes.length; j += 1) {
      const b = stateNodes[j];
      const rawB = mutators.get(b.id);
      if (rawB === undefined || rawB.size === 0) continue;
      const mb = exceptBridges(rawB);
      if (mb.size === 0) continue;
      const jaccard = jaccardSimilarity(ma, mb);
      if (jaccard >= JACCARD_THRESHOLD) union(a.id, b.id);
    }
  }

  // Collect state clusters by representative id.
  const stateGroups = new Map<GraphNode["id"], GraphNode["id"][]>();
  for (const s of stateNodes) {
    const root = find(s.id);
    const list = stateGroups.get(root) ?? [];
    list.push(s.id);
    stateGroups.set(root, list);
  }

  // inputs(computed) = states it feeds from
  const feedsInto = new Map<GraphNode["id"], Set<GraphNode["id"]>>();
  for (const c of computedNodes) feedsInto.set(c.id, new Set());
  for (const e of model.edges) {
    if (e.relation !== "feeds") continue;
    const set = feedsInto.get(e.target);
    if (set === undefined) continue;
    set.add(e.source);
  }

  // targets(action) = states it mutates
  const targetsOf = new Map<GraphNode["id"], Set<GraphNode["id"]>>();
  for (const a of actionNodes) targetsOf.set(a.id, new Set());
  for (const e of model.edges) {
    if (e.relation !== "mutates") continue;
    const set = targetsOf.get(e.source);
    if (set === undefined) continue;
    set.add(e.target);
  }

  // Assign computed/action to the cluster their state affinity points to.
  const bestClusterByAffinity = (
    candidates: ReadonlySet<GraphNode["id"]>,
  ): GraphNode["id"] | null => {
    if (candidates.size === 0) return null;
    const count = new Map<GraphNode["id"], number>();
    for (const stateId of candidates) {
      const root = parent.has(stateId) ? find(stateId) : null;
      if (root === null) continue;
      count.set(root, (count.get(root) ?? 0) + 1);
    }
    let best: GraphNode["id"] | null = null;
    let bestN = 0;
    for (const [root, n] of count) {
      if (n > bestN) {
        best = root;
        bestN = n;
      }
    }
    return best;
  };

  const clusterComputeds = new Map<GraphNode["id"], GraphNode["id"][]>();
  const orphanComputeds: GraphNode["id"][] = [];
  for (const c of computedNodes) {
    const set = feedsInto.get(c.id) ?? new Set();
    const root = bestClusterByAffinity(set);
    if (root === null) {
      orphanComputeds.push(c.id);
      continue;
    }
    const list = clusterComputeds.get(root) ?? [];
    list.push(c.id);
    clusterComputeds.set(root, list);
  }

  const clusterActions = new Map<GraphNode["id"], GraphNode["id"][]>();
  const orphanActions: GraphNode["id"][] = [];
  for (const a of actionNodes) {
    const set = targetsOf.get(a.id) ?? new Set();
    const root = bestClusterByAffinity(set);
    if (root === null) {
      orphanActions.push(a.id);
      continue;
    }
    const list = clusterActions.get(root) ?? [];
    list.push(a.id);
    clusterActions.set(root, list);
  }

  // Build final cluster records. Sort by size desc for deterministic
  // render order (biggest first read as "main subgraph").
  const clusters: Cluster[] = [];
  for (const [root, states] of stateGroups) {
    const rootNode = model.nodesById.get(root);
    clusters.push({
      id: root as ClusterId,
      states,
      computeds: clusterComputeds.get(root) ?? [],
      actions: clusterActions.get(root) ?? [],
      label: rootNode?.name ?? "cluster",
    });
  }
  // Orphan bucket — read-only nodes with no incoming relation. Put in
  // their own pseudo-cluster so the UI can still corral them.
  if (orphanComputeds.length > 0 || orphanActions.length > 0) {
    clusters.push({
      id: "__orphans" as ClusterId,
      states: [],
      computeds: orphanComputeds,
      actions: orphanActions,
      label: "shared",
    });
  }
  clusters.sort(
    (a, b) =>
      b.states.length +
      b.computeds.length +
      b.actions.length -
      (a.states.length + a.computeds.length + a.actions.length),
  );

  const byNode = new Map<GraphNode["id"], ClusterId>();
  for (const c of clusters) {
    for (const id of c.states) byNode.set(id, c.id);
    for (const id of c.computeds) byNode.set(id, c.id);
    for (const id of c.actions) byNode.set(id, c.id);
  }
  return { clusters, byNode };
}

function jaccardSimilarity<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  if (union === 0) return 0;
  return inter / union;
}
