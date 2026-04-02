import type { Finding } from "../../contracts/findings.js";
import type { LineageExport } from "../../contracts/inputs.js";

import { createFinding } from "../../internal/findings.js";

export function analyzeDagState(lineage: LineageExport): Finding[] {
  const findings: Finding[] = [];
  const reachableBranches = new Set<string>([lineage.activeBranchId]);

  for (const branch of lineage.branches) {
    if (branch.id === lineage.activeBranchId) {
      continue;
    }

    const reachableViaWorld = branch.headWorldId
      ? lineage.worlds.has(branch.headWorldId)
      : false;
    if (reachableViaWorld) {
      reachableBranches.add(branch.id);
    }
  }

  for (const branch of lineage.branches) {
    if (reachableBranches.has(branch.id)) {
      continue;
    }

    findings.push(
      createFinding({
        kind: "orphan-branch",
        subject: { nodeId: `lineage:branch:${branch.id}`, path: `lineage.branches.${branch.id}` },
        message: `Lineage branch "${branch.id}" is not reachable from the active branch context.`,
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

