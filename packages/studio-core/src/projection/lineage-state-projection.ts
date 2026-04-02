import type { Finding } from "../contracts/findings.js";
import type { LineageExport } from "../contracts/inputs.js";
import type { LineageStateProjection } from "../contracts/projections.js";

export function projectLineageState(
  lineage: LineageExport | undefined,
  findings: Finding[]
): LineageStateProjection {
  if (!lineage) {
    return {
      status: "not-provided",
      requiredOverlay: "lineage",
      message: "Lineage overlay was not attached."
    };
  }

  return {
    status: "ready",
    activeBranchId: lineage.activeBranchId,
    branches: lineage.branches
      .map((branch) => ({
        id: branch.id,
        epoch: branch.epoch,
        headWorldId: branch.headWorldId,
        tipWorldId: branch.tipWorldId,
        active: branch.id === lineage.activeBranchId,
        headAdvancedAt: branch.headAdvancedAt
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    worlds: [...lineage.worlds.values()]
      .map((world) => ({
        worldId: world.worldId,
        parentWorldId: world.parentWorldId,
        schemaHash: world.schemaHash,
        snapshotHash: world.snapshotHash,
        terminalStatus: world.terminalStatus,
        createdAt: world.createdAt
      }))
      .sort((left, right) => left.worldId.localeCompare(right.worldId)),
    findings
  };
}

