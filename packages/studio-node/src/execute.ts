import {
  createStudioSession,
  projectTransitionGraph
} from "@manifesto-ai/studio-core";
import type {
  AnalysisBundle
} from "@manifesto-ai/studio-core";

import type {
  StudioFileInput,
  StudioOperation,
  StudioOperationResult
} from "./contracts.js";
import {
  loadAnalysisBundleFromFiles,
  loadTransitionGraphInputsFromFiles
} from "./load.js";

export function executeStudioOperationFromBundle(
  bundle: AnalysisBundle,
  operation: StudioOperation,
  sessionOptions: StudioFileInput["sessionOptions"]
): StudioOperationResult {
  const session = createStudioSession(bundle, sessionOptions);

  try {
    switch (operation.kind) {
      case "graph":
        return session.getGraph(operation.format ?? "summary");
      case "findings":
        return session.getFindings(operation.filter);
      case "availability":
        return session.getActionAvailability();
      case "explain-action":
        return session.explainActionBlocker(operation.actionId);
      case "snapshot":
        return session.inspectSnapshot();
      case "trace":
        return session.analyzeTrace();
      case "lineage":
        return session.getLineageState();
      case "governance":
        return session.getGovernanceState();
      case "transition-graph":
        throw new Error(
          "transition-graph requires observations and preset inputs; use executeStudioOperation with file input."
        );
    }
  } finally {
    session.dispose();
  }
}

export async function executeStudioOperation(
  input: StudioFileInput,
  operation: StudioOperation
): Promise<StudioOperationResult> {
  if (operation.kind === "transition-graph") {
    const {
      observations,
      projectionPreset,
      currentSnapshot
    } = await loadTransitionGraphInputsFromFiles(input);

    if (!observations) {
      throw new Error(
        "transition-graph requires observations input via --observations or bundle observations."
      );
    }

    if (!projectionPreset) {
      throw new Error(
        "transition-graph requires a projection preset via --preset or bundle projectionPreset."
      );
    }

    return projectTransitionGraph(observations, projectionPreset, {
      currentSnapshot
    });
  }

  const bundle = await loadAnalysisBundleFromFiles(input);
  return executeStudioOperationFromBundle(bundle, operation, input.sessionOptions);
}
