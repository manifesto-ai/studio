import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler
} from "@xyflow/react";

import type {
  TransitionGraphEdge,
  TransitionGraphNode,
  TransitionGraphProjection
} from "@manifesto-ai/studio-core";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@manifesto-ai/ui-core";

function buildLayout(nodes: TransitionGraphNode[]) {
  const firstDimensionValues = Array.from(
    new Set(nodes.map((node) => node.signature[0]?.value ?? "state"))
  ).sort((left, right) => left.localeCompare(right));
  const secondDimensionValues = Array.from(
    new Set(nodes.map((node) => node.signature[1]?.value ?? node.id))
  ).sort((left, right) => left.localeCompare(right));

  return new Map(
    nodes.map((node, index) => {
      const columnKey = node.signature[0]?.value ?? "state";
      const rowKey = node.signature[1]?.value ?? node.id;
      const columnIndex = firstDimensionValues.indexOf(columnKey);
      const rowIndex = secondDimensionValues.indexOf(rowKey);

      return [
        node.id,
        {
          x: columnIndex * 320,
          y: rowIndex * 200 + (index % 2) * 24
        }
      ] as const;
    })
  );
}

function edgeTone(edge: TransitionGraphEdge) {
  if (edge.blockedCount > 0) {
    return {
      stroke: "rgba(255, 143, 143, 0.82)",
      strokeDasharray: "10 6"
    };
  }

  if (edge.dryRunCount > 0 && edge.liveCount === 0) {
    return {
      stroke: "rgba(255, 191, 105, 0.82)",
      strokeDasharray: "8 5"
    };
  }

  return {
    stroke: "rgba(117, 255, 194, 0.72)"
  };
}

function toFlowGraph(
  projection: Extract<TransitionGraphProjection, { status: "ready" }>,
  selectedNodeId?: string,
  selectedEdgeId?: string
): {
  nodes: Node[];
  edges: Edge[];
} {
  const layout = buildLayout(projection.nodes);

  const nodes = projection.nodes.map((node) => ({
    id: node.id,
    data: {
      label: (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                {node.current ? "Current state" : "Projected state"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {node.observationCount} observation
                {node.observationCount === 1 ? "" : "s"}
              </p>
            </div>
            {node.current ? <Badge variant="success">LIVE</Badge> : null}
          </div>
          <div className="grid gap-1.5">
            {node.signature.map((entry) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/25 px-2 py-1.5 text-xs"
                key={entry.key}
              >
                <span className="text-muted-foreground">{entry.label}</span>
                <span className="font-medium text-foreground">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      )
    },
    position: layout.get(node.id) ?? { x: 0, y: 0 },
    style: {
      width: 280,
      borderRadius: 20,
      padding: 0,
      border:
        node.id === selectedNodeId
          ? "2px solid rgba(117, 255, 194, 0.95)"
          : node.current
            ? "1px solid rgba(117, 255, 194, 0.7)"
            : "1px solid rgba(117, 255, 194, 0.18)",
      background: node.current ? "rgba(7, 19, 26, 0.96)" : "rgba(9, 22, 29, 0.9)",
      color: "#e8f4ef",
      boxShadow: node.current
        ? "0 24px 72px rgba(117, 255, 194, 0.16)"
        : "0 18px 56px rgba(0, 0, 0, 0.25)"
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    selected: node.id === selectedNodeId
  }));

  const edges = projection.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label:
      edge.changedDimensions.length > 0
        ? `${edge.actionId} · ${edge.changedDimensions.join(", ")}`
        : edge.actionId,
    type: "smoothstep",
    animated: edge.dryRunCount > 0,
    style: edgeTone(edge),
    labelStyle: {
      fill: "#ffbf69",
      fontSize: 11
    },
    selected: edge.id === selectedEdgeId
  }));

  return { nodes, edges };
}

export type TransitionGraphViewProps = {
  projection: TransitionGraphProjection;
  selectedNodeId?: string;
  selectedEdgeId?: string;
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
};

export function TransitionGraphView({
  projection,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge
}: TransitionGraphViewProps) {
  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onSelectNode?.(node.id);
  };
  const handleEdgeClick: EdgeMouseHandler = (_, edge) => {
    onSelectEdge?.(edge.id);
  };
  const graph = projection.status === "ready"
    ? toFlowGraph(projection, selectedNodeId, selectedEdgeId)
    : null;
  const blockedEdges =
    projection.status === "ready"
      ? projection.edges.filter((edge) => edge.blockedCount > 0).length
      : 0;
  const showMiniMap =
    projection.status === "ready" && projection.nodes.length > 1;

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="shrink-0 pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Projection</CardTitle>
          {projection.status === "ready" ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{projection.nodes.length}n · {projection.edges.length}e</Badge>
              {blockedEdges > 0 ? <Badge variant="warning">{blockedEdges} blocked</Badge> : null}
              {projection.currentNodeId ? <Badge variant="success">live</Badge> : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pb-3">
        {projection.status === "invalid-preset" ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/20 px-6 text-center text-sm text-muted-foreground">
            {projection.message}
          </div>
        ) : (
          <div className="h-full overflow-hidden rounded-2xl border border-border/70 bg-[linear-gradient(180deg,rgba(7,19,26,0.92),rgba(5,14,20,0.98))]">
            <ReactFlow
              edges={graph?.edges ?? []}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              nodes={graph?.nodes ?? []}
              nodesConnectable={false}
              nodesDraggable={false}
              onEdgeClick={handleEdgeClick}
              onNodeClick={handleNodeClick}
              panOnDrag
              selectionOnDrag={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="rgba(117, 255, 194, 0.07)" gap={24} />
              {showMiniMap ? (
                <MiniMap
                  nodeColor={(node) =>
                    node.id === projection.currentNodeId ? "#75ffc2" : "#8fd8ff"
                  }
                  maskColor="rgba(7, 19, 26, 0.72)"
                  pannable
                  style={{
                    background: "rgba(7, 19, 26, 0.88)",
                    border: "1px solid rgba(117, 255, 194, 0.14)",
                    borderRadius: 12
                  }}
                />
              ) : null}
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
