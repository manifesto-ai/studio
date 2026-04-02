import type { Finding } from "../../contracts/findings.js";
import type { TraceGraph } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

export function analyzeEffectSummary(trace: TraceGraph): Finding[] {
  const findings: Finding[] = [];
  const patchPrefixes = new Set(
    Object.values(trace.nodes)
      .filter((node) => node.kind === "patch")
      .map((node) => node.sourcePath.split(".").slice(0, -1).join("."))
  );

  for (const node of Object.values(trace.nodes)) {
    if (node.kind !== "effect") {
      continue;
    }

    const parentPrefix = node.sourcePath.split(".").slice(0, -1).join(".");
    if (patchPrefixes.has(parentPrefix)) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "effect-without-patch",
        subject: { nodeId: `trace:${node.id}`, path: node.sourcePath },
        message: `Effect at "${node.sourcePath}" completed without an adjacent trace patch node.`,
        evidence: [{ ref: { nodeId: `trace:${node.id}`, path: node.sourcePath }, role: "trace-effect" }]
      })
    );
  }

  return findings;
}

