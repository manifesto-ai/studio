import type {
  DomainModule,
  IdentityFate,
  LocalTargetKey,
  ReconciliationPlan,
  SchemaGraphEdgeRelation,
  SchemaGraphNodeId,
  SchemaGraphNodeKind,
  SourceSpan,
  TypeCompatWarning,
} from "@manifesto-ai/studio-core";

export type GraphNodeKind = SchemaGraphNodeKind;
export type GraphNodeId = SchemaGraphNodeId;
export type GraphEdgeRelation = SchemaGraphEdgeRelation;

/**
 * Snapshot reconciliation fate for state_field nodes. Non-state nodes are
 * always undefined — computed / action don't own stored snapshot data.
 */
export type SnapshotFate =
  | "preserved"
  | "initialized"
  | "discarded"
  | undefined;

export type GraphNode = {
  readonly id: GraphNodeId;
  readonly kind: GraphNodeKind;
  readonly name: string;
  readonly localKey: LocalTargetKey;
  readonly sourceSpan: SourceSpan | null;
  /** From `plan.identityMap`. `null` while no plan exists. */
  readonly identityFate: IdentityFate | null;
  /** State-only; derived from `plan.snapshotPlan` buckets. */
  readonly snapshotFate: SnapshotFate;
  readonly warnings: readonly TypeCompatWarning[];
};

export type GraphEdge = {
  /** Stable: `${from}->${to}:${relation}`. Duplicates collapsed by map key. */
  readonly id: string;
  readonly source: GraphNodeId;
  readonly target: GraphNodeId;
  readonly relation: GraphEdgeRelation;
};

export type GraphModel = {
  /** Key for position cache (INV-P1-3). */
  readonly schemaHash: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly nodesById: ReadonlyMap<GraphNodeId, GraphNode>;
};

/**
 * Graph node IDs use `state:X`; the reconciliation / source-map spaces use
 * `state_field:X`. Normalize for cross-lookup. `computed:` and `action:`
 * prefixes already match across both spaces.
 */
export function toLocalKey(nodeId: GraphNodeId): LocalTargetKey {
  if (nodeId.startsWith("state:")) {
    return `state_field:${nodeId.slice("state:".length)}` as LocalTargetKey;
  }
  return nodeId as LocalTargetKey;
}

/**
 * Inverse of {@link toLocalKey}. Returns `null` for keys that have no
 * graph node projection (`domain:`, `type:`, `type_field:`).
 */
export function fromLocalKey(key: LocalTargetKey): GraphNodeId | null {
  if (key.startsWith("state_field:")) {
    return `state:${key.slice("state_field:".length)}` as GraphNodeId;
  }
  if (key.startsWith("computed:") || key.startsWith("action:")) {
    return key as GraphNodeId;
  }
  return null;
}

export function buildGraphModel(
  module: DomainModule | null | undefined,
  plan: ReconciliationPlan | null | undefined = null,
): GraphModel | null {
  if (module == null) return null;

  const snapshotPlan = plan?.snapshotPlan;
  const preserved = new Set<LocalTargetKey>(snapshotPlan?.preserved ?? []);
  const initialized = new Set<LocalTargetKey>(snapshotPlan?.initialized ?? []);
  const discarded = new Set<LocalTargetKey>(snapshotPlan?.discarded ?? []);
  const warningsByKey = new Map<LocalTargetKey, TypeCompatWarning[]>();
  for (const w of snapshotPlan?.warned ?? []) {
    const list = warningsByKey.get(w.target);
    if (list === undefined) warningsByKey.set(w.target, [w]);
    else list.push(w);
  }

  const nodes: GraphNode[] = module.graph.nodes.map((n) => {
    const localKey = toLocalKey(n.id);
    const entry = module.sourceMap.entries[localKey];
    const identityFate = plan?.identityMap.get(localKey) ?? null;
    let snapshotFate: SnapshotFate;
    if (preserved.has(localKey)) snapshotFate = "preserved";
    else if (initialized.has(localKey)) snapshotFate = "initialized";
    else if (discarded.has(localKey)) snapshotFate = "discarded";
    return {
      id: n.id,
      kind: n.kind,
      name: n.name,
      localKey,
      sourceSpan: entry?.span ?? null,
      identityFate,
      snapshotFate,
      warnings: warningsByKey.get(localKey) ?? [],
    };
  });

  const edgeMap = new Map<string, GraphEdge>();
  for (const e of module.graph.edges) {
    const id = `${e.from}->${e.to}:${e.relation}`;
    if (edgeMap.has(id)) continue;
    edgeMap.set(id, {
      id,
      source: e.from,
      target: e.to,
      relation: e.relation,
    });
  }

  const nodesById = new Map<GraphNodeId, GraphNode>(
    nodes.map((n) => [n.id, n]),
  );

  return {
    schemaHash: module.schema.hash,
    nodes,
    edges: Array.from(edgeMap.values()),
    nodesById,
  };
}

/**
 * Short glyph for identity fate — UI components use this for compact
 * badges / overlays. Exposed on the data layer so the mapping stays
 * consistent across every view.
 */
export function identityFateGlyph(fate: IdentityFate | null): string {
  if (fate === null) return "";
  switch (fate.kind) {
    case "preserved":
      return "=";
    case "initialized":
      return "+";
    case "discarded":
      return "-";
    case "renamed":
      return "\u21a6"; // ↦
  }
}
