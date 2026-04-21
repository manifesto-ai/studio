import { type CSSProperties, useState } from "react";
import { COLORS, MONO_STACK } from "./style-tokens.js";
import { InlineValue, type InlineValueAccent } from "./InlineValue.js";

/**
 * JsonTree — recursive expandable renderer for objects and arrays.
 *
 * Leaves (primitives, strings, nulls, empty collections) use `InlineValue`
 * for a consistent type-aware chip. Branches (non-empty objects/arrays)
 * render a header row with an expand chevron + shape summary, and their
 * children below when expanded.
 *
 * Expand state lives per-subtree in local `useState` — no external
 * controller needed. Initial depth controls how many levels auto-open
 * (default 1 so the user sees "what's here" without pre-commitment).
 *
 * This is the drill-down companion to `InlineValue`: InlineValue is the
 * 1-line summary used in tooltips / diff rows; JsonTree is what you
 * render inside a dedicated pane (Inspect tab, modal, etc.) when the
 * user wants to walk the structure.
 */

export type JsonTreeProps = {
  readonly value: unknown;
  /**
   * Label shown at the root. Usually the field name or path segment.
   * Omit for headless renders (e.g. value is already contextualised).
   */
  readonly label?: string;
  /**
   * How many levels below the root start expanded. 0 = everything
   * collapsed, 1 = root is open but children collapsed (default), etc.
   */
  readonly defaultOpenDepth?: number;
  /** Accent applied to leaf InlineValues. */
  readonly accent?: InlineValueAccent;
};

export function JsonTree({
  value,
  label,
  defaultOpenDepth = 1,
  accent = "neutral",
}: JsonTreeProps): JSX.Element {
  return (
    <div style={rootStyle}>
      <JsonTreeNode
        name={label}
        value={value}
        depth={0}
        defaultOpenDepth={defaultOpenDepth}
        accent={accent}
        isRoot
      />
    </div>
  );
}

type NodeProps = {
  readonly name?: string | number;
  readonly value: unknown;
  readonly depth: number;
  readonly defaultOpenDepth: number;
  readonly accent: InlineValueAccent;
  readonly isRoot?: boolean;
};

function JsonTreeNode({
  name,
  value,
  depth,
  defaultOpenDepth,
  accent,
  isRoot,
}: NodeProps): JSX.Element {
  const shape = classify(value);

  // Leaves: render as a single row with InlineValue.
  if (shape.kind === "leaf") {
    return (
      <div style={rowStyle(depth)}>
        {name !== undefined ? (
          <span style={keyStyle}>{String(name)}</span>
        ) : null}
        <InlineValue value={value} accent={accent} />
      </div>
    );
  }

  // Branches: header row with expand control + summary, children below.
  return (
    <BranchNode
      name={name}
      shape={shape}
      depth={depth}
      defaultOpenDepth={defaultOpenDepth}
      accent={accent}
      isRoot={isRoot}
    />
  );
}

function BranchNode({
  name,
  shape,
  depth,
  defaultOpenDepth,
  accent,
  isRoot,
}: {
  readonly name?: string | number;
  readonly shape: BranchShape;
  readonly depth: number;
  readonly defaultOpenDepth: number;
  readonly accent: InlineValueAccent;
  readonly isRoot?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(() => depth < defaultOpenDepth);
  const entries =
    shape.kind === "array"
      ? shape.items.map((v, i) => [i as number | string, v] as const)
      : shape.entries;
  const count = entries.length;
  const summary =
    shape.kind === "array" ? `[${count}]` : `{${count}}`;
  const summaryLabel =
    shape.kind === "array"
      ? `${count} item${count === 1 ? "" : "s"}`
      : `${count} field${count === 1 ? "" : "s"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ ...rowStyle(depth), ...branchHeaderStyle }}
        aria-expanded={open}
      >
        <span style={chevronStyle}>{open ? "▾" : "▸"}</span>
        {name !== undefined ? (
          <span style={keyStyle}>{String(name)}</span>
        ) : isRoot ? (
          <span style={rootLabelStyle}>root</span>
        ) : null}
        <span style={shapeStyle}>{summary}</span>
        <span style={summaryLabelStyle}>{summaryLabel}</span>
      </button>
      {open
        ? entries.map(([key, child]) => (
            <JsonTreeNode
              key={String(key)}
              name={key}
              value={child}
              depth={depth + 1}
              defaultOpenDepth={defaultOpenDepth}
              accent={accent}
            />
          ))
        : null}
    </>
  );
}

type BranchShape =
  | { readonly kind: "array"; readonly items: readonly unknown[] }
  | {
      readonly kind: "object";
      readonly entries: readonly (readonly [string, unknown])[];
    };

type Classified = BranchShape | { readonly kind: "leaf" };

function classify(value: unknown): Classified {
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "leaf" };
    return { kind: "array", items: value };
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !isPlainLeafObject(value)
  ) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return { kind: "leaf" };
    return { kind: "object", entries };
  }
  return { kind: "leaf" };
}

function isPlainLeafObject(value: object): boolean {
  // Treat Date / RegExp / Error etc. as leaves — their useful display
  // is a single line, not a tree walk.
  if (value instanceof Date) return true;
  if (value instanceof RegExp) return true;
  if (value instanceof Error) return true;
  return false;
}

const rootStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: 11.5,
  color: COLORS.text,
  display: "flex",
  flexDirection: "column",
  gap: 1,
};

function rowStyle(depth: number): CSSProperties {
  return {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    paddingLeft: 4 + depth * 14,
    paddingRight: 8,
    paddingTop: 1,
    paddingBottom: 1,
    minHeight: 18,
    textAlign: "left" as const,
  };
}

const branchHeaderStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "inherit",
  font: "inherit",
  width: "100%",
};

const chevronStyle: CSSProperties = {
  color: COLORS.muted,
  width: 10,
  display: "inline-block",
  fontSize: 10,
  transform: "translateY(-1px)",
};

const keyStyle: CSSProperties = {
  color: COLORS.textDim,
  fontSize: 11,
};

const rootLabelStyle: CSSProperties = {
  color: COLORS.muted,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.8,
};

const shapeStyle: CSSProperties = {
  color: COLORS.accent,
  fontSize: 10.5,
};

const summaryLabelStyle: CSSProperties = {
  color: COLORS.muted,
  fontSize: 10,
};
