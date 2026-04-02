export type StaticNodeKind =
  | "state"
  | "computed"
  | "action"
  | "guard"
  | "effect"
  | "patch-target";

export type LineageNodeKind =
  | "lineage-branch"
  | "lineage-head"
  | "lineage-tip"
  | "lineage-world";

export type GovernanceNodeKind =
  | "governance-proposal"
  | "governance-actor"
  | "governance-gate";

export type GraphNodeKind = StaticNodeKind | LineageNodeKind | GovernanceNodeKind;

export type StaticEdgeKind =
  | "reads"
  | "writes"
  | "depends-on"
  | "enables"
  | "blocks"
  | "produces";

export type LineageEdgeKind = "seals-into" | "branches-from" | "parent-of";

export type GovernanceEdgeKind = "proposes" | "approves" | "gates";

export type GraphEdgeKind = StaticEdgeKind | LineageEdgeKind | GovernanceEdgeKind;

export type FactProvenance =
  | "static"
  | "runtime"
  | "trace"
  | "lineage"
  | "governance";

export type OverlayFact = {
  key: string;
  value: unknown;
  provenance: FactProvenance;
  observedAt?: number;
};

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  sourcePath: string;
  provenance: FactProvenance;
  metadata: Record<string, unknown>;
  overlayFacts: OverlayFact[];
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  provenance: FactProvenance;
  metadata?: Record<string, unknown>;
};

export type OverlayVersionMap = {
  schemaHash: string;
  snapshotVersion?: number;
  traceBaseVersion?: number;
  lineageEpoch?: number;
  governanceEpoch?: number;
};

export type SemanticGraphIR = {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  schemaHash: string;
  overlayVersions: OverlayVersionMap;
};

