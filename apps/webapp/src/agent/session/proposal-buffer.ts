import type {
  ProposalDiagnostic,
  ProposalVerification,
} from "./proposal-verifier.js";

export type AgentProposalStatus = "verified" | "invalid";

export type AgentProposal = {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly originalSource: string;
  readonly proposedSource: string;
  readonly createdAt: string;
  readonly status: AgentProposalStatus;
  readonly diagnostics: readonly ProposalDiagnostic[];
  readonly schemaHash: string | null;
  readonly summary: string;
};

export type CreateAgentProposalInput = {
  readonly originalSource: string;
  readonly proposedSource: string;
  readonly title?: string;
  readonly rationale?: string;
  readonly verification: ProposalVerification;
  readonly now?: Date;
};

export function createAgentProposal(
  input: CreateAgentProposalInput,
): AgentProposal {
  return {
    id: createProposalId(input.proposedSource, input.now ?? new Date()),
    title: normalizeText(input.title, "MEL patch proposal"),
    rationale: normalizeText(input.rationale, ""),
    originalSource: input.originalSource,
    proposedSource: input.proposedSource,
    createdAt: (input.now ?? new Date()).toISOString(),
    status: input.verification.status,
    diagnostics: input.verification.diagnostics,
    schemaHash: input.verification.schemaHash,
    summary: input.verification.summary,
  };
}

function createProposalId(source: string, now: Date): string {
  const stamp = now.getTime().toString(36);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `proposal-${stamp}-${(hash >>> 0).toString(36)}`;
}

function normalizeText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? fallback : trimmed;
}
