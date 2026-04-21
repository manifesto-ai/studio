import { type CSSProperties } from "react";
import { COLORS, MONO_STACK } from "./style-tokens.js";

/**
 * InlineValue — compact, type-aware renderer for any runtime value that
 * would otherwise be `JSON.stringify`d. Used in places where space is
 * tight (tooltips, diff rows, blocker arguments, preview tables) so the
 * reader still sees shape + kind at a glance without the raw-string
 * noise of stringified JSON.
 *
 * This is deliberately narrower than the webapp's graph `ValueView`:
 * `ValueView` is a card-scale renderer with dedicated affordances
 * (boolean toggle pill, array tile strip, expandable object). This is
 * the one-line version — never grows vertically, always collapses
 * arrays and objects to a shape chip.
 *
 * Type → visual mapping:
 *   undefined  →  dimmed em-dash
 *   null       →  "null" dimmed
 *   boolean    →  true (green) / false (red) in accent-mixed color
 *   number     →  bright cyan monospace digits
 *   string     →  dim-quoted "…" with truncation
 *   array      →  shape chip "[N]" + first item hint when short
 *   object     →  shape chip "{K keys}" + first key hint when short
 *
 * `accent` tints the chip background so rows in a diff ("−" vs "+")
 * read as a unit without coloring the value text twice.
 */

export type InlineValueAccent =
  | "neutral"
  | "err"
  | "action"
  | "state"
  | "computed";

export type InlineValueProps = {
  readonly value: unknown;
  readonly accent?: InlineValueAccent;
  readonly maxStringLength?: number;
  readonly maxArrayHint?: number;
};

const TYPE_COLOR = {
  string: "var(--color-sig-computed, #C18CFF)",
  number: "var(--color-sig-state, #7ABBFF)",
  boolTrue: "var(--color-sig-action, #75DBA2)",
  boolFalse: "var(--color-err, #FC6A6B)",
  nullish: COLORS.muted,
  shape: COLORS.textDim,
};

function accentChipBg(accent: InlineValueAccent): string | undefined {
  switch (accent) {
    case "err":
      return "color-mix(in oklch, var(--color-err, #FC6A6B) 12%, transparent)";
    case "action":
      return "color-mix(in oklch, var(--color-sig-action, #75DBA2) 12%, transparent)";
    case "state":
      return "color-mix(in oklch, var(--color-sig-state, #7ABBFF) 10%, transparent)";
    case "computed":
      return "color-mix(in oklch, var(--color-sig-computed, #C18CFF) 10%, transparent)";
    case "neutral":
      return undefined;
  }
}

export function InlineValue({
  value,
  accent = "neutral",
  maxStringLength = 30,
  maxArrayHint = 2,
}: InlineValueProps): JSX.Element {
  const bg = accentChipBg(accent);
  const baseStyle: CSSProperties = {
    fontFamily: MONO_STACK,
    fontSize: 11,
    display: "inline-flex",
    alignItems: "baseline",
    gap: 4,
    padding: bg !== undefined ? "1px 6px" : undefined,
    borderRadius: 3,
    background: bg,
    maxWidth: "100%",
    overflow: "hidden",
    whiteSpace: "nowrap",
  };

  if (value === undefined) {
    return (
      <span style={{ ...baseStyle, color: TYPE_COLOR.nullish, fontStyle: "italic" }}>
        —
      </span>
    );
  }
  if (value === null) {
    return <span style={{ ...baseStyle, color: TYPE_COLOR.nullish }}>null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span
        style={{
          ...baseStyle,
          color: value ? TYPE_COLOR.boolTrue : TYPE_COLOR.boolFalse,
        }}
      >
        {value ? "true" : "false"}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span style={{ ...baseStyle, color: TYPE_COLOR.number }}>
        {formatNumber(value)}
      </span>
    );
  }
  if (typeof value === "bigint") {
    return (
      <span style={{ ...baseStyle, color: TYPE_COLOR.number }}>
        {value.toString()}n
      </span>
    );
  }
  if (typeof value === "string") {
    return <InlineString value={value} baseStyle={baseStyle} maxLen={maxStringLength} />;
  }
  if (Array.isArray(value)) {
    return (
      <InlineArray
        value={value}
        baseStyle={baseStyle}
        maxHint={maxArrayHint}
        maxStringLength={maxStringLength}
      />
    );
  }
  if (typeof value === "object") {
    return (
      <InlineObject
        value={value as Record<string, unknown>}
        baseStyle={baseStyle}
        maxStringLength={maxStringLength}
      />
    );
  }
  // Fallback — functions, symbols, etc.
  return (
    <span style={{ ...baseStyle, color: COLORS.muted, fontStyle: "italic" }}>
      {typeof value}
    </span>
  );
}

function InlineString({
  value,
  baseStyle,
  maxLen,
}: {
  readonly value: string;
  readonly baseStyle: CSSProperties;
  readonly maxLen: number;
}): JSX.Element {
  const isEmpty = value.length === 0;
  const trimmed = value.length > maxLen ? `${value.slice(0, maxLen - 1)}…` : value;
  return (
    <span style={baseStyle} title={value}>
      <span style={{ color: COLORS.muted }}>“</span>
      <span
        style={{
          color: isEmpty ? COLORS.muted : TYPE_COLOR.string,
          fontStyle: isEmpty ? "italic" : undefined,
        }}
      >
        {isEmpty ? "empty" : trimmed}
      </span>
      <span style={{ color: COLORS.muted }}>”</span>
    </span>
  );
}

function InlineArray({
  value,
  baseStyle,
  maxHint,
  maxStringLength,
}: {
  readonly value: readonly unknown[];
  readonly baseStyle: CSSProperties;
  readonly maxHint: number;
  readonly maxStringLength: number;
}): JSX.Element {
  const n = value.length;
  if (n === 0) {
    return (
      <span style={baseStyle}>
        <span style={{ color: TYPE_COLOR.shape }}>[]</span>
      </span>
    );
  }
  const hintCount = Math.min(n, maxHint);
  return (
    <span style={baseStyle} title={summarize(value, maxStringLength * 2)}>
      <span style={{ color: TYPE_COLOR.shape }}>[</span>
      {value.slice(0, hintCount).map((item, i) => (
        <span
          key={i}
          style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}
        >
          {i > 0 ? <span style={{ color: TYPE_COLOR.shape }}>,</span> : null}
          <span style={{ color: TYPE_COLOR.shape }}>{shortScalar(item)}</span>
        </span>
      ))}
      {n > hintCount ? (
        <span style={{ color: COLORS.muted }}>, +{n - hintCount}</span>
      ) : null}
      <span style={{ color: TYPE_COLOR.shape }}>]</span>
      <span style={{ color: COLORS.muted, marginLeft: 3 }}>{n}</span>
    </span>
  );
}

function InlineObject({
  value,
  baseStyle,
  maxStringLength,
}: {
  readonly value: Record<string, unknown>;
  readonly baseStyle: CSSProperties;
  readonly maxStringLength: number;
}): JSX.Element {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return (
      <span style={baseStyle}>
        <span style={{ color: TYPE_COLOR.shape }}>{"{}"}</span>
      </span>
    );
  }
  const preview = keys.slice(0, 2);
  return (
    <span style={baseStyle} title={summarize(value, maxStringLength * 2)}>
      <span style={{ color: TYPE_COLOR.shape }}>{"{"}</span>
      {preview.map((k, i) => (
        <span key={k} style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
          {i > 0 ? <span style={{ color: TYPE_COLOR.shape }}>,</span> : null}
          <span style={{ color: COLORS.textDim }}>{k}</span>
          <span style={{ color: TYPE_COLOR.shape }}>:</span>
          <span style={{ color: TYPE_COLOR.shape }}>{shortScalar(value[k])}</span>
        </span>
      ))}
      {keys.length > preview.length ? (
        <span style={{ color: COLORS.muted }}>, +{keys.length - preview.length}</span>
      ) : null}
      <span style={{ color: TYPE_COLOR.shape }}>{"}"}</span>
    </span>
  );
}

function shortScalar(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "—";
  if (typeof v === "string") return v.length > 10 ? `"${v.slice(0, 9)}…"` : `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return `{${Object.keys(v).length}}`;
  return typeof v;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) {
    if (Math.abs(n) >= 10_000) return n.toLocaleString("en-US");
    return n.toString();
  }
  // Trim trailing zeroes but keep up to 4 decimal places of signal.
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function summarize(v: unknown, max: number): string {
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return String(v);
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  } catch {
    return String(v);
  }
}
