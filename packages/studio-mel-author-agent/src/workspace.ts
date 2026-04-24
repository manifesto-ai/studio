import {
  createStudioCore,
  type BuildResult,
  type EditorAdapter,
  type Intent,
  type Listener,
  type Marker,
  type StudioCore,
  type Unsubscribe,
} from "@manifesto-ai/studio-core";
import type {
  MelAuthorBlockerSummary,
  MelAuthorBuildOutput,
  MelAuthorDiagnostic,
  MelAuthorExplanationOutput,
  MelAuthorFinalDraft,
  MelAuthorFinalizeInput,
  MelAuthorGraphOutput,
  MelAuthorIntentInput,
  MelAuthorIntentOutput,
  MelAuthorLocateOutput,
  MelAuthorMutationOutput,
  MelAuthorPatchInput,
  MelAuthorRequirementSummary,
  MelAuthorSourceOutput,
  MelAuthorToolRunResult,
  MelAuthorWhyNotOutput,
  MelAuthorWorkspace,
  MelAuthorWorkspaceOptions,
} from "./types.js";

const DEFAULT_NODE_LIMIT = 80;
const DEFAULT_EDGE_LIMIT = 120;
const REQUIREMENT_CAP = 8;

export function createMelAuthorWorkspace(
  options: MelAuthorWorkspaceOptions,
): MelAuthorWorkspace {
  const adapter = createMemoryAdapter(options.source);
  const core = createStudioCore({
    effects: options.effects,
    traceBufferSize: options.traceBufferSize,
  });
  core.attach(adapter);

  let version = 0;
  let lastSuccessfulBuildVersion = -1;
  let lastBuild: MelAuthorBuildOutput | null = null;

  function currentSource(): string {
    return adapter.getSource();
  }

  function markMutated(): void {
    version += 1;
    lastBuild = null;
  }

  function readSource(): MelAuthorSourceOutput {
    return sourceOutput(currentSource(), version);
  }

  function replaceSource(
    nextSource: string,
  ): MelAuthorToolRunResult<MelAuthorMutationOutput> {
    if (typeof nextSource !== "string") {
      return {
        ok: false,
        kind: "invalid_input",
        message: "replaceSource requires a string source.",
      };
    }
    const previous = currentSource();
    const changed = previous !== nextSource;
    if (changed) {
      adapter.setSource(nextSource);
      markMutated();
    }
    return {
      ok: true,
      output: {
        changed,
        ...sourceSize(currentSource()),
        version,
        summary: changed
          ? "workspace source replaced"
          : "workspace source was unchanged",
      },
    };
  }

  function patchSource(
    patch: MelAuthorPatchInput,
  ): MelAuthorToolRunResult<MelAuthorMutationOutput> {
    const validation = validatePatch(patch);
    if (validation !== null) return validation;
    const source = currentSource();
    const start = offsetAtPoint(source, patch.startLine, patch.startColumn);
    const end = offsetAtPoint(source, patch.endLine, patch.endColumn);
    if (start === null || end === null) {
      return {
        ok: false,
        kind: "invalid_input",
        message:
          "patchSource line/column is outside the current workspace source.",
      };
    }
    if (end < start) {
      return {
        ok: false,
        kind: "invalid_input",
        message: "patchSource end must be after start.",
      };
    }
    const next = source.slice(0, start) + patch.replacement + source.slice(end);
    return replaceSource(next);
  }

  async function build(): Promise<MelAuthorBuildOutput> {
    const result = await core.build();
    const output = buildOutputFromResult(result);
    lastBuild = output;
    if (output.status === "ok") {
      lastSuccessfulBuildVersion = version;
    }
    return output;
  }

  function requireCurrentRuntime(
    operation: string,
  ): MelAuthorToolRunResult<{ readonly core: StudioCore }> {
    if (
      lastBuild === null ||
      lastBuild.status !== "ok" ||
      lastSuccessfulBuildVersion !== version
    ) {
      return {
        ok: false,
        kind: "runtime_error",
        message: `${operation} requires a successful build of the current workspace source.`,
      };
    }
    return { ok: true, output: { core } };
  }

  function inspectGraph(options?: {
    readonly nodeLimit?: number;
    readonly edgeLimit?: number;
  }): MelAuthorToolRunResult<MelAuthorGraphOutput> {
    const runtime = requireCurrentRuntime("inspectGraph");
    if (!runtime.ok) return runtime;
    const module = core.getModule();
    if (module === null) {
      return {
        ok: false,
        kind: "runtime_error",
        message: "No compiled MEL module is available.",
      };
    }
    const nodeLimit = clampLimit(options?.nodeLimit, DEFAULT_NODE_LIMIT);
    const edgeLimit = clampLimit(options?.edgeLimit, DEFAULT_EDGE_LIMIT);
    const nodes = module.graph.nodes ?? [];
    const edges = module.graph.edges ?? [];
    return {
      ok: true,
      output: {
        schemaHash: module.schema.hash,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodes: nodes.slice(0, nodeLimit).map(normalizeJsonValue),
        edges: edges.slice(0, edgeLimit).map(normalizeJsonValue),
        truncated: nodes.length > nodeLimit || edges.length > edgeLimit,
      },
    };
  }

  function locateDeclaration(
    target: string,
  ): MelAuthorToolRunResult<MelAuthorLocateOutput> {
    const runtime = requireCurrentRuntime("locateDeclaration");
    if (!runtime.ok) return runtime;
    if (typeof target !== "string" || target.trim() === "") {
      return {
        ok: false,
        kind: "invalid_input",
        message: "locateDeclaration requires a non-empty target string.",
      };
    }
    const module = core.getModule();
    if (module === null) {
      return {
        ok: false,
        kind: "runtime_error",
        message: "No compiled MEL module is available.",
      };
    }
    const normalizedTarget = target.trim();
    const localKey = normalizeLocalKey(normalizedTarget);
    const entry =
      module.sourceMap.entries[
        localKey as keyof typeof module.sourceMap.entries
      ];
    if (entry === undefined) {
      return {
        ok: false,
        kind: "invalid_input",
        message: `No source-map entry for "${normalizedTarget}" (normalized "${localKey}").`,
      };
    }
    return {
      ok: true,
      output: {
        target: normalizedTarget,
        localKey,
        schemaHash: module.schema.hash,
        span: entry.span,
        preview: previewSpan(currentSource(), entry.span),
      },
    };
  }

  function createIntentResult(
    input: MelAuthorIntentInput,
  ): MelAuthorToolRunResult<{ readonly action: string; readonly intent: Intent }> {
    const runtime = requireCurrentRuntime("intent operation");
    if (!runtime.ok) return runtime;
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.action !== "string" ||
      input.action.trim() === ""
    ) {
      return {
        ok: false,
        kind: "invalid_input",
        message: "intent operation requires { action: string, args?: unknown[] }.",
      };
    }
    const action = input.action.trim();
    const args = Array.isArray(input.args) ? input.args : [];
    const known = listActionNames(core);
    if (!known.includes(action)) {
      return {
        ok: false,
        kind: "invalid_input",
        message: `Unknown action "${action}". Known: ${known.length === 0 ? "(none)" : known.join(", ")}.`,
      };
    }
    try {
      return {
        ok: true,
        output: { action, intent: core.createIntent(action, ...args) },
      };
    } catch (err) {
      return {
        ok: false,
        kind: "invalid_input",
        message: `createIntent("${action}", ...) failed: ${stringifyError(err)}`,
      };
    }
  }

  function simulate(
    input: MelAuthorIntentInput,
  ): MelAuthorToolRunResult<MelAuthorIntentOutput> {
    const intentResult = createIntentResult(input);
    if (!intentResult.ok) return intentResult;
    const { action, intent } = intentResult.output;
    let explanation: IntentExplanationLike;
    try {
      explanation = core.explainIntent(intent) as IntentExplanationLike;
    } catch (err) {
      return {
        ok: false,
        kind: "runtime_error",
        message: `explainIntent failed: ${stringifyError(err)}`,
      };
    }
    if (explanation.kind === "blocked") {
      const blockers = (explanation.blockers ?? []).map(summarizeBlocker);
      return {
        ok: true,
        output: {
          action,
          status: "blocked",
          available: explanation.available,
          dispatchable: false,
          changedPaths: [],
          newAvailableActions: [],
          requirementCount: 0,
          requirements: [],
          blockers,
          schemaHash: null,
          summary:
            blockers.length === 0
              ? `${action} is blocked; no simulation was run.`
              : `${action} is blocked by ${blockers.map((b) => b.layer).join(", ")} guard(s); no simulation was run.`,
        },
      };
    }
    let simulated: SimulateResultLike;
    try {
      simulated = core.simulate(intent) as SimulateResultLike;
    } catch (err) {
      return {
        ok: false,
        kind: "runtime_error",
        message: `simulate failed: ${stringifyError(err)}`,
      };
    }
    const changedPaths = simulated.changedPaths ?? explanation.changedPaths ?? [];
    const requirements = simulated.requirements ?? explanation.requirements ?? [];
    const newAvailableActions =
      simulated.newAvailableActions ?? explanation.newAvailableActions ?? [];
    return {
      ok: true,
      output: {
        action,
        status: "simulated",
        available: true,
        dispatchable: true,
        changedPaths,
        newAvailableActions: newAvailableActions.map(String),
        requirementCount: requirements.length,
        requirements: requirements.slice(0, REQUIREMENT_CAP).map(summarizeRequirement),
        blockers: [],
        schemaHash: simulated.meta?.schemaHash ?? null,
        summary:
          changedPaths.length === 0
            ? `${action} simulated without projected snapshot changes.`
            : `${action} simulated. Changed paths: ${changedPaths.join(", ")}.`,
      },
    };
  }

  function why(
    input: MelAuthorIntentInput,
  ): MelAuthorToolRunResult<MelAuthorExplanationOutput> {
    const intentResult = createIntentResult(input);
    if (!intentResult.ok) return intentResult;
    try {
      return {
        ok: true,
        output: {
          action: intentResult.output.action,
          explanation: normalizeJsonValue(core.why(intentResult.output.intent)),
        },
      };
    } catch (err) {
      return {
        ok: false,
        kind: "runtime_error",
        message: `why failed: ${stringifyError(err)}`,
      };
    }
  }

  function whyNot(
    input: MelAuthorIntentInput,
  ): MelAuthorToolRunResult<MelAuthorWhyNotOutput> {
    const intentResult = createIntentResult(input);
    if (!intentResult.ok) return intentResult;
    try {
      return {
        ok: true,
        output: {
          action: intentResult.output.action,
          blockers: normalizeJsonValue(core.whyNot(intentResult.output.intent)) as
            | readonly unknown[]
            | null,
        },
      };
    } catch (err) {
      return {
        ok: false,
        kind: "runtime_error",
        message: `whyNot failed: ${stringifyError(err)}`,
      };
    }
  }

  async function finalize(
    input?: MelAuthorFinalizeInput,
  ): Promise<MelAuthorToolRunResult<MelAuthorFinalDraft>> {
    const buildResult = await build();
    const status = buildResult.status === "ok" ? "verified" : "invalid";
    const title = normalizeText(input?.title, "MEL author draft");
    const rationale = normalizeText(input?.rationale, buildResult.summary);
    return {
      ok: true,
      output: {
        title,
        rationale,
        proposedSource: currentSource(),
        status,
        diagnostics: buildResult.diagnostics,
        schemaHash: buildResult.schemaHash,
        summary: buildResult.summary,
      },
    };
  }

  return {
    getSource: currentSource,
    readSource,
    replaceSource,
    patchSource,
    build,
    inspectGraph,
    locateDeclaration,
    simulate,
    why,
    whyNot,
    finalize,
  };
}

type IntentExplanationLike =
  | {
      readonly kind: "blocked";
      readonly available: boolean;
      readonly dispatchable: false;
      readonly blockers?: readonly BlockerLike[];
    }
  | {
      readonly kind: "admitted";
      readonly available: true;
      readonly dispatchable: true;
      readonly changedPaths?: readonly string[];
      readonly newAvailableActions?: readonly unknown[];
      readonly requirements?: readonly unknown[];
    };

type BlockerLike = {
  readonly layer?: string;
  readonly description?: string;
  readonly evaluatedResult?: unknown;
};

type SimulateResultLike = {
  readonly changedPaths?: readonly string[];
  readonly newAvailableActions?: readonly unknown[];
  readonly requirements?: readonly unknown[];
  readonly meta?: { readonly schemaHash?: string };
};

function buildOutputFromResult(result: BuildResult): MelAuthorBuildOutput {
  if (result.kind === "ok") {
    const actionNames = Object.keys(result.module.schema.actions ?? {});
    const stateFieldNames = Object.keys(result.module.schema.state.fields ?? {});
    const computedNames = Object.keys(
      result.module.schema.computed?.fields ?? {},
    );
    const diagnostics = result.warnings.map(markerToDiagnostic);
    return {
      status: "ok",
      schemaHash: result.schemaHash,
      diagnostics,
      errorCount: 0,
      warningCount: diagnostics.length,
      actionNames,
      stateFieldNames,
      computedNames,
      summary:
        diagnostics.length === 0
          ? "workspace source builds cleanly"
          : `workspace source builds with ${diagnostics.length} warning${diagnostics.length === 1 ? "" : "s"}`,
    };
  }
  const diagnostics = [...result.errors, ...result.warnings].map(
    markerToDiagnostic,
  );
  return {
    status: "fail",
    schemaHash: null,
    diagnostics,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    actionNames: [],
    stateFieldNames: [],
    computedNames: [],
    summary: `workspace source failed to build with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`,
  };
}

function markerToDiagnostic(marker: Marker): MelAuthorDiagnostic {
  return {
    severity: marker.severity,
    message: marker.message,
    line: marker.span.start.line,
    column: marker.span.start.column,
    code: marker.code,
  };
}

function listActionNames(core: StudioCore): readonly string[] {
  const actions = core.getModule()?.schema.actions;
  return actions !== undefined ? Object.keys(actions) : [];
}

function summarizeBlocker(blocker: BlockerLike): MelAuthorBlockerSummary {
  return {
    layer: typeof blocker.layer === "string" ? blocker.layer : "unknown",
    description: blocker.description,
    evaluatedResult: normalizeJsonValue(blocker.evaluatedResult),
  };
}

function summarizeRequirement(req: unknown): MelAuthorRequirementSummary {
  if (req === null || typeof req !== "object") return {};
  const record = req as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    type: typeof record.type === "string" ? record.type : undefined,
  };
}

function sourceOutput(source: string, version: number): MelAuthorSourceOutput {
  return {
    source,
    ...sourceSize(source),
    version,
  };
}

function sourceSize(
  source: string,
): { readonly length: number; readonly lineCount: number } {
  return {
    length: source.length,
    lineCount: source === "" ? 0 : source.split(/\r?\n/).length,
  };
}

function validatePatch(
  patch: MelAuthorPatchInput,
): MelAuthorToolRunResult<MelAuthorMutationOutput> | null {
  if (typeof patch !== "object" || patch === null) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "patchSource requires an object input.",
    };
  }
  for (const key of ["startLine", "startColumn", "endLine", "endColumn"] as const) {
    if (!Number.isInteger(patch[key]) || patch[key] < 1) {
      return {
        ok: false,
        kind: "invalid_input",
        message: `patchSource ${key} must be a 1-based positive integer.`,
      };
    }
  }
  if (typeof patch.replacement !== "string") {
    return {
      ok: false,
      kind: "invalid_input",
      message: "patchSource replacement must be a string.",
    };
  }
  return null;
}

function offsetAtPoint(
  source: string,
  line: number,
  column: number,
): number | null {
  if (line < 1 || column < 1) return null;
  let currentLine = 1;
  let currentColumn = 1;
  for (let i = 0; i < source.length; i++) {
    if (currentLine === line && currentColumn === column) return i;
    if (source[i] === "\n") {
      currentLine += 1;
      currentColumn = 1;
    } else {
      currentColumn += 1;
    }
  }
  if (currentLine === line && currentColumn === column) return source.length;
  return null;
}

function normalizeLocalKey(target: string): string {
  if (target.startsWith("state:")) {
    return `state_field:${target.slice("state:".length)}`;
  }
  return target;
}

function previewSpan(
  source: string,
  span: { readonly start: { readonly line: number }; readonly end: { readonly line: number } },
): string {
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, span.start.line);
  const end = Math.max(start, span.end.line);
  const windowStart = Math.max(1, start - 1);
  const windowEnd = Math.min(lines.length, end + 1);
  const rendered: string[] = [];
  for (let lineNo = windowStart; lineNo <= windowEnd; lineNo++) {
    const raw = lines[lineNo - 1] ?? "";
    rendered.push(`${lineNo}: ${raw}`);
  }
  const preview = rendered.join("\n");
  return preview.length <= 1000 ? preview : `${preview.slice(0, 999)}...`;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function normalizeText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? fallback : trimmed;
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createMemoryAdapter(initialSource: string): EditorAdapter {
  let source = initialSource;
  let markers: readonly Marker[] = [];
  const listeners = new Set<Listener>();
  void markers;
  return {
    getSource: () => source,
    setSource: (next) => {
      source = next;
    },
    onBuildRequest: (listener): Unsubscribe => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    requestBuild: () => {
      for (const listener of listeners) listener();
    },
    setMarkers: (next) => {
      markers = next;
    },
  };
}
