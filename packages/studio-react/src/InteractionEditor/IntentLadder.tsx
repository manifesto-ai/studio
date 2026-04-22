/**
 * IntentLadder — a vertical 5-step visualization of the SDK legality
 * ladder. This is the Intent Insight block's philosophical anchor: it
 * performs the runtime's short-circuit check in the exact order
 * mandated by SDK §"Intent Explanation".
 *
 * Layers:
 *   1. available       — `available when` (input-free coarse gate)
 *   2. input-valid     — SDK input schema validation
 *   3. dispatchable    — `dispatchable when` (input-bound fine gate)
 *   4. simulated       — dry-run resolved for the current bound intent
 *   5. admitted        — outcome would be written (changedPaths ready)
 *
 * Rules enforced:
 *   L1 — blockers from different layers are NEVER mixed.
 *   L2 — `available` failure framed as "not present in the action
 *        surface", `dispatchable` failure framed as "this specific
 *        intent is rejected; action still callable with different
 *        input".
 *   L3 — `INVALID_INPUT` is surfaced at step 2 exclusively, not
 *        merged into dispatchability.
 *   P1 — counterfactual hints only from static guard-AST decoding.
 *        Undecodable → silent.
 *   Downstream layers stay visible but demoted when an earlier layer
 *   has short-circuited, so the user sees what WOULD have been
 *   checked next.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import type { DispatchBlocker } from "@manifesto-ai/studio-core";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import type { LadderState, LadderStep } from "./ladder-state.js";
import { firstProvableHint } from "./counterfactual.js";

/**
 * Optional ref resolver — given a dotted reference path that appeared
 * inside a guard expression (e.g. `count`, `input.value`,
 * `computed.todoCount`), return the actual value at that path from
 * the current snapshot/intent. When provided, the blocker renderer
 * substitutes resolved values inline next to each ref so a guard like
 * `gte(input.value, 0)` reads as `gte(-10 (input.value), 0) → false`,
 * making the failing operand obvious without flipping back to the
 * snapshot inspector. When omitted, the renderer falls back to the
 * un-substituted path form.
 */
export type RefResolver = (refPath: string) => unknown;

export type IntentLadderProps = {
  readonly state: LadderState;
  readonly resolveRef?: RefResolver;
  /**
   * Optional callback fired when the user clicks the "↗ source" link
   * shown on the failing step. Hosts wire this to their Monaco
   * reveal flow so the user lands on the action's source span and
   * can scan for the relevant `available when` / `dispatchable when`
   * line. Layer-specific guard spans aren't yet exposed by the SDK,
   * so jumping to the action block as a whole is the closest we can
   * get without a parser.
   */
  readonly onRevealSource?: () => void;
};

export function IntentLadder({
  state,
  resolveRef,
  onRevealSource,
}: IntentLadderProps): JSX.Element {
  const allPassed = state.steps.every((s) => s.status === "passed");
  const [expanded, setExpanded] = useState(false);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  // Full-pass case collapses into a single success line. The user can
  // still expand to inspect the per-step detail if they want.
  if (allPassed && !expanded) {
    return (
      <div style={collapsedRootStyle} data-testid="intent-ladder">
        <span style={collapsedDotStyle} aria-hidden />
        <span style={collapsedLabelStyle}>Legality passed</span>
        <span style={collapsedMetaStyle}>5/5 · ready to dispatch</span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={collapsedBtnStyle}
          aria-label="Expand legality ladder"
        >
          details
        </button>
      </div>
    );
  }

  // When a step is blocked, every later step is `not-yet-evaluated`.
  // Rendering all four pending rows is teaching-value-only and noisy
  // on repeat use. Collapse the trailing run of pending steps into a
  // single "▸ N more pending" toggle. `pendingHeadCount` is the count
  // of steps to render fully; the rest become a collapsed footer row.
  const pendingHeadCount = (() => {
    if (pendingExpanded) return state.steps.length;
    let count: number = state.steps.length;
    for (let i = state.steps.length - 1; i >= 0; i -= 1) {
      if (state.steps[i].status !== "not-yet-evaluated") break;
      count = i;
    }
    // Always show at least the first step.
    return Math.max(1, count);
  })();
  const pendingTailCount = state.steps.length - pendingHeadCount;

  return (
    <div style={rootStyle} data-testid="intent-ladder">
      <div style={headerStyle}>
        <span style={{ fontWeight: 600 }}>Legality Ladder</span>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <span style={{ color: COLORS.muted, fontSize: 10.5 }}>
            SDK §legality-ladder · 5 steps
          </span>
          {allPassed && expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={collapsedBtnStyle}
            >
              collapse
            </button>
          ) : null}
        </div>
      </div>
      <ol style={listStyle}>
        {state.steps.slice(0, pendingHeadCount).map((step, i) => (
          <LadderRow
            key={step.id}
            step={step}
            isLast={i === state.steps.length - 1 && pendingTailCount === 0}
            resolveRef={resolveRef}
            onRevealSource={onRevealSource}
          />
        ))}
        {pendingTailCount > 0 ? (
          <li
            style={pendingFooterStyle}
            data-testid="ladder-pending-footer"
            onClick={() => setPendingExpanded(true)}
          >
            <span style={pendingFooterChevronStyle}>▸</span>
            <span>
              {pendingTailCount} downstream layer
              {pendingTailCount === 1 ? "" : "s"} not yet evaluated
            </span>
            <span style={pendingFooterMetaStyle}>
              {state.steps
                .slice(pendingHeadCount)
                .map((s) => s.label)
                .join(" · ")}
            </span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function LadderRow({
  step,
  isLast,
  resolveRef,
  onRevealSource,
}: {
  readonly step: LadderStep;
  readonly isLast: boolean;
  readonly resolveRef?: RefResolver;
  readonly onRevealSource?: () => void;
}): JSX.Element {
  const tone = toneFor(step.status, step.id);
  const demoted = step.status === "not-yet-evaluated";
  const hint = step.status === "blocked-here" ? firstProvableHint(step.blockers) : null;
  const showSourceJump =
    step.status === "blocked-here" && onRevealSource !== undefined;
  return (
    <li
      style={rowStyle(demoted)}
      data-testid={`ladder-step-${step.id}`}
      data-status={step.status}
    >
      <div style={railColumnStyle}>
        <span style={ordinalDotStyle(tone)}>{step.ordinal}</span>
        {isLast ? null : <span style={railLineStyle(demoted)} aria-hidden />}
      </div>
      <div style={contentColumnStyle}>
        <div style={titleRowStyle}>
          <span style={{ color: tone.text, fontWeight: 600 }}>{step.label}</span>
          <span style={statusBadgeStyle(tone)} data-testid={`ladder-status-${step.id}`}>
            {statusLabel(step.status)}
          </span>
          {showSourceJump ? (
            <button
              type="button"
              onClick={onRevealSource}
              style={sourceJumpBtnStyle}
              data-testid={`ladder-source-jump-${step.id}`}
              title="Reveal action source in editor"
            >
              ↗ source
            </button>
          ) : null}
        </div>
        {step.narrative !== undefined ? (
          <div style={narrativeStyle}>{step.narrative}</div>
        ) : null}
        {step.blockers !== undefined && step.blockers.length > 0 ? (
          <BlockerListInline
            blockers={step.blockers}
            layer={step.id}
            resolveRef={resolveRef}
          />
        ) : null}
        {hint !== null ? (
          <div style={hintStyle} data-testid={`ladder-hint-${step.id}`}>
            <span style={hintLabelStyle}>Statically provable</span>
            <span style={hintTextStyle}>{hint.text}</span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function BlockerListInline({
  blockers,
  layer,
  resolveRef,
}: {
  readonly blockers: readonly DispatchBlocker[];
  readonly layer: string;
  readonly resolveRef?: RefResolver;
}): JSX.Element {
  return (
    <ul style={blockerListStyle} data-testid={`ladder-blockers-${layer}`}>
      {blockers.map((b, i) => (
        <li key={i} style={blockerRowStyle}>
          {b.description !== undefined ? (
            <div style={blockerDescStyle}>{b.description}</div>
          ) : null}
          <code style={blockerExprStyle}>
            {renderExprWithValues(b.expression, resolveRef)}
            <span style={{ color: COLORS.muted, margin: "0 6px" }}>→</span>
            <span style={{ color: COLORS.err, fontWeight: 600 }}>
              {summarizeValue(b.evaluatedResult)}
            </span>
          </code>
        </li>
      ))}
    </ul>
  );
}

// --- presentation helpers ---------------------------------------------

type Tone = { readonly bg: string; readonly border: string; readonly text: string; readonly label: string };

/**
 * Tone is severity-aware. Failures at `available` (action not on the
 * callable surface at all) and `simulated` (runtime failure inside
 * the trace) are red — the user can't "type their way out" of
 * either. Failures at `input-valid` and `dispatchable` are amber
 * because they're recoverable: the same action with a different
 * input would pass. Mixing these up was making input-bound actions
 * look as broken as truly unreachable ones.
 */
function toneFor(
  status: LadderStep["status"],
  layer: LadderStep["id"],
): Tone {
  if (status === "passed") {
    return { bg: `${COLORS.action}14`, border: `${COLORS.action}88`, text: COLORS.action, label: COLORS.action };
  }
  if (status === "blocked-here") {
    const recoverable = layer === "input-valid" || layer === "dispatchable";
    const colour = recoverable ? COLORS.warn : COLORS.err;
    return { bg: `${colour}18`, border: `${colour}aa`, text: colour, label: colour };
  }
  return { bg: "transparent", border: `${COLORS.line}55`, text: COLORS.muted, label: COLORS.muted };
}

function statusLabel(status: LadderStep["status"]): string {
  switch (status) {
    case "passed": return "passed";
    case "blocked-here": return "blocked";
    case "not-yet-evaluated": return "pending";
  }
}

/**
 * Pretty-printer that walks the guard expression AST (Manifesto core's
 * `ExprNode`) and substitutes resolved values inline next to each
 * `get` (path read) node so the failing operand is visually obvious.
 * Returns React nodes (not a string) so the value, the path
 * annotation, operators, and the call name can be styled
 * independently. When `resolveRef` is omitted, `get` nodes render as
 * the bare path.
 *
 * Example output for `gte(input.value, 0)` with `input.value = -10`:
 *
 *   -10 (input.value)  >=  0
 *   ^^^ value (state)        ^ literal (warn)
 *       ^^^^^^^^^^^^^ path annotation (muted)
 *                      ^^ operator (muted)
 *
 * The full ExprNode schema lives in @manifesto-ai/core; this renderer
 * matches its shape (kind in {"lit", "get", "eq", "gt", "and",
 * "not", "len", "field", "at", ...}) plus the older synthetic shapes
 * still used in some test fixtures (`{kind: "literal"}`, `{kind:
 * "ref"}`). Unknown kinds fall back to `kind(arg1, arg2, ...)` using
 * a generic walker over the node's child fields.
 */

/** Binary `kind` → infix operator. Both arithmetic and comparison. */
const BINARY_INFIX: Record<string, string> = {
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

/** Unary prefix operators (display: `op<arg>` with no parens). */
const UNARY_PREFIX: Record<string, string> = {
  not: "!",
  neg: "-",
};

function renderExprWithValues(
  expr: unknown,
  resolveRef: RefResolver | undefined,
): ReactNode {
  if (expr === null || typeof expr !== "object") {
    return <span>{String(expr)}</span>;
  }
  const node = expr as Record<string, unknown> & { kind?: string };
  const kind = typeof node.kind === "string" ? node.kind : null;
  if (kind === null) return <span>(expr)</span>;

  // Literal — accept both core's "lit" and the older synthetic "literal".
  if (kind === "lit" || kind === "literal") {
    return (
      <span style={literalTokenStyle}>{summarizeValue(node.value)}</span>
    );
  }

  // Path read — `get { path: "data.count" }` is the canonical form;
  // older synthetic shapes (`ref`, `state_ref`, ...) are also handled.
  if (
    kind === "get" ||
    kind === "ref" ||
    kind === "state_ref" ||
    kind === "computed_ref" ||
    kind === "var_ref"
  ) {
    const path = readRefPath(node, kind);
    if (resolveRef === undefined) {
      return <span style={refPathTokenStyle}>{path}</span>;
    }
    const value = resolveRef(path);
    const valueStr = value === undefined ? "?" : summarizeValue(value);
    return (
      <span>
        <span style={refValueTokenStyle}>{valueStr}</span>
        <span style={refAnnotationStyle}>{` (${path})`}</span>
      </span>
    );
  }

  // Binary infix: eq/neq/gt/gte/lt/lte/add/sub/mul/div/mod.
  if (
    BINARY_INFIX[kind] !== undefined &&
    node.left !== undefined &&
    node.right !== undefined
  ) {
    return (
      <span>
        {renderExprWithValues(node.left, resolveRef)}
        <span style={operatorTokenStyle}>{BINARY_INFIX[kind]}</span>
        {renderExprWithValues(node.right, resolveRef)}
      </span>
    );
  }

  // Unary prefix: !x, -x.
  if (UNARY_PREFIX[kind] !== undefined && node.arg !== undefined) {
    return (
      <span>
        <span style={callOpTokenStyle}>{UNARY_PREFIX[kind]}</span>
        {renderExprWithValues(node.arg, resolveRef)}
      </span>
    );
  }

  // Variadic logical: and/or render as `a && b && c` / `a || b || c`.
  if ((kind === "and" || kind === "or") && Array.isArray(node.args)) {
    const op = kind === "and" ? "&&" : "||";
    return (
      <span>
        {(node.args as unknown[]).map((a, i) => (
          <span key={i}>
            {i > 0 ? <span style={operatorTokenStyle}>{op}</span> : null}
            {renderExprWithValues(a, resolveRef)}
          </span>
        ))}
      </span>
    );
  }

  // Generic call form. We pick out child expressions in declaration
  // order — works for both `args: [...]` (variadic) and named-field
  // shapes (`field { object, property }`, `at { array, index }`,
  // `filter { array, predicate }`, `substring { str, start, end }`,
  // ...). Non-object values (strings, numbers) are inlined as
  // literals so `field(object, "property")` reads correctly.
  const childTokens = collectChildTokens(node, kind);
  return (
    <span>
      <span style={callOpTokenStyle}>{kind}</span>
      <span>(</span>
      {childTokens.map((tok, i) => (
        <span key={i}>
          {i > 0 ? <span>, </span> : null}
          {tok.kind === "expr" ? (
            renderExprWithValues(tok.value, resolveRef)
          ) : (
            <span style={literalTokenStyle}>
              {summarizeValue(tok.value)}
            </span>
          )}
        </span>
      ))}
      <span>)</span>
    </span>
  );
}

function readRefPath(
  node: Record<string, unknown>,
  fallbackKind: string,
): string {
  if (typeof node.path === "string") return node.path;
  if (Array.isArray(node.path)) {
    return (node.path as unknown[]).map(String).join(".");
  }
  if (typeof node.ref === "string") return node.ref;
  return fallbackKind;
}

type ChildToken =
  | { readonly kind: "expr"; readonly value: unknown }
  | { readonly kind: "literal"; readonly value: unknown };

function collectChildTokens(
  node: Record<string, unknown>,
  exprKind: string,
): readonly ChildToken[] {
  // `args: [...]` is the canonical variadic shape (and/or/concat/
  // coalesce/min/max/merge/append).
  if (Array.isArray(node.args)) {
    return (node.args as unknown[]).map((value) => ({
      kind: "expr" as const,
      value,
    }));
  }
  // Otherwise walk the node's own enumerable fields in declaration
  // order, skipping `kind`. Each value is either a sub-expression
  // (object with kind) or a literal (string property name, number
  // index, etc.). Skips arrays-of-non-exprs to avoid leaking
  // internals.
  const out: ChildToken[] = [];
  for (const [k, value] of Object.entries(node)) {
    if (k === "kind") continue;
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { kind?: unknown }).kind === "string"
    ) {
      out.push({ kind: "expr", value });
    } else {
      out.push({ kind: "literal", value });
    }
  }
  // No child tokens at all → render bare kind. Caller will see "()".
  return out.length > 0 ? out : [{ kind: "literal", value: exprKind }];
}

function summarizeValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return "(value)";
  }
}

// --- styles -----------------------------------------------------------

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "10px 12px",
  background: COLORS.panel,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  marginBottom: 4,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
};

function rowStyle(demoted: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "24px 1fr",
    gap: 8,
    padding: "6px 0",
    opacity: demoted ? 0.55 : 1,
    transition: "opacity 150ms ease",
  };
}

const pendingFooterStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "8px 0 6px 32px",
  fontSize: 11,
  color: COLORS.muted,
  cursor: "pointer",
  borderTop: `1px dashed ${COLORS.line}`,
  marginTop: 4,
};

const pendingFooterChevronStyle: CSSProperties = {
  color: COLORS.textDim,
  fontSize: 10,
};

const pendingFooterMetaStyle: CSSProperties = {
  marginLeft: "auto",
  fontFamily: MONO_STACK,
  fontSize: 10,
  color: COLORS.textDim,
  opacity: 0.7,
};

const sourceJumpBtnStyle: CSSProperties = {
  marginLeft: "auto",
  padding: "2px 7px",
  fontSize: 10,
  fontFamily: MONO_STACK,
  color: COLORS.muted,
  background: "transparent",
  border: `1px solid ${COLORS.line}`,
  borderRadius: 3,
  cursor: "pointer",
};

const railColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  minHeight: "100%",
};

function ordinalDotStyle(tone: Tone): CSSProperties {
  return {
    width: 20,
    height: 20,
    borderRadius: 10,
    background: tone.bg,
    border: `1px solid ${tone.border}`,
    color: tone.label,
    fontSize: 10,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: MONO_STACK,
    lineHeight: 1,
  };
}

function railLineStyle(demoted: boolean): CSSProperties {
  return {
    flex: 1,
    width: 1,
    background: demoted ? `${COLORS.line}55` : COLORS.line,
    marginTop: 2,
    marginBottom: -6,
    minHeight: 8,
  };
}

const contentColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  paddingBottom: 6,
};

const titleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

function statusBadgeStyle(tone: Tone): CSSProperties {
  return {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    padding: "1px 6px",
    borderRadius: 3,
    background: tone.bg,
    color: tone.label,
    border: `1px solid ${tone.border}`,
    whiteSpace: "nowrap",
  };
}

const narrativeStyle: CSSProperties = {
  fontSize: 11.5,
  color: COLORS.textDim,
  lineHeight: 1.5,
};

const blockerListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const blockerRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  paddingLeft: 6,
  borderLeft: `2px solid ${COLORS.err}66`,
};

const blockerDescStyle: CSSProperties = {
  fontSize: 11.5,
  color: COLORS.text,
};

const blockerExprStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: 11,
  color: COLORS.textDim,
  background: COLORS.bg,
  padding: "4px 8px",
  borderRadius: 4,
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "baseline",
  flexWrap: "wrap",
};

// Tokens for the value-substituted expression renderer. Colour roles
// keep adjacent tokens visually separable: the resolved value is the
// loud one (state cyan), the path annotation fades back, the operator
// and call name carry the violet brand tone so primary structure
// reads first.
const refValueTokenStyle: CSSProperties = {
  color: COLORS.state,
  fontWeight: 600,
};
const refAnnotationStyle: CSSProperties = {
  color: COLORS.muted,
  fontWeight: 400,
};
const refPathTokenStyle: CSSProperties = {
  color: COLORS.textDim,
  fontStyle: "italic",
};
const literalTokenStyle: CSSProperties = {
  color: COLORS.warn,
};
const callOpTokenStyle: CSSProperties = {
  color: COLORS.computed,
  fontWeight: 600,
};
const operatorTokenStyle: CSSProperties = {
  color: COLORS.muted,
  margin: "0 6px",
  fontWeight: 600,
};

const hintStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
  fontSize: 11,
  padding: "4px 6px",
  background: `${COLORS.accent}12`,
  border: `1px dashed ${COLORS.accent}66`,
  borderRadius: 4,
};

const hintLabelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: COLORS.accent,
};

const hintTextStyle: CSSProperties = {
  color: COLORS.text,
  fontFamily: MONO_STACK,
  fontSize: 11,
};

// Collapsed-success styles — one quiet line when all five steps pass.
const collapsedRootStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  background: `${COLORS.action}12`,
  border: `1px solid ${COLORS.action}55`,
  borderRadius: 6,
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
};

const collapsedDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 4,
  background: COLORS.action,
  boxShadow: `0 0 8px ${COLORS.action}`,
  flexShrink: 0,
};

const collapsedLabelStyle: CSSProperties = {
  fontWeight: 600,
  color: COLORS.action,
  letterSpacing: 0.2,
};

const collapsedMetaStyle: CSSProperties = {
  color: COLORS.muted,
  fontSize: 11,
  fontFamily: MONO_STACK,
};

const collapsedBtnStyle: CSSProperties = {
  marginLeft: "auto",
  padding: "2px 8px",
  borderRadius: 4,
  border: `1px solid ${COLORS.line}`,
  background: "transparent",
  color: COLORS.textDim,
  fontFamily: MONO_STACK,
  fontSize: 10.5,
  cursor: "pointer",
};
