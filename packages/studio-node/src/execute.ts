import { createStudioSession } from "@manifesto-ai/studio-core";
import type {
  AnalysisBundle
} from "@manifesto-ai/studio-core";

import type {
  StudioFileInput,
  StudioOperation,
  StudioOperationResult
} from "./contracts.js";
import { loadAnalysisBundleFromFiles } from "./load.js";

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
    }
  } finally {
    session.dispose();
  }
}

export async function executeStudioOperation(
  input: StudioFileInput,
  operation: StudioOperation
): Promise<StudioOperationResult> {
  const bundle = await loadAnalysisBundleFromFiles(input);
  return executeStudioOperationFromBundle(bundle, operation, input.sessionOptions);
}
