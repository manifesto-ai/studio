import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger
} from "@manifesto-ai/ui-core";

import { useStudioState } from "../../context/studio-context.js";
import { useGraph } from "../../hooks/use-studio.js";
import {
  getNodeById,
  getNodeLabel,
  getIncomingRelations,
  getOutgoingRelations,
  serializeJson
} from "../../authoring.js";
import type { DomainGraphProjection } from "@manifesto-ai/studio-core";

export function NodeContextPanel() {
  const state = useStudioState();
  const graph = useGraph();
  const [tab, setTab] = useState("node");

  const selectedNode = useMemo(
    () => (graph ? getNodeById(graph, state.selectedNodeId) : undefined),
    [graph, state.selectedNodeId]
  );
  const incoming = useMemo(
    () => (graph ? getIncomingRelations(graph, state.selectedNodeId) : []),
    [graph, state.selectedNodeId]
  );
  const outgoing = useMemo(
    () => (graph ? getOutgoingRelations(graph, state.selectedNodeId) : []),
    [graph, state.selectedNodeId]
  );

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="pb-3">
        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="node">Node</TabsTrigger>
            <TabsTrigger value="state">State</TabsTrigger>
            <TabsTrigger value="computed">Computed</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {tab === "node" ? (
          <NodeInspector
            graph={graph}
            selectedNode={selectedNode}
            incoming={incoming}
            outgoing={outgoing}
          />
        ) : tab === "state" ? (
          <SnapshotView
            title="state"
            value={state.liveSnapshot ? serializeJson(state.liveSnapshot.data) : ""}
            emptyMessage="No state"
          />
        ) : (
          <SnapshotView
            title="computed"
            value={
              state.liveSnapshot ? serializeJson(state.liveSnapshot.computed) : ""
            }
            emptyMessage="No computed"
          />
        )}
      </CardContent>
    </Card>
  );
}

function NodeInspector({
  graph,
  selectedNode,
  incoming,
  outgoing
}: {
  graph: DomainGraphProjection | null;
  selectedNode: ReturnType<typeof getNodeById>;
  incoming: DomainGraphProjection["edges"];
  outgoing: DomainGraphProjection["edges"];
}) {
  return (
    <ScrollArea className="h-full">
      <div className="grid gap-4 pr-1">
        {!graph || !selectedNode ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No node
          </p>
        ) : (
          <>
            <section className="border-b border-border/70 pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {getNodeLabel(selectedNode)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedNode.kind} · {selectedNode.sourcePath}
                  </p>
                </div>
                <Badge variant="outline">{selectedNode.kind}</Badge>
              </div>
            </section>

            <section className="grid gap-2 border-b border-border/70 pb-3">
              {selectedNode.metadata &&
              Object.keys(selectedNode.metadata).length > 0 ? (
                Object.entries(selectedNode.metadata).map(([key, value]) => (
                  <div className="grid gap-1" key={key}>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {key}
                    </span>
                    <span className="text-sm text-foreground">
                      {typeof value === "string" ||
                      typeof value === "number" ||
                      typeof value === "boolean"
                        ? String(value)
                        : serializeJson(value)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No metadata</p>
              )}
            </section>

            <RelationsList
              graph={graph}
              label="incoming"
              relations={incoming}
              side="source"
            />
            <RelationsList
              graph={graph}
              label="outgoing"
              relations={outgoing}
              side="target"
            />
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function RelationsList({
  graph,
  label,
  relations,
  side
}: {
  graph: DomainGraphProjection;
  label: string;
  relations: DomainGraphProjection["edges"];
  side: "source" | "target";
}) {
  return (
    <section className="border-b border-border/70 pb-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <Badge variant="outline">{relations.length}</Badge>
      </div>
      <div className="mt-3 grid gap-2">
        {relations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No direct relations in this direction.
          </p>
        ) : (
          relations.map((rel, i) => {
            const node = getNodeById(graph, rel[side]);
            return (
              <div
                className="rounded-xl border border-border/60 bg-background/30 px-3 py-3"
                key={`${rel.source}:${rel.target}:${rel.kind}:${i}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">
                    {node ? getNodeLabel(node) : rel[side]}
                  </p>
                  <Badge variant="secondary">{rel.kind}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {node?.sourcePath ?? rel[side]}
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function SnapshotView({
  title,
  value,
  emptyMessage
}: {
  title: string;
  value: string;
  emptyMessage: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {value ? (
        <pre className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-border/70 bg-[#071019] p-3 font-mono text-xs leading-6 text-muted-foreground">
          {value}
        </pre>
      ) : (
        <p className="mt-3 py-10 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </div>
  );
}
