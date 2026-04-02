import { TransitionGraphView } from "@manifesto-ai/studio-ui";

import { useStudioState, useStudioDispatch } from "../../context/studio-context.js";
import { useTransitionGraph } from "../../hooks/use-studio.js";

export function TransitionGraphPanel() {
  const state = useStudioState();
  const dispatch = useStudioDispatch();
  const projection = useTransitionGraph();

  return (
    <TransitionGraphView
      projection={projection}
      selectedNodeId={state.selectedTransitionNodeId}
      selectedEdgeId={state.selectedTransitionEdgeId}
      onSelectNode={(nodeId) =>
        dispatch({ type: "SELECT_TRANSITION_NODE", nodeId })
      }
      onSelectEdge={(edgeId) =>
        dispatch({ type: "SELECT_TRANSITION_EDGE", edgeId })
      }
    />
  );
}
