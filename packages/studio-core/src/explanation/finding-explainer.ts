import type { Finding } from "../contracts/findings.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";

import { buildCauseChain } from "./cause-chain-builder.js";

export function explainFinding(graph: SemanticGraphIR, finding: Finding): Finding {
  return {
    ...finding,
    causeChain: finding.causeChain ?? buildCauseChain(graph, finding)
  };
}

