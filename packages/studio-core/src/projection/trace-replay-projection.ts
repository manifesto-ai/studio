import type { Finding } from "../contracts/findings.js";
import type { TraceGraph } from "../contracts/inputs.js";
import type { TraceReplayProjection } from "../contracts/projections.js";

export function projectTraceReplay(
  trace: TraceGraph | undefined,
  findings: Finding[]
): TraceReplayProjection {
  if (!trace) {
    return {
      status: "not-provided",
      requiredOverlay: "trace",
      message: "Trace overlay was not attached."
    };
  }

  const steps = Object.values(trace.nodes)
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((node) => ({
      traceNodeId: node.id,
      kind: node.kind,
      sourcePath: node.sourcePath,
      timestamp: node.timestamp,
      output: node.output,
      childCount: node.children.length
    }));

  return {
    status: "ready",
    intentType: trace.intent.type,
    baseVersion: trace.baseVersion,
    resultVersion: trace.resultVersion,
    duration: trace.duration,
    terminatedBy: trace.terminatedBy,
    steps,
    findings
  };
}

