import type { RuntimeOverlayContext } from "../contracts/inputs.js";
import type { Finding } from "../contracts/findings.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";

export type SessionCaches = {
  graph?: SemanticGraphIR;
  runtimeContext?: RuntimeOverlayContext;
  runtimeFindings?: Finding[];
  traceFindings?: Finding[];
  lineageFindings?: Finding[];
  governanceFindings?: Finding[];
};

