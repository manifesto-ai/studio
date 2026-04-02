import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler
} from "@xyflow/react";

import type { DomainGraphProjection, DomainGraphProjectionNode } from "@manifesto-ai/studio-core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@manifesto-ai/ui-core";

const KIND_COLUMNS: Record<DomainGraphProjectionNode["kind"], number> = {
  action: 0,
  guard: 1,
  computed: 1,
  effect: 2,
  "patch-target": 3,
  state: 4,
  "lineage-branch": 5,
  "lineage-head": 6,
  "lineage-tip": 6,
  "lineage-world": 7,
  "governance-proposal": 8,
  "governance-actor": 9,
  "governance-gate": 9
};

function getNodeLabel(node: DomainGraphProjectionNode): string {
  const metadata = node.metadata ?? {};

  if (typeof metadata.actionId === "string") {
    return metadata.actionId;
  }

  if (typeof metadata.path === "string") {
    return metadata.path;
  }

  if (typeof metadata.branchId === "string") {
    return metadata.branchId;
  }

  if (typeof metadata.actorId === "string") {
    return metadata.actorId;
  }

  return node.id.replace(/^[^:]+:/, "");
}

function getNodeColor(kind: DomainGraphProjectionNode["kind"]): string {
  switch (kind) {
    case "action":
      return "#75ffc2";
    case "computed":
      return "#ffbf69";
    case "state":
      return "#8fd8ff";
    case "patch-target":
      return "#f7a6ff";
    default:
      return "#dfe9e4";
  }
}

function buildFlowGraph(
  projection: DomainGraphProjection,
  selectedNodeId?: string
): {
  nodes: Node[];
  edges: Edge[];
} {
  const grouped = new Map<number, DomainGraphProjectionNode[]>();

  for (const node of projection.nodes) {
    const column = KIND_COLUMNS[node.kind] ?? 10;
    const bucket = grouped.get(column);

    if (bucket) {
      bucket.push(node);
      continue;
    }

    grouped.set(column, [node]);
  }

  const nodes = Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .flatMap(([column, bucket]) =>
      bucket
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((node, index) => ({
          id: node.id,
          position: {
            x: column * 240,
            y: index * 104
          },
          data: {
            label: getNodeLabel(node)
          },
          style: {
            width: 176,
            borderRadius: 16,
            border: node.id === selectedNodeId ? "2px solid rgba(117, 255, 194, 0.88)" : "1px solid rgba(117, 255, 194, 0.16)",
            background: "rgba(9, 22, 29, 0.9)",
            color: "#e8f4ef",
            boxShadow: "0 16px 48px rgba(0, 0, 0, 0.2)"
          },
          className: `studio-flow-node studio-flow-node--${node.kind}`,
          selected: node.id === selectedNodeId,
          sourcePosition: Position.Right,
          targetPosition: Position.Left
        }))
    );

  const edges = projection.edges.map((edge, index) => ({
    id: `${edge.source}:${edge.target}:${edge.kind}:${index}`,
    source: edge.source,
    target: edge.target,
    label: edge.kind,
    type: "smoothstep",
    animated: false,
    style: {
      stroke: edge.provenance === "trace" ? "#ffbf69" : "rgba(117, 255, 194, 0.24)",
      strokeDasharray: edge.provenance === "static" ? "6 4" : undefined
    },
    labelStyle: {
      fill: getNodeColor("computed"),
      fontSize: 11
    }
  }));

  return { nodes, edges };
}

export type DomainGraphViewProps = {
  projection: DomainGraphProjection;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
};

export function DomainGraphView({
  projection,
  selectedNodeId,
  onSelectNode
}: DomainGraphViewProps) {
  const flowGraph = buildFlowGraph(projection, selectedNodeId);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onSelectNode?.(node.id);
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Domain Graph</CardTitle>
        <CardDescription>
          {projection.nodeCount} nodes · {projection.edgeCount} edges
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[620px] overflow-hidden rounded-xl border border-border/70 bg-background/50">
          <ReactFlow
            edges={flowGraph.edges}
            fitView
            nodes={flowGraph.nodes}
            nodesConnectable={false}
            nodesDraggable={false}
            onNodeClick={handleNodeClick}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(117, 255, 194, 0.08)" gap={24} />
            <MiniMap
              nodeColor={(node) => getNodeColor((node.className?.replace("studio-flow-node studio-flow-node--", "") as DomainGraphProjectionNode["kind"]) ?? "state")}
              pannable
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  );
}
