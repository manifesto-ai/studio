import {
  classifyMelAuthorDraftFailure,
  createMelAuthorFailureReport,
  type MelAuthorFailureReport,
  type MelAuthorFinalDraft,
  type MelAuthorLineageOutput,
} from "@manifesto-ai/studio-mel-author-agent";
import {
  createAgentProposal,
  type AgentProposal,
} from "../session/proposal-buffer.js";
import type { ProposalVerification } from "../session/proposal-verifier.js";
import type { AgentTool, ToolRunResult } from "./types.js";

export type AuthorMelProposalContext = {
  readonly getOriginalSource: () => string;
  readonly draft: (input: AuthorMelDraftRequest) => Promise<AuthorMelDraftResult>;
  readonly verify: (proposedSource: string) => Promise<ProposalVerification>;
  readonly setProposal: (proposal: AgentProposal) => void;
};

export type AuthorMelDraftRequest = {
  readonly source: string;
  readonly request: string;
  readonly title?: string;
};

export type AuthorMelDraftResult =
  | {
      readonly ok: true;
      readonly output: MelAuthorFinalDraft;
      readonly text?: string;
      readonly finishReason?: string;
      readonly toolCallCount?: number;
      readonly authorLineage?: MelAuthorLineageOutput;
    }
  | {
      readonly ok: false;
      readonly kind: "invalid_input" | "runtime_error";
      readonly message: string;
      readonly detail?:
        | {
            readonly failureReport?: MelAuthorFailureReport;
            readonly authorLineage?: MelAuthorLineageOutput;
          }
        | unknown;
    };

export type AuthorMelProposalInput = {
  readonly request: string;
  readonly title?: string;
  readonly rationale?: string;
};

export type AuthorMelProposalOutput = {
  readonly proposalId: string;
  readonly status: AgentProposal["status"];
  readonly title: string;
  readonly summary: string;
  readonly diagnosticCount: number;
  readonly diagnostics: AgentProposal["diagnostics"];
  readonly schemaHash: string | null;
  readonly authorStatus: MelAuthorFinalDraft["status"];
  readonly authorSummary: string;
  readonly authorLineage?: MelAuthorLineageOutput;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["request"],
  properties: {
    request: {
      type: "string",
      description:
        "The user's MEL source-change request. Include all relevant user wording.",
    },
    title: {
      type: "string",
      description: "Short title for the proposed change.",
    },
    rationale: {
      type: "string",
      description: "Why the patch addresses the user's request.",
    },
  },
};

export function createAuthorMelProposalTool(): AgentTool<
  AuthorMelProposalInput,
  AuthorMelProposalOutput,
  AuthorMelProposalContext
> {
  return {
    name: "authorMelProposal",
    description:
      "Delegate a MEL source-change request to the dedicated MEL Author Agent. The author works in an ephemeral workspace, builds/verifies its draft, and returns a full proposed MEL source for Studio's Accept/Reject proposal UI. Prefer this over writing proposedSource yourself.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runAuthorMelProposal(input, ctx),
  };
}

export async function runAuthorMelProposal(
  input: AuthorMelProposalInput,
  ctx: AuthorMelProposalContext,
): Promise<ToolRunResult<AuthorMelProposalOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.request !== "string" ||
    input.request.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`authorMelProposal` requires { request: string }.",
    };
  }

  const originalSource = ctx.getOriginalSource();
  if (originalSource.trim() === "") {
    return {
      ok: false,
      kind: "runtime_error",
      message: "No current MEL source is available to author against.",
    };
  }

  const author = await ctx.draft({
    source: originalSource,
    request: input.request.trim(),
    title: input.title,
  });
  if (!author.ok) {
    return {
      ok: false,
      kind: author.kind,
      message: author.message,
      detail: author.detail,
    };
  }

  const draft = author.output;
  const draftFailure = classifyMelAuthorDraftFailure({
    draft,
    originalSource,
    finishReason: author.finishReason,
    toolCallCount: author.toolCallCount,
  });
  if (draftFailure !== null) {
    return {
      ok: false,
      kind:
        draftFailure.failureKind === "unchanged_source"
          ? "invalid_input"
          : "runtime_error",
      message: draftFailure.summary,
      detail: {
        failureReport: draftFailure,
        authorLineage: author.authorLineage,
      },
    };
  }

  const verification = await ctx.verify(draft.proposedSource);
  if (verification.status === "invalid") {
    const failureReport = createMelAuthorFailureReport({
      failureKind: "compile_error",
      summary: verification.summary,
      diagnostics: verification.diagnostics,
      source: draft.proposedSource,
      retryAdvice:
        "Repair the verifier diagnostics before presenting the proposal again.",
      finishReason: author.finishReason,
      toolCallCount: author.toolCallCount,
    });
    return {
      ok: false,
      kind: "runtime_error",
      message: failureReport.summary,
      detail: {
        failureReport,
        authorLineage: author.authorLineage,
      },
    };
  }

  const proposal = createAgentProposal({
    originalSource,
    proposedSource: draft.proposedSource,
    title: input.title ?? draft.title,
    rationale: input.rationale ?? draft.rationale,
    verification,
  });
  ctx.setProposal(proposal);
  return {
    ok: true,
    output: {
      proposalId: proposal.id,
      status: proposal.status,
      title: proposal.title,
      summary: proposal.summary,
      diagnosticCount: proposal.diagnostics.length,
      diagnostics: proposal.diagnostics,
      schemaHash: proposal.schemaHash,
      authorStatus: draft.status,
      authorSummary: draft.summary,
      authorLineage: author.authorLineage,
    },
  };
}
