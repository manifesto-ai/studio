import { DomainGraphView } from "@manifesto-ai/studio-ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@manifesto-ai/ui-core";

import { useStudioState, useStudioDispatch } from "../../context/studio-context.js";
import { useGraph } from "../../hooks/use-studio.js";

export function DomainGraphPanel() {
  const state = useStudioState();
  const dispatch = useStudioDispatch();
  const graph = useGraph();

  if (!graph) {
    return (
      <Card className="flex h-full min-h-0 flex-col">
        <CardHeader className="pb-3">
          <CardTitle>Graph</CardTitle>
          <CardDescription>
            {state.compileStatus === "error" ? "Fix draft" : "Compile first"}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/20 px-6 text-sm text-muted-foreground">
            empty
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <DomainGraphView
      onSelectNode={(nodeId) => {
        dispatch({ type: "SELECT_NODE", nodeId });
        if (nodeId.startsWith("action:")) {
          dispatch({
            type: "SELECT_ACTION",
            actionId: nodeId.slice("action:".length)
          });
        }
      }}
      projection={graph}
      selectedNodeId={state.selectedNodeId}
    />
  );
}
