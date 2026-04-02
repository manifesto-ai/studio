import type { Finding } from "../../contracts/findings.js";
import type { LineageExport } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

export function analyzeSealAttempts(lineage: LineageExport): Finding[] {
  const findings: Finding[] = [];

  for (const [worldId, attempts] of lineage.attempts.entries()) {
    const reused = attempts.some((attempt) => attempt.reused);
    if (!reused) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "seal-reuse-detected",
        subject: { nodeId: `lineage:world:${worldId}`, path: `lineage.worlds.${worldId}` },
        message: `World "${worldId}" was reused across seal attempts.`,
        evidence: [
          {
            ref: { nodeId: `lineage:world:${worldId}`, path: `lineage.worlds.${worldId}` },
            role: "world"
          }
        ]
      })
    );
  }

  return findings;
}

