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
import { useState, type CSSProperties } from "react";
import type { DispatchBlocker } from "@manifesto-ai/studio-core";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import type { LadderState, LadderStep } from "./ladder-state.js";
import { firstProvableHint } from "./counterfactual.js";

export type IntentLadderProps = {
  readonly state: LadderState;
};

export function IntentLadder({ state }: IntentLadderProps): JSX.Element {
  const allPassed = state.steps.every((s) => s.status === "passed");
  const [expanded, setExpanded] = useState(false);
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
        {state.steps.map((step, i) => (
          <LadderRow
            key={step.id}
            step={step}
            isLast={i === state.steps.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

function LadderRow({
  step,
  isLast,
}: {
  readonly step: LadderStep;
  readonly isLast: boolean;
}): JSX.Element {
  const tone = toneFor(step.status);
  const demoted = step.status === "not-yet-evaluated";
  const hint = step.status === "blocked-here" ? firstProvableHint(step.blockers) : null;
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
        </div>
        {step.narrative !== undefined ? (
          <div style={narrativeStyle}>{step.narrative}</div>
        ) : null}
        {step.blockers !== undefined && step.blockers.length > 0 ? (
          <BlockerListInline blockers={step.blockers} layer={step.id} />
        ) : null}
        {hint !== null ? (
          <div style={hintStyle} data-testid={`ladder-hint-${step.id}`}>
            <span style={hintLabelStyle}>정적 증명 가능</span>
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
}: {
  readonly blockers: readonly DispatchBlocker[];
  readonly layer: string;
}): JSX.Element {
  return (
    <ul style={blockerListStyle} data-testid={`ladder-blockers-${layer}`}>
      {blockers.map((b, i) => (
        <li key={i} style={blockerRowStyle}>
          {b.description !== undefined ? (
            <div style={blockerDescStyle}>{b.description}</div>
          ) : null}
          <code style={blockerExprStyle}>{summarizeExpr(b.expression)}</code>
          <div style={blockerEvaluatedStyle}>
            평가 결과 →{" "}
            <code style={{ color: COLORS.err }}>{summarizeValue(b.evaluatedResult)}</code>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- presentation helpers ---------------------------------------------

type Tone = { readonly bg: string; readonly border: string; readonly text: string; readonly label: string };

function toneFor(status: LadderStep["status"]): Tone {
  switch (status) {
    case "passed":
      return { bg: `${COLORS.action}14`, border: `${COLORS.action}88`, text: COLORS.action, label: COLORS.action };
    case "blocked-here":
      return { bg: `${COLORS.err}18`, border: `${COLORS.err}aa`, text: COLORS.err, label: COLORS.err };
    case "not-yet-evaluated":
    default:
      return { bg: "transparent", border: `${COLORS.line}55`, text: COLORS.muted, label: COLORS.muted };
  }
}

function statusLabel(status: LadderStep["status"]): string {
  switch (status) {
    case "passed": return "통과";
    case "blocked-here": return "차단됨";
    case "not-yet-evaluated": return "대기";
  }
}

/**
 * Light-weight expression pretty-printer. Mirrors BlockerList's
 * `summarizeExpr` so we stay consistent. Intentionally does NOT pull
 * in the full compiler printer — this is a UI summary, not a
 * roundtrippable formatter.
 */
function summarizeExpr(expr: unknown): string {
  if (expr === null || typeof expr !== "object") return String(expr);
  const node = expr as {
    kind?: string; op?: string; ref?: unknown; value?: unknown;
    args?: unknown[]; left?: unknown; right?: unknown; path?: unknown;
  };
  if (typeof node.kind !== "string") return "(expr)";
  switch (node.kind) {
    case "literal":
      return summarizeValue(node.value);
    case "ref":
    case "state_ref":
    case "computed_ref":
    case "var_ref":
      return typeof node.ref === "string"
        ? node.ref
        : Array.isArray(node.path)
          ? node.path.map(String).join(".")
          : node.kind;
    case "call": {
      const fn = typeof node.op === "string" ? node.op : "call";
      const args = Array.isArray(node.args)
        ? node.args.map(summarizeExpr).join(", ")
        : "";
      return `${fn}(${args})`;
    }
    case "binary":
    case "binop":
      return `${summarizeExpr(node.left)} ${String(node.op ?? "?")} ${summarizeExpr(node.right)}`;
    default:
      return node.op !== undefined ? `${node.kind}:${node.op}` : node.kind;
  }
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
  fontSize: 10.5,
  color: COLORS.textDim,
  background: COLORS.bg,
  padding: "1px 5px",
  borderRadius: 3,
  alignSelf: "flex-start",
};

const blockerEvaluatedStyle: CSSProperties = {
  fontSize: 10,
  color: COLORS.muted,
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
