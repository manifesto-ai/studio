import { memo, useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  type ReactFlowInstance,
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
      return "#63dfcf";
    case "computed":
      return "#91a6ff";
    case "state":
      return "#7ad8ff";
    case "patch-target":
      return "#d59cff";
    default:
      return "#d7e2ef";
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
            width: 184,
            borderRadius: 18,
            border:
              node.id === selectedNodeId
                ? "1px solid rgba(99, 223, 207, 0.82)"
                : "1px solid rgba(122, 164, 222, 0.16)",
            background:
              "linear-gradient(180deg, rgba(8, 18, 28, 0.98) 0%, rgba(11, 24, 36, 0.92) 100%)",
            color: "#eef4fb",
            boxShadow: "0 18px 42px rgba(0, 0, 0, 0.28)"
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
      stroke:
        edge.provenance === "trace"
          ? "rgba(145, 166, 255, 0.86)"
          : "rgba(99, 223, 207, 0.24)",
      strokeDasharray: edge.provenance === "static" ? "6 4" : undefined
    },
    labelStyle: {
      fill: "#dbe7ff",
      fontSize: 11,
      fontWeight: 600
    },
    labelShowBg: true,
    labelBgPadding: [8, 4] as [number, number],
    labelBgBorderRadius: 999,
    labelBgStyle: {
      fill: "rgba(5, 16, 24, 0.94)",
      stroke: "rgba(145, 166, 255, 0.24)",
      strokeWidth: 1
    }
  }));

  return { nodes, edges };
}

export type DomainGraphViewProps = {
  projection: DomainGraphProjection;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
};

function DomainGraphViewComponent({
  projection,
  selectedNodeId,
  onSelectNode
}: DomainGraphViewProps) {
  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const flowGraph = useMemo(
    () => buildFlowGraph(projection, selectedNodeId),
    [projection, selectedNodeId]
  );
  const graphSignature = useMemo(
    () =>
      JSON.stringify({
        nodes: projection.nodes.map((node) => node.id),
        edges: projection.edges.map((edge) => [
          edge.source,
          edge.target,
          edge.kind,
          edge.provenance
        ])
      }),
    [projection]
  );
  const showMiniMap = projection.nodeCount > 14;

  useEffect(() => {
    const flow = flowRef.current;

    if (!flow) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      flow.fitView({
        duration: 180,
        padding: 0.18
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [graphSignature]);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onSelectNode?.(node.id);
  };

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="pb-3">
        <CardTitle>Graph</CardTitle>
        <CardDescription>{projection.nodeCount} · {projection.edgeCount}</CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div className="h-full overflow-hidden rounded-xl border border-border/70 bg-background/50">
          <ReactFlow
            className="studio-domain-flow"
            edges={flowGraph.edges}
            nodes={flowGraph.nodes}
            nodesConnectable={false}
            nodesDraggable={false}
            onNodeClick={handleNodeClick}
            onInit={(instance) => {
              flowRef.current = instance;
              instance.fitView({
                duration: 0,
                padding: 0.18
              });
            }}
            onlyRenderVisibleElements
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(122, 164, 222, 0.08)" gap={24} />
            {showMiniMap ? (
              <MiniMap
                nodeColor={(node) =>
                  getNodeColor(
                    (node.className?.replace(
                      "studio-flow-node studio-flow-node--",
                      ""
                    ) as DomainGraphProjectionNode["kind"]) ?? "state"
                  )
                }
                pannable
              />
            ) : null}
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  );
}

export const DomainGraphView = memo(
  DomainGraphViewComponent,
  (previous, next) =>
    previous.projection === next.projection &&
    previous.selectedNodeId === next.selectedNodeId
);
