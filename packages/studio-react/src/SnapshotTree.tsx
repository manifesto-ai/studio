import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStudio } from "./useStudio.js";
import {
  COLORS,
  MONO_STACK,
  PANEL_BODY,
  PANEL_EMPTY,
  PANEL_HEADER,
} from "./style-tokens.js";

/**
 * Optional focus binding — the host app passes which node the user is
 * inspecting. When set, the tree **highlights** the corresponding
 * node (state or computed field) in place rather than scoping away
 * the rest of the snapshot. This is deliberate: for data analysis
 * the user wants to see the neighbours of the value they clicked,
 * not a hollowed-out pane. Ancestors of the highlighted path auto-
 * expand, and the element scrolls into view when focus changes.
 *
 * Action focus produces a small inline hint (actions don't have a
 * snapshot value) but otherwise doesn't hide any tree content.
 *
 * Provider owns the focus state (the webapp has `useFocus`);
 * `SnapshotTree` stays agnostic and takes it as a prop so studio-
 * react has no reverse dependency on the app layer.
 */
export type SnapshotFocus =
  | { readonly kind: "state"; readonly name: string }
  | { readonly kind: "computed"; readonly name: string }
  | { readonly kind: "action"; readonly name: string };

export type SnapshotTreeProps = {
  readonly focus?: SnapshotFocus | null;
};

type Node =
  | { readonly kind: "primitive"; readonly value: unknown }
  | { readonly kind: "array"; readonly items: readonly unknown[] }
  | { readonly kind: "object"; readonly entries: readonly (readonly [string, unknown])[] };

function classify(value: unknown): Node {
  if (Array.isArray(value)) return { kind: "array", items: value };
  if (value !== null && typeof value === "object") {
    return {
      kind: "object",
      entries: Object.entries(value as Record<string, unknown>),
    };
  }
  return { kind: "primitive", value };
}

function renderPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export function SnapshotTree({ focus = null }: SnapshotTreeProps = {}): JSX.Element {
  const { snapshot } = useStudio();
  const data = useMemo(() => {
    if (snapshot === null) return null;
    return (snapshot as { readonly data?: unknown }).data ?? null;
  }, [snapshot]);
  const computed = useMemo(() => {
    if (snapshot === null) return null;
    const c = (snapshot as { readonly computed?: Record<string, unknown> })
      .computed;
    return c ?? null;
  }, [snapshot]);

  const computedEntries = useMemo<readonly (readonly [string, unknown])[]>(() => {
    if (computed === null || typeof computed !== "object") return [];
    return Object.entries(computed);
  }, [computed]);
  const hasComputed = computedEntries.length > 0;

  // Translate a graph focus into a snapshot path. `action` focus has
  // no corresponding snapshot value, so we keep it null (no
  // highlighting) and the body shows a hint instead.
  const highlightedPath = useMemo<string | null>(() => {
    if (focus === null) return null;
    if (focus.kind === "state") return `data.${focus.name}`;
    if (focus.kind === "computed") return `computed.${focus.name}`;
    return null;
  }, [focus]);

  const title = "Snapshot";
  const rightLabel = (() => {
    if (focus === null) {
      if (snapshot === null) return "—";
      return hasComputed ? "state · computed" : "state";
    }
    if (focus.kind === "action") return `action · ${focus.name} (no value)`;
    return `highlight: ${focus.kind}.${focus.name}`;
  })();

  return (
    <div style={rootStyle}>
      <div style={PANEL_HEADER}>
        <span>{title}</span>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>{rightLabel}</span>
      </div>
      <div style={PANEL_BODY}>
        {renderBody({
          data,
          computed,
          hasComputed,
          highlightedPath,
          focus,
        })}
      </div>
    </div>
  );
}

function renderBody({
  data,
  computed,
  hasComputed,
  highlightedPath,
  focus,
}: {
  readonly data: unknown;
  readonly computed: Record<string, unknown> | null;
  readonly hasComputed: boolean;
  readonly highlightedPath: string | null;
  readonly focus: SnapshotFocus | null;
}): JSX.Element {
  const hasState = data !== null && data !== undefined;
  if (!hasState && !hasComputed) {
    return (
      <div style={PANEL_EMPTY}>
        No snapshot yet. Build + dispatch to populate, or click a graph
        node to inspect its value.
      </div>
    );
  }

  const actionHint =
    focus !== null && focus.kind === "action" ? (
      // Actions don't have a snapshot value to highlight. Surface a
      // small inline note so the user knows clicking the action is
      // noted, then still show them the full state+computed tree.
      <div style={actionHintStyle}>
        <code>{focus.name}</code> is an action — no snapshot value. Switch
        to <strong>Interact</strong> to dispatch it.
      </div>
    ) : null;

  return (
    <div
      style={{
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {actionHint}
      {hasState ? (
        <TreeSection label="state">
          <TreeNode
            path="data"
            value={data}
            depth={0}
            highlightedPath={highlightedPath}
          />
        </TreeSection>
      ) : null}
      {hasComputed && computed !== null ? (
        <TreeSection label="computed">
          <TreeNode
            path="computed"
            value={computed}
            depth={0}
            highlightedPath={highlightedPath}
          />
        </TreeSection>
      ) : null}
    </div>
  );
}

/**
 * Labelled top-level container so "state" and "computed" read as
 * sibling sections rather than one merged tree. Label is a muted
 * uppercase strip so the section chrome doesn't compete with the
 * actual values.
 */
function TreeSection({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <div style={sectionLabelStyle}>{label}</div>
      {children}
    </div>
  );
}

function TreeNode({
  path,
  value,
  depth,
  highlightedPath,
}: {
  readonly path: string;
  readonly value: unknown;
  readonly depth: number;
  readonly highlightedPath: string | null;
}): JSX.Element {
  const isHighlighted = highlightedPath === path;
  const isAncestorOfHighlight =
    highlightedPath !== null && highlightedPath.startsWith(path + ".");

  // Default-open rule: first few levels for skimming, plus any
  // ancestor of the highlighted path so the highlight is visible
  // without the user expanding by hand. Users can still collapse.
  const [open, setOpen] = useState(depth < 3 || isAncestorOfHighlight);

  // When focus changes and this node becomes an ancestor of the new
  // highlight, force-open. Doesn't close what the user manually
  // opened — only ever sets to true.
  useEffect(() => {
    if (isAncestorOfHighlight) setOpen(true);
  }, [isAncestorOfHighlight]);

  // Scroll into view when this is the highlighted node. `block:
  // "center"` keeps context above + below the value rather than
  // pinning it to the top of the scroller.
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isHighlighted) return;
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isHighlighted]);

  const node = classify(value);

  const copyPath = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(path).catch(() => {});
    }
  }, [path]);

  const rowHighlightStyle: CSSProperties = isHighlighted ? highlightStyle : {};

  if (node.kind === "primitive") {
    return (
      <div
        ref={rowRef}
        style={{ ...leafStyle, ...rowHighlightStyle }}
        onClick={copyPath}
        title={`click to copy: ${path}`}
        data-highlighted={isHighlighted || undefined}
      >
        <span style={keyLabelStyle}>{leafKeyOf(path)}</span>
        <span style={{ color: COLORS.muted }}>:</span>
        <span style={{ color: primitiveColor(node.value) }}>
          {renderPrimitive(node.value)}
        </span>
      </div>
    );
  }

  const summary =
    node.kind === "array" ? `[${node.items.length}]` : `{${node.entries.length}}`;

  return (
    <div>
      <div
        ref={rowRef}
        style={{ ...branchStyle, ...rowHighlightStyle }}
        onClick={() => setOpen((o) => !o)}
        data-testid="snapshot-branch"
        data-path={path}
        data-highlighted={isHighlighted || undefined}
      >
        <span style={{ width: 12, color: COLORS.muted }}>{open ? "▾" : "▸"}</span>
        <span style={keyLabelStyle}>{leafKeyOf(path)}</span>
        <span style={{ color: COLORS.muted }}>{summary}</span>
        <span
          style={copyBtnStyle}
          onClick={(e) => {
            e.stopPropagation();
            copyPath();
          }}
          role="button"
          aria-label={`copy path ${path}`}
        >
          copy
        </span>
      </div>
      {open ? (
        <div style={{ paddingLeft: 14 }}>
          {node.kind === "array"
            ? node.items.map((child, i) => (
                <TreeNode
                  key={`${path}.${i}`}
                  path={`${path}.${i}`}
                  value={child}
                  depth={depth + 1}
                  highlightedPath={highlightedPath}
                />
              ))
            : node.entries.map(([k, v]) => (
                <TreeNode
                  key={`${path}.${k}`}
                  path={`${path}.${k}`}
                  value={v}
                  depth={depth + 1}
                  highlightedPath={highlightedPath}
                />
              ))}
        </div>
      ) : null}
    </div>
  );
}

function leafKeyOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? path : path.slice(idx + 1);
}

function primitiveColor(value: unknown): string {
  if (typeof value === "string") return COLORS.preserved;
  if (typeof value === "number") return COLORS.accent;
  if (typeof value === "boolean") return COLORS.warn;
  if (value === null || value === undefined) return COLORS.muted;
  return COLORS.text;
}

const sectionLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: COLORS.muted,
  padding: "2px 0 4px",
  borderBottom: `1px solid ${COLORS.line}`,
  marginBottom: 4,
};
const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: COLORS.panel,
  minHeight: 0,
  fontFamily: MONO_STACK,
};
const branchStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 4px",
  cursor: "pointer",
  fontSize: 11,
  borderRadius: 3,
  transition: "background 120ms, box-shadow 120ms",
};
const leafStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 4px 2px 22px",
  cursor: "pointer",
  fontSize: 11,
  borderRadius: 3,
  transition: "background 120ms, box-shadow 120ms",
};
const keyLabelStyle: CSSProperties = {
  color: COLORS.textDim,
};
const copyBtnStyle: CSSProperties = {
  marginLeft: "auto",
  color: COLORS.muted,
  fontSize: 10,
  padding: "0 4px",
  border: `1px solid ${COLORS.line}`,
  borderRadius: 3,
  cursor: "pointer",
};
// Highlight lifts the row with a subtle accent background + left
// accent bar. Kept quiet so a deeply-nested highlighted leaf
// doesn't scream over its neighbours — this is about orientation,
// not alarm.
const highlightStyle: CSSProperties = {
  background: `color-mix(in oklch, ${COLORS.accent} 14%, transparent)`,
  boxShadow: `inset 2px 0 0 ${COLORS.accent}`,
};
const actionHintStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.muted,
  padding: "6px 8px",
  background: COLORS.panel,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
};
