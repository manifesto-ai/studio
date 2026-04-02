import type {
  ActorBindingSummary,
  GateStateSummary,
  GovernanceExport,
  GovernanceInput,
  ProposalSummary
} from "../contracts/inputs.js";

import {
  createIssue,
  type IngestResult,
  type IngestValidationIssue,
  isPlainObject,
  isTupleEntries
} from "./issues.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cloneProposals(
  proposals: Map<string, ProposalSummary>
): Map<string, ProposalSummary> {
  return new Map(
    [...proposals.entries()].map(([key, value]) => [key, { ...value }])
  );
}

function cloneGates(
  gates: Map<string, GateStateSummary>
): Map<string, GateStateSummary> {
  return new Map([...gates.entries()].map(([key, value]) => [key, { ...value }]));
}

function isGovernanceExport(
  governance: GovernanceExport | GovernanceInput
): governance is GovernanceExport {
  return governance.proposals instanceof Map && governance.gates instanceof Map;
}

function normalizeBinding(
  binding: unknown,
  issues: IngestValidationIssue[],
  index: number
): ActorBindingSummary | undefined {
  if (!isPlainObject(binding)) {
    issues.push(
      createIssue(
        "governance",
        "invalid-binding",
        "Bindings must be objects.",
        `governance.bindings[${index}]`
      )
    );
    return undefined;
  }

  const actorId = asString(binding.actorId);
  const authorityId = asString(binding.authorityId);
  const permissions = Array.isArray(binding.permissions)
    ? binding.permissions.filter((permission): permission is string => typeof permission === "string")
    : undefined;

  if (!actorId || !authorityId || !permissions) {
    issues.push(
      createIssue(
        "governance",
        "invalid-binding",
        "Binding summary is missing required fields.",
        `governance.bindings[${index}]`
      )
    );
    return undefined;
  }

  return {
    actorId,
    authorityId,
    permissions
  };
}

function normalizeProposal(
  proposal: unknown,
  issues: IngestValidationIssue[],
  path: string,
  fallbackId?: string
): ProposalSummary | undefined {
  if (!isPlainObject(proposal)) {
    issues.push(
      createIssue(
        "governance",
        "invalid-proposal",
        "Proposal entries must be objects.",
        path
      )
    );
    return undefined;
  }

  const id = asString(proposal.id) ?? fallbackId;
  const branchId = asString(proposal.branchId);
  const stage =
    proposal.stage === "ingress" ||
    proposal.stage === "execution" ||
    proposal.stage === "terminal"
      ? proposal.stage
      : undefined;
  const outcome =
    proposal.outcome === undefined ||
    proposal.outcome === "approved" ||
    proposal.outcome === "rejected" ||
    proposal.outcome === "abandoned"
      ? proposal.outcome
      : undefined;
  const actorId = asString(proposal.actorId);
  const createdAt = asNumber(proposal.createdAt);
  const terminalizedAt =
    proposal.terminalizedAt === undefined
      ? undefined
      : asNumber(proposal.terminalizedAt);

  if (!id || !branchId || !stage || outcome === undefined && proposal.outcome !== undefined && outcome !== proposal.outcome || !actorId || createdAt === undefined) {
    issues.push(
      createIssue(
        "governance",
        "invalid-proposal",
        "Proposal summary is missing required fields.",
        path
      )
    );
    return undefined;
  }

  return {
    id,
    branchId,
    stage,
    outcome,
    actorId,
    createdAt,
    terminalizedAt
  };
}

function normalizeGate(
  gate: unknown,
  issues: IngestValidationIssue[],
  path: string,
  fallbackBranchId?: string
): GateStateSummary | undefined {
  if (!isPlainObject(gate)) {
    issues.push(
      createIssue(
        "governance",
        "invalid-gate",
        "Gate entries must be objects.",
        path
      )
    );
    return undefined;
  }

  const branchId = asString(gate.branchId) ?? fallbackBranchId;
  const locked = typeof gate.locked === "boolean" ? gate.locked : undefined;
  const currentProposalId =
    gate.currentProposalId === undefined ? undefined : asString(gate.currentProposalId);
  const epoch = asNumber(gate.epoch);

  if (!branchId || locked === undefined || epoch === undefined) {
    issues.push(
      createIssue(
        "governance",
        "invalid-gate",
        "Gate summary is missing required fields.",
        path
      )
    );
    return undefined;
  }

  return {
    branchId,
    locked,
    currentProposalId,
    epoch
  };
}

function normalizeProposals(
  proposals: GovernanceInput["proposals"],
  issues: IngestValidationIssue[]
): Map<string, ProposalSummary> {
  const normalized = new Map<string, ProposalSummary>();

  if (proposals instanceof Map) {
    for (const [key, value] of proposals.entries()) {
      const proposal = normalizeProposal(
        value,
        issues,
        `governance.proposals.${key}`,
        key
      );
      if (proposal) {
        normalized.set(proposal.id, proposal);
      }
    }
    return normalized;
  }

  if (Array.isArray(proposals) && !isTupleEntries<ProposalSummary>(proposals)) {
    const proposalEntries = proposals as ReadonlyArray<ProposalSummary>;
    proposalEntries.forEach((value, index) => {
      const proposal = normalizeProposal(
        value,
        issues,
        `governance.proposals[${index}]`
      );
      if (proposal) {
        normalized.set(proposal.id, proposal);
      }
    });
    return normalized;
  }

  if (isTupleEntries<ProposalSummary>(proposals)) {
    proposals.forEach(([key, value], index) => {
      const proposal = normalizeProposal(
        value,
        issues,
        `governance.proposals[${index}]`,
        key
      );
      if (proposal) {
        normalized.set(proposal.id, proposal);
      }
    });
    return normalized;
  }

  if (isPlainObject(proposals)) {
    for (const [key, value] of Object.entries(proposals)) {
      const proposal = normalizeProposal(
        value,
        issues,
        `governance.proposals.${key}`,
        key
      );
      if (proposal) {
        normalized.set(proposal.id, proposal);
      }
    }
    return normalized;
  }

  issues.push(
    createIssue(
      "governance",
      "invalid-proposals",
      "governance.proposals must be a Map, record, tuple entries, or array of proposal summaries.",
      "governance.proposals"
    )
  );
  return normalized;
}

function normalizeGates(
  gates: GovernanceInput["gates"],
  issues: IngestValidationIssue[]
): Map<string, GateStateSummary> {
  const normalized = new Map<string, GateStateSummary>();

  if (gates instanceof Map) {
    for (const [key, value] of gates.entries()) {
      const gate = normalizeGate(value, issues, `governance.gates.${key}`, key);
      if (gate) {
        normalized.set(gate.branchId, gate);
      }
    }
    return normalized;
  }

  if (Array.isArray(gates) && !isTupleEntries<GateStateSummary>(gates)) {
    const gateEntries = gates as ReadonlyArray<GateStateSummary>;
    gateEntries.forEach((value, index) => {
      const gate = normalizeGate(value, issues, `governance.gates[${index}]`);
      if (gate) {
        normalized.set(gate.branchId, gate);
      }
    });
    return normalized;
  }

  if (isTupleEntries<GateStateSummary>(gates)) {
    gates.forEach(([key, value], index) => {
      const gate = normalizeGate(value, issues, `governance.gates[${index}]`, key);
      if (gate) {
        normalized.set(gate.branchId, gate);
      }
    });
    return normalized;
  }

  if (isPlainObject(gates)) {
    for (const [key, value] of Object.entries(gates)) {
      const gate = normalizeGate(value, issues, `governance.gates.${key}`, key);
      if (gate) {
        normalized.set(gate.branchId, gate);
      }
    }
    return normalized;
  }

  issues.push(
    createIssue(
      "governance",
      "invalid-gates",
      "governance.gates must be a Map, record, tuple entries, or array of gate summaries.",
      "governance.gates"
    )
  );
  return normalized;
}

export function ingestGovernance(
  governance: GovernanceExport | GovernanceInput
): IngestResult<GovernanceExport> {
  if (isGovernanceExport(governance)) {
    return {
      value: {
        proposals: cloneProposals(governance.proposals),
        bindings: governance.bindings.map((binding) => ({
          ...binding,
          permissions: [...binding.permissions]
        })),
        gates: cloneGates(governance.gates)
      },
      issues: []
    };
  }

  const issues: IngestValidationIssue[] = [];
  const bindings = Array.isArray(governance.bindings)
    ? governance.bindings
        .map((binding, index) => normalizeBinding(binding, issues, index))
        .filter((binding): binding is ActorBindingSummary => Boolean(binding))
    : [];
  if (!Array.isArray(governance.bindings)) {
    issues.push(
      createIssue(
        "governance",
        "invalid-bindings",
        "governance.bindings must be an array.",
        "governance.bindings"
      )
    );
  }

  return {
    value:
      Array.isArray(governance.bindings)
        ? {
            proposals: normalizeProposals(governance.proposals, issues),
            bindings,
            gates: normalizeGates(governance.gates, issues)
          }
        : undefined,
    issues
  };
}
