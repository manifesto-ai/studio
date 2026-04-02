import type { Finding } from "../../contracts/findings.js";
import type { TraceGraph } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

export function analyzePatchSummary(trace: TraceGraph): Finding[] {
  const findings: Finding[] = [];

  for (const node of Object.values(trace.nodes)) {
    if (node.kind !== "patch") {
      continue;
    }

    const output = node.output as { previous?: unknown; next?: unknown } | undefined;
    if (!output || output.previous !== output.next) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "redundant-patch",
        subject: { nodeId: `trace:${node.id}`, path: node.sourcePath },
        message: `Patch at "${node.sourcePath}" writes the same value it already held.`,
        evidence: [{ ref: { nodeId: `trace:${node.id}`, path: node.sourcePath }, role: "trace-patch" }]
      })
    );
  }

  return findings;
}

