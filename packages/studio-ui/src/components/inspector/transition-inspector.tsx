import type {
  ObservationRecord,
  TransitionGraphEdge,
  TransitionGraphNode
} from "@manifesto-ai/studio-core";
import { useEffect, useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@manifesto-ai/ui-core";

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function diffSnapshotSection(
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)])
  ).sort((left, right) => left.localeCompare(right));

  return keys
    .filter((key) => stableJson(before[key]) !== stableJson(after[key]))
    .map((key) => ({
      key,
      before: before[key],
      after: after[key]
    }));
}

export type TransitionInspectorProps = {
  selectedNode?: TransitionGraphNode;
  selectedEdge?: TransitionGraphEdge;
  selectedRecord?: ObservationRecord;
};

export function TransitionInspector({
  selectedNode,
  selectedEdge,
  selectedRecord
}: TransitionInspectorProps) {
  const [activeTab, setActiveTab] = useState("summary");
  const changedState =
    selectedRecord?.afterSnapshot
      ? diffSnapshotSection(
          selectedRecord.beforeSnapshot.data as Record<string, unknown>,
          selectedRecord.afterSnapshot.data as Record<string, unknown>
        )
      : [];
  const changedComputed =
    selectedRecord?.afterSnapshot
      ? diffSnapshotSection(
          selectedRecord.beforeSnapshot.computed as Record<string, unknown>,
          selectedRecord.afterSnapshot.computed as Record<string, unknown>
        )
      : [];

  useEffect(() => {
    if (selectedRecord?.afterSnapshot) {
      setActiveTab("diff");
      return;
    }

    if (selectedRecord || selectedEdge) {
      setActiveTab("record");
      return;
    }

    setActiveTab("summary");
  }, [selectedEdge, selectedRecord]);

  return (
    <Card className="h-full">
      <CardHeader className="gap-3">
        <CardTitle>Transition Inspector</CardTitle>
        <CardDescription>
          Inspect the selected graph node, edge, or individual observation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs onValueChange={setActiveTab} value={activeTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
            <TabsTrigger value="record">Run</TabsTrigger>
          </TabsList>
          <TabsContent value="summary">
            <ScrollArea className="h-[420px] rounded-2xl border border-border/70 bg-background/30">
              <div className="grid gap-3 p-3">
                {selectedNode ? (
                  <section className="grid gap-3 rounded-xl border border-border/70 bg-background/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">Selected node</p>
                      {selectedNode.current ? <Badge variant="success">LIVE</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedNode.observationCount} observed run
                      {selectedNode.observationCount === 1 ? "" : "s"} collapsed into this state.
                    </p>
                    {selectedNode.signature.map((entry) => (
                      <div className="flex items-center justify-between gap-2 text-sm" key={entry.key}>
                        <span className="text-muted-foreground">{entry.label}</span>
                        <span className="font-medium text-foreground">{entry.value}</span>
                      </div>
                    ))}
                  </section>
                ) : null}
                {selectedEdge ? (
                  <section className="grid gap-3 rounded-xl border border-border/70 bg-background/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {selectedEdge.actionId}
                      </p>
                      <div className="flex gap-2">
                        {selectedEdge.liveCount > 0 ? (
                          <Badge variant="success">{selectedEdge.liveCount} live</Badge>
                        ) : null}
                        {selectedEdge.blockedCount > 0 ? (
                          <Badge variant="warning">{selectedEdge.blockedCount} blocked</Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {selectedEdge.changedDimensions.length > 0
                        ? `Changed: ${selectedEdge.changedDimensions.join(", ")}`
                        : "No grouped dimensions changed."}
                    </p>
                  </section>
                ) : null}
                {!selectedNode && !selectedEdge ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Select a node, edge, or ledger run to inspect it.
                  </p>
                ) : null}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="diff">
            <ScrollArea className="h-[420px] rounded-2xl border border-border/70 bg-background/30">
              <div className="grid gap-3 p-3">
                {selectedRecord?.afterSnapshot ? (
                  <>
                    <section className="grid gap-2 rounded-xl border border-border/70 bg-background/40 p-3">
                      <p className="text-sm font-medium text-foreground">State changes</p>
                      {changedState.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No state fields changed.</p>
                      ) : (
                        changedState.map((entry) => (
                          <div className="grid gap-2 text-sm" key={`state:${entry.key}`}>
                            <span className="font-medium text-foreground">{entry.key}</span>
                            <div className="grid gap-2 md:grid-cols-2">
                              <div className="rounded-lg border border-border/60 bg-background/60 p-2">
                                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                                  Before
                                </p>
                                <pre className="overflow-x-auto text-xs text-muted-foreground">
                                  {JSON.stringify(entry.before, null, 2)}
                                </pre>
                              </div>
                              <div className="rounded-lg border border-border/60 bg-background/60 p-2">
                                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-primary">
                                  After
                                </p>
                                <pre className="overflow-x-auto text-xs text-foreground">
                                  {JSON.stringify(entry.after, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </section>
                    <section className="grid gap-2 rounded-xl border border-border/70 bg-background/40 p-3">
                      <p className="text-sm font-medium text-foreground">Computed changes</p>
                      {changedComputed.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No computed fields changed.
                        </p>
                      ) : (
                        changedComputed.map((entry) => (
                          <div className="grid gap-2 text-sm" key={`computed:${entry.key}`}>
                            <span className="font-medium text-foreground">{entry.key}</span>
                            <div className="grid gap-2 md:grid-cols-2">
                              <div className="rounded-lg border border-border/60 bg-background/60 p-2">
                                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                                  Before
                                </p>
                                <pre className="overflow-x-auto text-xs text-muted-foreground">
                                  {JSON.stringify(entry.before, null, 2)}
                                </pre>
                              </div>
                              <div className="rounded-lg border border-border/60 bg-background/60 p-2">
                                <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-primary">
                                  After
                                </p>
                                <pre className="overflow-x-auto text-xs text-foreground">
                                  {JSON.stringify(entry.after, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </section>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Select a successful observation to inspect the before/after delta.
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="record">
            <ScrollArea className="h-[420px] rounded-2xl border border-border/70 bg-background/30">
              <div className="grid gap-3 p-3">
                {selectedRecord ? (
                  <>
                    <section className="rounded-xl border border-border/70 bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {selectedRecord.actionId}
                        </p>
                        <Badge
                          variant={
                            selectedRecord.outcome === "committed"
                              ? selectedRecord.mode === "live"
                                ? "success"
                              : "default"
                              : selectedRecord.outcome === "blocked"
                                ? "warning"
                                : "destructive"
                          }
                        >
                          {selectedRecord.outcome.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                        <p>
                          Snapshot v{selectedRecord.beforeSnapshot.meta.version}
                          {selectedRecord.afterSnapshot
                            ? ` → v${selectedRecord.afterSnapshot.meta.version}`
                            : ""}
                        </p>
                        <p>{new Date(selectedRecord.timestamp).toLocaleString()}</p>
                      </div>
                      <pre className="mt-3 overflow-x-auto rounded-lg bg-background/60 p-3 text-xs text-muted-foreground">
                        {JSON.stringify(selectedRecord.args, null, 2)}
                      </pre>
                    </section>
                    {selectedRecord.blocker ? (
                      <section className="rounded-xl border border-border/70 bg-background/40 p-3">
                        <p className="text-sm font-medium text-foreground">Blocker summary</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {selectedRecord.blocker.summary}
                        </p>
                      </section>
                    ) : null}
                    {selectedRecord.trace ? (
                      <section className="rounded-xl border border-border/70 bg-background/40 p-3">
                        <p className="text-sm font-medium text-foreground">Trace</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {selectedRecord.trace.intent.type} · {selectedRecord.trace.terminatedBy}
                        </p>
                      </section>
                    ) : null}
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Select an observation from the ledger or graph.
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
