/**
 * Workspace tools — LLM-facing wrappers around `Workspace.apply()`.
 *
 * Each op tool takes user-facing string args (LLM ergonomics), validates
 * shape, builds a typed `MelEditOp`, and dispatches to `ws.apply()`. The
 * compiler does the actual parse + validate + render + diff inside
 * `compileFragmentInContext`; we just shape the input and project the
 * result back to a compact JSON output for the LLM.
 *
 * Control tools (popLastOp, inspectWorkspace) and commitWorkspace live
 * alongside so an authoring runtime can register the full workspace
 * surface from a single import.
 *
 * MVP scope (Phase 1):
 *   addAction, addStateField, addComputed, replaceActionBody,
 *   replaceComputedExpr, removeDeclaration
 *   + popLastOp, inspectWorkspace, commitWorkspace
 *
 * Phase 2 will add the rest of the 14 op kinds + branching workspace
 * controls + renameDeclaration with reference plan.
 */
import type {
  Diagnostic,
  JsonLiteral,
  LocalTargetKey,
  MelEditOp,
  MelEditResult,
  SchemaDiff,
} from "@manifesto-ai/compiler";
import {
  createAgentProposal,
  type AgentProposal,
} from "../session/proposal-buffer.js";
import type { ProposalVerification } from "../session/proposal-verifier.js";
import type { AgentTool, ToolRunResult } from "./types.js";
import type {
  Workspace,
  WorkspaceProjection,
} from "../workspace/workspace.js";

// ─────────────────────────────────────────────────────────────────────
// Shared context
// ─────────────────────────────────────────────────────────────────────

export type WorkspaceToolContext = {
  /** Resolve the active workspace. Returns `null` when no workspace is open
   *  (e.g. live runtime mode). */
  readonly getWorkspace: () => Workspace | null;
};

export type CommitWorkspaceContext = WorkspaceToolContext & {
  /** Original source captured for the workspace. Used to populate the
   *  proposal-buffer's diff baseline. */
  readonly getOriginalSource: () => string;
  /** Shadow verifier (same one createProposal uses). */
  readonly verify: (proposedSource: string) => Promise<ProposalVerification>;
  /** Stash the proposal so ProposalPreview renders it. */
  readonly setProposal: (proposal: AgentProposal) => void;
};

// ─────────────────────────────────────────────────────────────────────
// Common output projection
// ─────────────────────────────────────────────────────────────────────

type ApplyOpOutput = {
  readonly applied: boolean;
  readonly opKind: MelEditOp["kind"];
  readonly target: string | null;
  readonly status: "clean" | "broken";
  readonly diagnosticCount: number;
  readonly diagnostics: readonly DiagnosticProjection[];
  readonly changedTargets: readonly LocalTargetKey[];
  readonly schemaDiff: SchemaDiff | null;
  readonly stackDepth: number;
  readonly canCommit: boolean;
};

type DiagnosticProjection = {
  readonly severity: Diagnostic["severity"];
  readonly message: string;
  readonly code?: string;
  readonly line?: number;
  readonly column?: number;
};

function applyAndProject(
  ws: Workspace,
  op: MelEditOp,
): ToolRunResult<ApplyOpOutput> {
  const result = ws.apply(op);
  return {
    ok: true,
    output: {
      applied: result.ok,
      opKind: op.kind,
      target: extractTarget(op),
      status: ws.getStatus(),
      diagnosticCount: result.diagnostics.length,
      diagnostics: result.diagnostics.map(projectDiagnostic),
      changedTargets: result.changedTargets,
      schemaDiff: result.schemaDiff ?? null,
      stackDepth: ws.snapshot().stackDepth,
      canCommit: ws.canCommit(),
    },
  };
}

function projectDiagnostic(d: Diagnostic): DiagnosticProjection {
  const loc = (d as { readonly location?: { readonly line?: number; readonly column?: number } }).location;
  return {
    severity: d.severity,
    message: d.message,
    code: (d as { readonly code?: string }).code,
    line: loc?.line,
    column: loc?.column,
  };
}

function extractTarget(op: MelEditOp): string | null {
  switch (op.kind) {
    case "addType":
    case "addStateField":
    case "addComputed":
    case "addAction":
      return op.name;
    default:
      return (op as { target?: string }).target ?? null;
  }
}

function noWorkspace(): ToolRunResult<never> {
  return {
    ok: false,
    kind: "runtime_error",
    message:
      "No active workspace. Workspace tools require an active authoring workspace.",
  };
}

function invalid(message: string): ToolRunResult<never> {
  return { ok: false, kind: "invalid_input", message };
}

// ─────────────────────────────────────────────────────────────────────
// Op tools
// ─────────────────────────────────────────────────────────────────────

const ADD_ACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["name", "params", "body"],
  properties: {
    name: { type: "string", description: "Identifier for the new action." },
    params: {
      type: "array",
      description: "Parameter list. Each item: { name, type } where type is a MEL type expression as a string (e.g. \"string\", \"number\").",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type"],
        properties: {
          name: { type: "string" },
          type: { type: "string" },
        },
      },
    },
    body: {
      type: "string",
      description:
        "Full action body MEL source, including the curly braces — e.g. `{ onceIntent { patch x = 1 } }`. Compiler validates in context.",
    },
  },
};

export function createAddActionTool(): AgentTool<
  { readonly name: string; readonly params: readonly { readonly name: string; readonly type: string }[]; readonly body: string },
  ApplyOpOutput,
  WorkspaceToolContext
> {
  return {
    name: "addAction",
    description:
      "Add a new action to the current MEL domain inside the workspace. Pass action body MEL source as a string (compiler validates it). Stack grows by 1; if the body fails to compile, status flips to broken and you can call popLastOp or fix and retry.",
    jsonSchema: ADD_ACTION_SCHEMA,
    run: async (input, ctx) => {
      const ws = ctx.getWorkspace();
      if (ws === null) return noWorkspace();
      if (typeof input?.name !== "string" || input.name.trim() === "") {
        return invalid("addAction requires a non-empty `name`.");
      }
      if (!Array.isArray(input.params)) {
        return invalid("addAction requires `params: { name, type }[]`.");
      }
      for (const p of input.params) {
        if (
          p === null ||
          typeof p !== "object" ||
          typeof (p as { name?: unknown }).name !== "string" ||
          typeof (p as { type?: unknown }).type !== "string"
        ) {
          return invalid(
            "addAction params entries must be { name: string, type: string }.",
          );
        }
      }
      if (typeof input.body !== "string" || input.body.trim() === "") {
        return invalid("addAction requires a non-empty `body` string.");
      }
      return applyAndProject(ws, {
        kind: "addAction",
        name: input.name,
        params: input.params.map((p) => ({ name: p.name, type: p.type })),
        body: input.body,
      });
    },
  };
}

const ADD_STATE_FIELD_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["name", "type", "defaultValue"],
  properties: {
    name: { type: "string" },
    type: {
      type: "string",
      description: "MEL type expression as a string (e.g. \"number\", \"string | null\", \"Task[]\").",
    },
    defaultValue: {
      description: "JSON literal for the initial value (number, string, boolean, null, array, object).",
    },
  },
};

export function createAddStateFieldTool(): AgentTool<
  { readonly name: string; readonly type: string; readonly defaultValue: JsonLiteral },
  ApplyOpOutput,
  WorkspaceToolContext
> {
  return {
    name: "addStateField",
    description:
      "Add a new field to the domain `state {}` block. Provide a MEL type expression as a string and a JSON literal default value.",
    jsonSchema: ADD_STATE_FIELD_SCHEMA,
    run: async (input, ctx) => {
      const ws = ctx.getWorkspace();
      if (ws === null) return noWorkspace();
      if (typeof input?.name !== "string" || input.name.trim() === "") {
        return invalid("addStateField requires a non-empty `name`.");
      }
      if (typeof input.type !== "string" || input.type.trim() === "") {
        return invalid("addStateField requires a non-empty `type` string.");
      }
      return applyAndProject(ws, {
        kind: "addStateField",
        name: input.name,
        type: input.type,
        defaultValue: input.defaultValue as JsonLiteral,
      });
    },
  };
}

const ADD_COMPUTED_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["name", "expr"],
  properties: {
    name: { type: "string" },
    expr: {
      type: "string",
      description: "Right-hand-side expression MEL source, no leading `=`.",
    },
  },
};

export function createAddComputedTool(): AgentTool<
  { readonly name: string; readonly expr: string },
  ApplyOpOutput,
  WorkspaceToolContext
> {
  return {
    name: "addComputed",
    description:
      "Add a new computed field to the domain. `expr` is the right-hand-side MEL expression as a string (e.g. \"count + 1\").",
    jsonSchema: ADD_COMPUTED_SCHEMA,
    run: async (input, ctx) => {
      const ws = ctx.getWorkspace();
      if (ws === null) return noWorkspace();
      if (typeof input?.name !== "string" || input.name.trim() === "") {
        return invalid("addComputed requires a non-empty `name`.");
      }
      if (typeof input.expr !== "string" || input.expr.trim() === "") {
        return invalid("addComputed requires a non-empty `expr` string.");
      }
      return applyAndProject(ws, {
        kind: "addComputed",
        name: input.name,
        expr: input.expr,
      });
    },
  };
}

const REPLACE_ACTION_BODY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["target", "body"],
  properties: {
    target: {
      type: "string",
      description: "Action target id, e.g. `action:toggleDone`.",
    },
    body: {
      type: "string",
      description: "Full new action body MEL source (with curly braces).",
    },
  },
};

export function createReplaceActionBodyTool(): AgentTool<
  { readonly target: string; readonly body: string },
  ApplyOpOutput,
  WorkspaceToolContext
> {
  return {
    name: "replaceActionBody",
    description:
      "Replace the body of an existing action. Use after readDeclaration to confirm the current body. The action's params and guards (available/dispatchable) stay intact; only the body changes.",
    jsonSchema: REPLACE_ACTION_BODY_SCHEMA,
    run: async (input, ctx) => {
      const ws = ctx.getWorkspace();
      if (ws === null) return noWorkspace();
      if (
        typeof input?.target !== "string" ||
        !input.target.startsWith("action:")
      ) {
        return invalid(
          "replaceActionBody requires `target: \"action:<name>\"`.",
        );
      }
      if (typeof input.body !== "string" || input.body.trim() === "") {
        return invalid("replaceActionBody requires a non-empty `body` string.");
      }
      return applyAndProject(ws, {
        kind: "replaceActionBody",
        target: input.target as `action:${string}`,
        body: input.body,
      });
    },
  };
}

const REPLACE_COMPUTED_EXPR_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["target", "expr"],
  properties: {
    target: {
      type: "string",
      description: "Computed target id, e.g. `computed:doneCount`.",
    },
    expr: { type: "string" },
  },
};

export function createReplaceComputedExprTool(): AgentTool<
  { readonly target: string; readonly expr: string },
  ApplyOpOutput,
  WorkspaceToolContext
> {
  return {
    name: "replaceComputedExpr",
    description:
      "Replace the expression of an existing computed. Use after readDeclaration to confirm the current expression.",
    jsonSchema: REPLACE_COMPUTED_EXPR_SCHEMA,
    run: async (input, ctx) => {
      const ws = ctx.getWorkspace();
      if (ws === null) return noWorkspace();
      if (
        typeof input?.target !== "string" ||
        !input.target.startsWith("computed:")
      ) {
        return invalid(
          "replaceComputedExpr requires `target: \"computed:<name>\"`.",
        );
      }
      if (typeof input.expr !== "string" || input.expr.trim() === "") {
        return invalid("replaceComputedExpr requires a non-empty `expr` string.");
      }
      return applyAndProject(ws, {
        kind: "replaceComputedExpr",
        target: input.target as `computed:${string}`,
        expr: input.expr,
      });
    },
  };
}

const REMOVE_DECLARATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["target"],
  properties: {
    target: {
      type: "string",
      description:
        "Target id of the declaration to remove (e.g. `state_field:lastTouched`, `computed:doneCount`, `action:clearDone`).",
    },
  },
};

export function createRemoveDeclarationTool(): AgentTool<
  { readonly target: string },
  ApplyOpOutput,
  WorkspaceToolContext
> {
  return {
    name: "removeDeclaration",
    description:
      "Remove a declaration from the domain. Compiler will surface diagnostics if the removal leaves dangling references; in that case the workspace flips to broken and you should follow up with the necessary edits.",
    jsonSchema: REMOVE_DECLARATION_SCHEMA,
    run: async (input, ctx) => {
      const ws = ctx.getWorkspace();
      if (ws === null) return noWorkspace();
      if (typeof input?.target !== "string" || input.target.trim() === "") {
        return invalid("removeDeclaration requires a non-empty `target`.");
      }
      return applyAndProject(ws, {
        kind: "removeDeclaration",
        target: input.target as LocalTargetKey,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Control tools
// ─────────────────────────────────────────────────────────────────────

const POP_LAST_OP_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export function createPopLastOpTool(): AgentTool<
  Record<string, never>,
  { readonly popped: boolean; readonly stackDepth: number; readonly status: "clean" | "broken"; readonly canCommit: boolean },
  WorkspaceToolContext
> {
  return {
    name: "popLastOp",
    description:
      "Undo the most recently applied workspace op. Restores the source and module to the snapshot taken before the op. Returns popped:false when the stack is already empty.",
    jsonSchema: POP_LAST_OP_SCHEMA,
    run: async (_input, ctx) => {
      const ws = ctx.getWorkspace();
      if (ws === null) return noWorkspace();
      const popped = ws.popLast();
      return {
        ok: true,
        output: {
          popped,
          stackDepth: ws.snapshot().stackDepth,
          status: ws.getStatus(),
          canCommit: ws.canCommit(),
        },
      };
    },
  };
}

const INSPECT_WORKSPACE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export function createInspectWorkspaceTool(): AgentTool<
  Record<string, never>,
  WorkspaceProjection,
  WorkspaceToolContext
> {
  return {
    name: "inspectWorkspace",
    description:
      "Return a compact projection of the current workspace: stack summary (per-op kind/target/result), status (clean/broken), last diagnostics, last changed targets, and whether commitWorkspace would succeed. Call this if you need to remember what you have already applied.",
    jsonSchema: INSPECT_WORKSPACE_SCHEMA,
    run: async (_input, ctx) => {
      const ws = ctx.getWorkspace();
      if (ws === null) return noWorkspace();
      return { ok: true, output: ws.snapshot() };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// commitWorkspace — finalize source-change proposals
// ─────────────────────────────────────────────────────────────────────

const COMMIT_WORKSPACE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: {
      type: "string",
      description: "Short title for the proposed change (shown in ProposalPreview).",
    },
    rationale: {
      type: "string",
      description: "Why this set of edits accomplishes the user's request.",
    },
  },
};

export type CommitWorkspaceOutput = {
  readonly committed: true;
  readonly proposalId: string;
  readonly status: AgentProposal["status"];
  readonly diagnosticCount: number;
  readonly schemaHash: string | null;
  readonly stackDepth: number;
  readonly summary: string;
};

export function createCommitWorkspaceTool(): AgentTool<
  { readonly title: string; readonly rationale?: string },
  CommitWorkspaceOutput,
  CommitWorkspaceContext
> {
  return {
    name: "commitWorkspace",
    description:
      "Finalize all applied workspace ops into a single MEL source-change proposal. Requires the workspace to be clean (current source compiles). Studio shadow-verifies the result and renders a diff for the user to Accept/Reject.",
    jsonSchema: COMMIT_WORKSPACE_SCHEMA,
    run: async (input, ctx) => runCommitWorkspace(input, ctx),
  };
}

export async function runCommitWorkspace(
  input: { readonly title: string; readonly rationale?: string },
  ctx: CommitWorkspaceContext,
): Promise<ToolRunResult<CommitWorkspaceOutput>> {
  const ws = ctx.getWorkspace();
  if (ws === null) return noWorkspace();
  if (typeof input?.title !== "string" || input.title.trim() === "") {
    return invalid("commitWorkspace requires a non-empty `title`.");
  }
  if (!ws.canCommit()) {
    return {
      ok: false,
      kind: "runtime_error",
      message:
        "Workspace is not committable: either the stack is empty or the current source does not compile. Use inspectWorkspace to see diagnostics, then fix or popLastOp.",
    };
  }
  const draft = ws.toFinalDraft({
    title: input.title,
    rationale: input.rationale,
  });
  const originalSource = ctx.getOriginalSource();
  if (draft.proposedSource === originalSource) {
    return invalid(
      "Workspace produced source identical to the original. Nothing to propose.",
    );
  }
  const verification = await ctx.verify(draft.proposedSource);
  const proposal = createAgentProposal({
    originalSource,
    proposedSource: draft.proposedSource,
    title: draft.title,
    rationale: draft.rationale,
    verification,
  });
  ctx.setProposal(proposal);
  const summary =
    proposal.status === "verified"
      ? `Committed ${draft.stackDepth} op(s). Proposal ready for review.`
      : `Committed ${draft.stackDepth} op(s) but verifier reported ${proposal.diagnostics.length} diagnostic(s).`;
  return {
    ok: true,
    output: {
      committed: true,
      proposalId: proposal.id,
      status: proposal.status,
      diagnosticCount: proposal.diagnostics.length,
      schemaHash: proposal.schemaHash,
      stackDepth: draft.stackDepth,
      summary,
    },
  };
}
