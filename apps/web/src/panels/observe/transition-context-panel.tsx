import { useMemo } from "react";
import { TransitionInspector } from "@manifesto-ai/studio-ui";

import { useStudioState } from "../../context/studio-context.js";
import { useTransitionGraph } from "../../hooks/use-studio.js";

export function TransitionContextPanel() {
  const state = useStudioState();
  const projection = useTransitionGraph();

  const selectedNode = useMemo(() => {
    if (projection.status !== "ready" || !state.selectedTransitionNodeId) {
      return undefined;
    }
    return projection.nodes.find((n) => n.id === state.selectedTransitionNodeId);
  }, [projection, state.selectedTransitionNodeId]);

  const selectedEdge = useMemo(() => {
    if (projection.status !== "ready" || !state.selectedTransitionEdgeId) {
      return undefined;
    }
    return projection.edges.find((e) => e.id === state.selectedTransitionEdgeId);
  }, [projection, state.selectedTransitionEdgeId]);

  const selectedRecord = useMemo(() => {
    if (!state.selectedRecordId) {
      return undefined;
    }
    return state.records.find((r) => r.id === state.selectedRecordId);
  }, [state.records, state.selectedRecordId]);

  return (
    <TransitionInspector
      selectedNode={selectedNode}
      selectedEdge={selectedEdge}
      selectedRecord={selectedRecord}
    />
  );
}
