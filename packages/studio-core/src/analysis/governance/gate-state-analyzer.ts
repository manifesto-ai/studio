import type { Finding } from "../../contracts/findings.js";
import type { GovernanceExport } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

export function analyzeGateState(governance: GovernanceExport): Finding[] {
  const findings: Finding[] = [];

  for (const gate of governance.gates.values()) {
    if (!gate.locked) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "gate-locked",
        subject: { nodeId: `gov:gate:${gate.branchId}`, path: `governance.gates.${gate.branchId}` },
        message: `Governance gate for branch "${gate.branchId}" is currently locked.`,
        evidence: [
          {
            ref: { nodeId: `gov:gate:${gate.branchId}`, path: `governance.gates.${gate.branchId}` },
            role: "gate"
          }
        ]
      })
    );
  }

  return findings;
}

