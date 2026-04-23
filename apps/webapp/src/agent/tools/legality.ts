/**
 * `legalityInspect` — the first deterministic tool surfaced to the
 * LLM. Wraps the StudioCore legality surface (`isActionAvailable`,
 * `createIntent`, `explainIntent`, `whyNot`) into a single, JSON-shaped
 * answer the model can cite.
 *
 * Why wrap at all (vs. letting the model call each SDK method)?
 *   1. LLMs struggle to sequence a 4-step contract correctly every
 *      turn — one tool call per question is cheaper and more reliable.
 *   2. We can absorb the five distinct failure modes (action missing,
 *      createIntent throws on arg-shape, action unavailable, inputs
 *      invalid, guard blocks) into one uniform result shape.
 *   3. `whyNot` returns the raw `ExprNode` AST; the orchestrator can't
 *      ship AST to the model usefully, so this tool pretty-prints each
 *      blocker into a short string + keeps the structured evaluatedResult.
 *
 * Import boundary: this module must remain React-free — see
 * `../__tests__/import-boundaries.test.ts`.
 */
import type { AgentTool, ToolRunResult } from "./types.js";

/**
 * The StudioCore slice this tool needs. Each caller (real core, test
 * stub) provides its own object. We redeclare the methods with narrow
 * types so we don't pull in the SDK's generic type parameters — the
 * orchestrator deals in JSON-shaped values, and this tool only ever
 * reads back fields that survive `JSON.stringify`.
 */
export type LegalityContext = {
  readonly isActionAvailable: (name: string) => boolean;
  readonly createIntent: (action: string, ...args: unknown[]) => unknown;
  readonly explainIntent: (intent: unknown) => IntentExplanationLike;
  readonly whyNot: (intent: unknown) => readonly BlockerLike[] | null;
  /**
   * Optional: list known action names so we can reject the call with
   * a precise "unknown action" error instead of propagating whatever
   * `createIntent` throws. Real cores expose this via
   * `getModule()?.schema.actions` — see `./legality.test.ts`.
   */
  readonly listActionNames?: () => readonly string[];
};

export type BlockerLike = {
  readonly layer: "available" | "dispatchable";
  readonly expression: ExprNodeLike;
  readonly evaluatedResult: unknown;
  readonly description?: string;
};

export type IntentExplanationLike =
  | {
      readonly kind: "blocked";
      readonly available: boolean;
      readonly dispatchable: false;
      readonly blockers: readonly BlockerLike[];
    }
  | {
      readonly kind: "admitted";
      readonly available: true;
      readonly dispatchable: true;
    };

/**
 * Minimal ExprNode shape — we only read `kind` and the handful of
 * fields the pretty-printer below walks. Anything not recognised is
 * rendered as `<kind>(...)` with a stringified evaluated result.
 */
export type ExprNodeLike = {
  readonly kind: string;
  readonly [field: string]: unknown;
};

export type LegalityInput = {
  readonly action: string;
  readonly args?: readonly unknown[];
};

/**
 * Result of a legality inspection. Layer semantics match the ladder
 * UX (`InteractionEditor/ladder-state.ts`):
 *   - `available`  — the action's `available when` guard passes.
 *   - `inputValid` — `createIntent(action, ...args)` did not throw.
 *   - `dispatchable` — the `dispatchable when` guard passes.
 * The LLM can reason about which rung failed without us re-encoding
 * the three-layer distinction into a free-text `reason`.
 */
export type LegalityOutput = {
  readonly action: string;
  readonly available: boolean;
  readonly inputValid: boolean;
  readonly dispatchable: boolean;
  readonly blockers: readonly LegalityBlocker[];
  /**
   * Human-readable summary the LLM can quote directly. Derived from
   * the rung that failed first — the model rarely needs more detail,
   * but the structured fields above are still there if it does.
   */
  readonly summary: string;
};

export type LegalityBlocker = {
  readonly layer: "available" | "dispatchable";
  /** Short pretty-print of the guard expression, e.g. `value > 0`. */
  readonly expression: string;
  /** Guard expression kind — useful when the pretty-print is `<kind>(...)`. */
  readonly expressionKind: string;
  readonly evaluatedResult: unknown;
  readonly description?: string;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      description: "The action name exactly as declared in the MEL module.",
    },
    args: {
      type: "array",
      description:
        "Positional arguments to pass to `createIntent`. Omit or pass [] when the action has no input. Each item should be a JSON value matching the action's input schema.",
      items: {},
    },
  },
};

export function createLegalityTool(): AgentTool<
  LegalityInput,
  LegalityOutput,
  LegalityContext
> {
  return {
    name: "explainLegality",
    description:
      "Explain why a specific action is or isn't dispatchable on the current snapshot. Returns a three-layer verdict (available, input-valid, dispatchable) and cites the failing MEL guard when blocked. Use this when the user asks \"why is X blocked?\" — the runtime already enforces legality on dispatch, so you don't need to call this before `dispatch`.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runLegality(input, ctx),
  };
}

export async function runLegality(
  input: LegalityInput,
  ctx: LegalityContext,
): Promise<ToolRunResult<LegalityOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.action !== "string" ||
    input.action === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message:
        "explainLegality requires `action: string` — received " +
        safeStringify(input),
    };
  }
  const action = input.action;
  const args = Array.isArray(input.args) ? input.args : [];

  const known = ctx.listActionNames?.();
  if (known !== undefined && !known.includes(action)) {
    return {
      ok: false,
      kind: "invalid_input",
      message: `Unknown action "${action}". Known actions: ${
        known.length === 0 ? "(none)" : known.join(", ")
      }.`,
    };
  }

  const available = safeBool(() => ctx.isActionAvailable(action));

  // Input validity is inferred from `createIntent` not throwing. The
  // SDK raises on arg-count mismatch and on input-schema violations,
  // so the catch block below distinguishes "the shape was wrong" from
  // "the action was rejected by a guard" — the LLM needs both signals.
  let intent: unknown;
  try {
    intent = ctx.createIntent(action, ...args);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : safeStringify(err);
    return {
      ok: true,
      output: {
        action,
        available,
        inputValid: false,
        dispatchable: false,
        blockers: [],
        summary: `inputs invalid: ${message}`,
      },
    };
  }

  const explanation = safeExplain(() => ctx.explainIntent(intent));
  const blockerList = safeWhyNot(() => ctx.whyNot(intent)) ?? [];
  const blockers: readonly LegalityBlocker[] = blockerList.map((b) => ({
    layer: b.layer,
    expression: renderExpr(b.expression),
    expressionKind: b.expression?.kind ?? "unknown",
    evaluatedResult: normaliseJsonValue(b.evaluatedResult),
    description: b.description,
  }));

  const dispatchable = explanation?.kind === "admitted";
  const output: LegalityOutput = {
    action,
    available: explanation?.available ?? available,
    inputValid: true,
    dispatchable,
    blockers,
    summary: summarise(action, available, dispatchable, blockers),
  };
  return { ok: true, output };
}

function summarise(
  action: string,
  available: boolean,
  dispatchable: boolean,
  blockers: readonly LegalityBlocker[],
): string {
  if (dispatchable) return `${action} is dispatchable.`;
  if (!available) {
    const b = blockers.find((x) => x.layer === "available");
    return b !== undefined
      ? `${action} is unavailable — guard "${b.expression}" evaluated to ${safeStringify(b.evaluatedResult)}.`
      : `${action} is unavailable on the current snapshot.`;
  }
  const b = blockers.find((x) => x.layer === "dispatchable");
  return b !== undefined
    ? `${action} is available but not dispatchable — guard "${b.expression}" evaluated to ${safeStringify(b.evaluatedResult)}.`
    : `${action} is available but not dispatchable on the current snapshot.`;
}

// --- ExprNode pretty-printer ----------------------------------------
//
// We keep this deliberately small. The goal is readability for an LLM
// skimming a short message, not a round-trippable MEL printer. Unknown
// kinds degrade to `kind(arg1, arg2)` rather than throwing.

const BINARY_INFIX: Readonly<Record<string, string>> = {
  eq: "==",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  add: "+",
  sub: "-",
  mul: "*",
  div: "/",
  mod: "%",
};

const UNARY_PREFIX: Readonly<Record<string, string>> = {
  not: "!",
  neg: "-",
};

export function renderExpr(node: ExprNodeLike | undefined): string {
  if (node === undefined || node === null) return "?";
  const k = node.kind;
  if (k === "lit") return safeStringify(node.value);
  if (k === "get") return String(node.path ?? "?");
  const infix = BINARY_INFIX[k];
  if (infix !== undefined && "left" in node && "right" in node) {
    return `${renderExpr(node.left as ExprNodeLike)} ${infix} ${renderExpr(
      node.right as ExprNodeLike,
    )}`;
  }
  const prefix = UNARY_PREFIX[k];
  if (prefix !== undefined && "arg" in node) {
    return `${prefix}${renderExpr(node.arg as ExprNodeLike)}`;
  }
  if ((k === "and" || k === "or") && Array.isArray(node.args)) {
    const op = k === "and" ? " && " : " || ";
    return `(${(node.args as ExprNodeLike[]).map(renderExpr).join(op)})`;
  }
  if (k === "if" && "cond" in node && "then" in node && "else" in node) {
    return `${renderExpr(node.cond as ExprNodeLike)} ? ${renderExpr(
      node.then as ExprNodeLike,
    )} : ${renderExpr(node.else as ExprNodeLike)}`;
  }
  // Generic fallback: emit `kind(child1, child2, ...)` by walking any
  // child fields that look like ExprNodeLike or arrays of them.
  const parts: string[] = [];
  for (const [key, val] of Object.entries(node)) {
    if (key === "kind") continue;
    if (isExprNode(val)) parts.push(renderExpr(val));
    else if (Array.isArray(val) && val.every(isExprNode)) {
      parts.push(val.map(renderExpr).join(", "));
    }
  }
  return parts.length === 0 ? `${k}(…)` : `${k}(${parts.join(", ")})`;
}

function isExprNode(v: unknown): v is ExprNodeLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { kind?: unknown }).kind === "string"
  );
}

// --- Small helpers --------------------------------------------------

function safeBool(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

function safeExplain(
  fn: () => IntentExplanationLike,
): IntentExplanationLike | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function safeWhyNot(
  fn: () => readonly BlockerLike[] | null,
): readonly BlockerLike[] | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * The tool output travels to the LLM as JSON. `evaluatedResult` may
 * carry non-serialisable values (undefined, Infinity, NaN). We coerce
 * those to stable strings so JSON.stringify doesn't silently lose
 * information (undefined → missing key, NaN → null).
 */
function normaliseJsonValue(v: unknown): unknown {
  if (v === undefined) return "<undefined>";
  if (typeof v === "number" && !Number.isFinite(v)) return String(v);
  if (typeof v === "bigint") return v.toString();
  return v;
}
