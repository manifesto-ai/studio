import type { Finding } from "../../contracts/findings.js";
import type { TraceGraph } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

export function analyzeExecutionPath(trace: TraceGraph): Finding[] {
  const findings: Finding[] = [];

  for (const node of Object.values(trace.nodes)) {
    if (node.kind !== "branch") {
      continue;
    }

    const taken = Boolean((node.output as { taken?: boolean } | undefined)?.taken);
    if (taken) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "unused-branch",
        subject: { nodeId: `trace:${node.id}`, path: node.sourcePath },
        message: `Trace branch at "${node.sourcePath}" was evaluated but not taken.`,
        evidence: [{ ref: { nodeId: `trace:${node.id}`, path: node.sourcePath }, role: "trace-branch" }]
      })
    );
  }

  return findings;
}

