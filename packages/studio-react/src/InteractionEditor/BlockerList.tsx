import type { CSSProperties } from "react";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import type { DispatchBlocker } from "@manifesto-ai/studio-core";

export type BlockerListProps = {
  readonly blockers: readonly DispatchBlocker[];
  readonly reason?: string;
  /** When true, render nothing instead of an empty list (useful inline). */
  readonly hideWhenEmpty?: boolean;
};

/**
 * Renders the list of blockers that prevented an intent from being
 * admitted. `layer` tells users whether the gate was the action's
 * availability guard or the intent-level `dispatchable when` clause —
 * the two have different UX meaning.
 */
export function BlockerList({
  blockers,
  reason,
  hideWhenEmpty = false,
}: BlockerListProps): JSX.Element | null {
  if (blockers.length === 0 && reason === undefined) {
    return hideWhenEmpty ? null : (
      <div style={emptyStyle}>No blockers recorded.</div>
    );
  }
  return (
    <div style={rootStyle} role="status" aria-live="polite">
      <div style={headerStyle}>
        <span style={dotStyle} />
        <span>blocked</span>
        {reason !== undefined ? (
          <span style={reasonStyle}>— {reason}</span>
        ) : null}
      </div>
      {blockers.length > 0 ? (
        <ul style={listStyle}>
          {blockers.map((b, i) => (
            <li key={i} style={rowStyle}>
              <LayerBadge layer={b.layer} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                {b.description !== undefined ? (
                  <div style={descriptionStyle}>{b.description}</div>
                ) : null}
                <code style={exprStyle}>{summarizeExpr(b.expression)}</code>
                <div style={evaluatedStyle}>
                  evaluated to{" "}
                  <code style={{ color: COLORS.err }}>
                    {summarizeValue(b.evaluatedResult)}
                  </code>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LayerBadge({ layer }: { readonly layer: DispatchBlocker["layer"] }): JSX.Element {
  const color = layer === "available" ? COLORS.warn : COLORS.err;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 4,
        background: `${color}22`,
        color,
        whiteSpace: "nowrap",
        alignSelf: "flex-start",
      }}
    >
      {layer}
    </span>
  );
}

/**
 * Compact one-liner for an ExprNode. We don't pull in the full expression
 * printer from `@manifesto-ai/compiler` — that'd be heavy. This handles
 * the common shapes that blocker expressions take (refs, calls, literals,
 * binary ops). Anything else falls through to `op:kind`.
 */
function summarizeExpr(expr: unknown): string {
  if (expr === null || typeof expr !== "object") return String(expr);
  const node = expr as { kind?: string; op?: string; ref?: unknown; value?: unknown; args?: unknown[]; left?: unknown; right?: unknown; path?: unknown };
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

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "10px 12px",
  background: `${COLORS.err}10`,
  border: `1px solid ${COLORS.err}66`,
  borderRadius: 6,
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.2,
  color: COLORS.err,
};

const dotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 4,
  background: COLORS.err,
  display: "inline-block",
};

const reasonStyle: CSSProperties = {
  color: COLORS.textDim,
  fontWeight: 500,
  textTransform: "none",
  letterSpacing: 0,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
};

const descriptionStyle: CSSProperties = {
  fontSize: 12,
  color: COLORS.text,
};

const exprStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: 11,
  color: COLORS.textDim,
  background: COLORS.bg,
  padding: "2px 6px",
  borderRadius: 3,
  alignSelf: "flex-start",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const evaluatedStyle: CSSProperties = {
  fontSize: 10.5,
  color: COLORS.muted,
};

const emptyStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.muted,
  fontStyle: "italic",
  padding: "6px 0",
};
