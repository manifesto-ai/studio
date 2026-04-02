import type { Finding } from "../../contracts/findings.js";
import type { GovernanceExport } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

export function analyzeGovernedPaths(governance: GovernanceExport): Finding[] {
  const findings: Finding[] = [];

  for (const proposal of governance.proposals.values()) {
    const bound = governance.bindings.some(
      (binding) => binding.actorId === proposal.actorId
    );
    if (bound) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "actor-unbound",
        subject: { nodeId: `gov:proposal:${proposal.id}`, path: `governance.proposals.${proposal.id}` },
        message: `Actor "${proposal.actorId}" has no governance binding for proposal "${proposal.id}".`,
        evidence: [
          {
            ref: { nodeId: `gov:proposal:${proposal.id}`, path: `governance.proposals.${proposal.id}` },
            role: "proposal"
          }
        ]
      })
    );
  }

  return findings;
}

