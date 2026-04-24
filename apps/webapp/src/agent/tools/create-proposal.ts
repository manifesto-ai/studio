import {
  createAgentProposal,
  type AgentProposal,
} from "../session/proposal-buffer.js";
import type { ProposalVerification } from "../session/proposal-verifier.js";
import type { AgentTool, ToolRunResult } from "./types.js";

export type CreateProposalContext = {
  readonly getOriginalSource: () => string;
  readonly verify: (proposedSource: string) => Promise<ProposalVerification>;
  readonly setProposal: (proposal: AgentProposal) => void;
};

export type CreateProposalInput = {
  readonly proposedSource: string;
  readonly title?: string;
  readonly rationale?: string;
};

export type CreateProposalOutput = {
  readonly proposalId: string;
  readonly status: AgentProposal["status"];
  readonly title: string;
  readonly summary: string;
  readonly diagnosticCount: number;
  readonly diagnostics: AgentProposal["diagnostics"];
  readonly schemaHash: string | null;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["proposedSource"],
  properties: {
    proposedSource: {
      type: "string",
      description:
        "The full proposed MEL source after the small repair. Must be the complete file, not a patch snippet.",
    },
    title: {
      type: "string",
      description: "Short title for the proposed change.",
    },
    rationale: {
      type: "string",
      description: "Why this patch addresses the user's request.",
    },
  },
};

export function createCreateProposalTool(): AgentTool<
  CreateProposalInput,
  CreateProposalOutput,
  CreateProposalContext
> {
  return {
    name: "createProposal",
    description:
      "Create a single verified MEL source-change proposal for the user to review. This does NOT edit the source. Pass the full proposed MEL source; Studio will build it in a shadow verifier and show a diff with Accept/Reject controls. Use for small scoped edits to the current MEL, including adding an action to an existing domain. Do not describe an Accept button unless this tool succeeds.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runCreateProposal(input, ctx),
  };
}

export async function runCreateProposal(
  input: CreateProposalInput,
  ctx: CreateProposalContext,
): Promise<ToolRunResult<CreateProposalOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.proposedSource !== "string" ||
    input.proposedSource.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "`createProposal` requires { proposedSource: string }.",
    };
  }
  const originalSource = ctx.getOriginalSource();
  if (originalSource.trim() === "") {
    return {
      ok: false,
      kind: "runtime_error",
      message: "No current MEL source is available to compare against.",
    };
  }
  if (input.proposedSource === originalSource) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "Proposed source is identical to the current source.",
    };
  }

  const verification = await ctx.verify(input.proposedSource);
  const proposal = createAgentProposal({
    originalSource,
    proposedSource: input.proposedSource,
    title: input.title,
    rationale: input.rationale,
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
    },
  };
}
