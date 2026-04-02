import type { Finding } from "../contracts/findings.js";
import type { GovernanceExport } from "../contracts/inputs.js";
import type { GovernanceStateProjection } from "../contracts/projections.js";

export function projectGovernanceState(
  governance: GovernanceExport | undefined,
  findings: Finding[]
): GovernanceStateProjection {
  if (!governance) {
    return {
      status: "not-provided",
      requiredOverlay: "governance",
      message: "Governance overlay was not attached."
    };
  }

  return {
    status: "ready",
    proposals: [...governance.proposals.values()]
      .map((proposal) => ({
        id: proposal.id,
        branchId: proposal.branchId,
        stage: proposal.stage,
        outcome: proposal.outcome,
        actorId: proposal.actorId,
        createdAt: proposal.createdAt,
        terminalizedAt: proposal.terminalizedAt
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    bindings: governance.bindings
      .map((binding) => ({
        actorId: binding.actorId,
        authorityId: binding.authorityId,
        permissions: [...binding.permissions]
      }))
      .sort((left, right) => left.actorId.localeCompare(right.actorId)),
    gates: [...governance.gates.values()]
      .map((gate) => ({
        branchId: gate.branchId,
        locked: gate.locked,
        currentProposalId: gate.currentProposalId,
        epoch: gate.epoch
      }))
      .sort((left, right) => left.branchId.localeCompare(right.branchId)),
    findings
  };
}

