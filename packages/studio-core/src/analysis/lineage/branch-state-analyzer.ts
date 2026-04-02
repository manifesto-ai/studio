import type { Finding } from "../../contracts/findings.js";
import type { LineageExport } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

const DEFAULT_STALE_WINDOW_MS = 1000 * 60 * 60 * 24;

export type BranchStateAnalyzerOptions = {
  staleMs?: number;
};

export function analyzeBranchState(
  lineage: LineageExport,
  options: BranchStateAnalyzerOptions = {}
): Finding[] {
  const findings: Finding[] = [];
  const now = Date.now();
  const staleWindowMs = options.staleMs ?? DEFAULT_STALE_WINDOW_MS;

  for (const branch of lineage.branches) {
    if (branch.headAdvancedAt == null) {
      continue;
    }

    if (now - branch.headAdvancedAt <= staleWindowMs) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "branch-stale",
        subject: { nodeId: `lineage:branch:${branch.id}`, path: `lineage.branches.${branch.id}` },
        message: `Lineage branch "${branch.id}" has not advanced recently.`,
        evidence: [
          {
            ref: { nodeId: `lineage:branch:${branch.id}`, path: `lineage.branches.${branch.id}` },
            role: "branch"
          }
        ]
      })
    );
  }

  return findings;
}
