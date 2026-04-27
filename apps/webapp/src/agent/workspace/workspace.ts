/**
 * Workspace — stacked-fragment scratch space for MEL authoring.
 *
 * The workspace is the in-memory author's scratch substrate: each
 * `apply()` call dispatches a single `MelEditOp` against the
 * compiler's `compileFragmentInContext`, keeps the resulting source
 * as the new "current" state, and records a stack entry so the
 * agent can `popLast()` to undo.
 *
 * Key contract:
 *   - The user's actual MEL editor is NEVER touched here. The
 *     workspace only holds in-memory state, even when broken.
 *   - A broken intermediate state is allowed. `currentSource` may
 *     fail to compile mid-stack; `currentModule` is `null` then.
 *   - Only a clean state can be committed (`canCommit()`).
 *   - `popLast()` restores the previous source/module snapshot
 *     atomically — no replay-from-base.
 *
 * What it deliberately does NOT do:
 *   - branching / fork / checkpoints (Phase 2)
 *   - persistence (turn ends → workspace gone)
 *   - sequence planning (caller decides which op to dispatch)
 */
import {
  compileFragmentInContext,
  type DomainModule,
  type Diagnostic,
  type LocalTargetKey,
  type MelEditOp,
  type MelEditResult,
  type SchemaDiff,
} from "@manifesto-ai/compiler";

export type WorkspaceStatus = "clean" | "broken";

export type AppliedOp = {
  readonly id: string;
  readonly op: MelEditOp;
  readonly appliedAt: number;
  readonly result: MelEditResult;
  readonly previousSource: string;
  readonly previousModule: DomainModule | null;
};

export type WorkspaceProjection = {
  readonly baseSourceLength: number;
  readonly currentSourceLength: number;
  readonly stackDepth: number;
  readonly status: WorkspaceStatus;
  readonly canCommit: boolean;
  readonly lastDiagnostics: readonly Diagnostic[];
  readonly lastChangedTargets: readonly LocalTargetKey[];
  readonly lastSchemaDiff: SchemaDiff | null;
  readonly stack: readonly AppliedOpProjection[];
};

export type AppliedOpProjection = {
  readonly id: string;
  readonly kind: MelEditOp["kind"];
  readonly target: string | null;
  readonly appliedAt: number;
  readonly resultStatus: "ok" | "broken";
  readonly diagnosticCount: number;
};

export type FinalDraft = {
  readonly proposedSource: string;
  readonly schemaHash: string | null;
  readonly title: string | undefined;
  readonly rationale: string | undefined;
  readonly stackDepth: number;
  readonly changedTargets: readonly LocalTargetKey[];
};

export type Workspace = {
  /** Apply one op against the current source. Stack always grows by 1, even when the op produces a broken module. */
  readonly apply: (op: MelEditOp) => MelEditResult;
  /** Undo the most recent apply. Returns false if the stack is empty. */
  readonly popLast: () => boolean;
  /** Read the live current source — never mutated externally. */
  readonly getCurrentSource: () => string;
  /** Read the most recently compiled module, or null if broken. */
  readonly getCurrentModule: () => DomainModule | null;
  /** Compact projection for LLM tools / UI. */
  readonly snapshot: () => WorkspaceProjection;
  /** Status sugar. */
  readonly getStatus: () => WorkspaceStatus;
  /** True when a commit would produce a verifiable proposal. */
  readonly canCommit: () => boolean;
  /** Build the final-draft payload for the proposal pipeline. Throws when not committable. */
  readonly toFinalDraft: (input?: {
    readonly title?: string;
    readonly rationale?: string;
  }) => FinalDraft;
};

export type CreateWorkspaceInput = {
  readonly baseSource: string;
  readonly baseModule?: DomainModule | null;
};

export function createWorkspace(input: CreateWorkspaceInput): Workspace {
  const baseSource = input.baseSource;
  let currentSource = baseSource;
  let currentModule: DomainModule | null = input.baseModule ?? null;
  let lastDiagnostics: readonly Diagnostic[] = [];
  let lastChangedTargets: readonly LocalTargetKey[] = [];
  let lastSchemaDiff: SchemaDiff | null = null;
  const stack: AppliedOp[] = [];

  function apply(op: MelEditOp): MelEditResult {
    const previousSource = currentSource;
    const previousModule = currentModule;
    const result = compileFragmentInContext(currentSource, op, {
      // Skip baseModule when broken — the compiler will reparse from
      // text. Passing a stale module would mislead the analyzer.
      baseModule: previousModule ?? undefined,
      includeModule: true,
      includeSchemaDiff: true,
    });
    currentSource = result.newSource;
    currentModule = result.module ?? null;
    lastDiagnostics = result.diagnostics;
    lastChangedTargets = result.changedTargets;
    lastSchemaDiff = result.schemaDiff ?? null;
    stack.push({
      id: nextOpId(),
      op,
      appliedAt: Date.now(),
      result,
      previousSource,
      previousModule,
    });
    return result;
  }

  function popLast(): boolean {
    const last = stack.pop();
    if (last === undefined) return false;
    currentSource = last.previousSource;
    currentModule = last.previousModule;
    // Diagnostics / changedTargets / schemaDiff revert to the state
    // *before* the popped op — i.e. either the previous op's result
    // or the empty initial state when the stack is now empty.
    if (stack.length === 0) {
      lastDiagnostics = [];
      lastChangedTargets = [];
      lastSchemaDiff = null;
    } else {
      const prev = stack[stack.length - 1]!;
      lastDiagnostics = prev.result.diagnostics;
      lastChangedTargets = prev.result.changedTargets;
      lastSchemaDiff = prev.result.schemaDiff ?? null;
    }
    return true;
  }

  function getStatus(): WorkspaceStatus {
    return currentModule !== null ? "clean" : "broken";
  }

  function canCommit(): boolean {
    return currentModule !== null && stack.length > 0;
  }

  function snapshot(): WorkspaceProjection {
    return {
      baseSourceLength: baseSource.length,
      currentSourceLength: currentSource.length,
      stackDepth: stack.length,
      status: getStatus(),
      canCommit: canCommit(),
      lastDiagnostics,
      lastChangedTargets,
      lastSchemaDiff,
      stack: stack.map(projectAppliedOp),
    };
  }

  function toFinalDraft(input?: {
    readonly title?: string;
    readonly rationale?: string;
  }): FinalDraft {
    if (!canCommit()) {
      throw new Error(
        "[workspace] cannot commit: current source does not compile or no ops applied",
      );
    }
    const allChanged = collectChangedTargets(stack);
    return {
      proposedSource: currentSource,
      schemaHash: currentModule?.schema.hash ?? null,
      title: input?.title,
      rationale: input?.rationale,
      stackDepth: stack.length,
      changedTargets: allChanged,
    };
  }

  return {
    apply,
    popLast,
    getCurrentSource: () => currentSource,
    getCurrentModule: () => currentModule,
    snapshot,
    getStatus,
    canCommit,
    toFinalDraft,
  };
}

function projectAppliedOp(applied: AppliedOp): AppliedOpProjection {
  return {
    id: applied.id,
    kind: applied.op.kind,
    target: extractOpTarget(applied.op),
    appliedAt: applied.appliedAt,
    resultStatus: applied.result.ok ? "ok" : "broken",
    diagnosticCount: applied.result.diagnostics.length,
  };
}

function extractOpTarget(op: MelEditOp): string | null {
  // Each op kind names its target differently. Project them to a
  // single string for compact stack rendering.
  switch (op.kind) {
    case "addType":
    case "addStateField":
    case "addComputed":
    case "addAction":
      return op.name;
    case "addAvailable":
    case "addDispatchable":
    case "replaceActionBody":
    case "replaceComputedExpr":
    case "replaceAvailable":
    case "replaceDispatchable":
    case "replaceStateDefault":
    case "replaceTypeField":
    case "removeDeclaration":
    case "renameDeclaration":
      return op.target;
    default:
      // Exhaustiveness — TS will complain if a kind is missed.
      return null;
  }
}

function collectChangedTargets(
  stack: readonly AppliedOp[],
): readonly LocalTargetKey[] {
  const seen = new Set<LocalTargetKey>();
  const ordered: LocalTargetKey[] = [];
  for (const entry of stack) {
    for (const target of entry.result.changedTargets) {
      if (seen.has(target)) continue;
      seen.add(target);
      ordered.push(target);
    }
  }
  return ordered;
}

let opCounter = 0;
function nextOpId(): string {
  opCounter += 1;
  return `op-${Date.now().toString(36)}-${opCounter.toString(36)}`;
}
