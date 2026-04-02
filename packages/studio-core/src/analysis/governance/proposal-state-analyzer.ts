import type { Finding } from "../../contracts/findings.js";
import type { GovernanceExport } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

const DEFAULT_STALE_PROPOSAL_WINDOW_MS = 1000 * 60 * 60 * 24;

export type ProposalStateAnalyzerOptions = {
  staleMs?: number;
};

export function analyzeProposalState(
  governance: GovernanceExport,
  options: ProposalStateAnalyzerOptions = {}
): Finding[] {
  const findings: Finding[] = [];
  const now = Date.now();
  const staleWindowMs = options.staleMs ?? DEFAULT_STALE_PROPOSAL_WINDOW_MS;

  for (const proposal of governance.proposals.values()) {
    if (proposal.stage !== "ingress") {
      continue;
    }

    if (now - proposal.createdAt <= staleWindowMs) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "proposal-stale",
        subject: { nodeId: `gov:proposal:${proposal.id}`, path: `governance.proposals.${proposal.id}` },
        message: `Governance proposal "${proposal.id}" has remained in ingress beyond the stale window.`,
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
