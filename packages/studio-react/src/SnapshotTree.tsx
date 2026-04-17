import { type CSSProperties, useCallback, useMemo, useState } from "react";
import { useStudio } from "./useStudio.js";
import {
  COLORS,
  MONO_STACK,
  PANEL_BODY,
  PANEL_EMPTY,
  PANEL_HEADER,
} from "./style-tokens.js";

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

export function SnapshotTree(): JSX.Element {
  const { snapshot } = useStudio();
  const data = useMemo(() => {
    if (snapshot === null) return null;
    return (snapshot as { readonly data?: unknown }).data ?? null;
  }, [snapshot]);

  return (
    <div style={rootStyle}>
      <div style={PANEL_HEADER}>
        <span>Snapshot</span>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>
          {snapshot === null ? "—" : "data"}
        </span>
      </div>
      <div style={PANEL_BODY}>
        {snapshot === null || data === null || data === undefined ? (
          <div style={PANEL_EMPTY}>No snapshot yet. Build + dispatch to populate.</div>
        ) : (
          <div style={{ padding: "10px 14px" }}>
            <TreeNode path="data" value={data} depth={0} />
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  path,
  value,
  depth,
}: {
  readonly path: string;
  readonly value: unknown;
  readonly depth: number;
}): JSX.Element {
  const [open, setOpen] = useState(depth < 3);
  const node = classify(value);

  const copyPath = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(path).catch(() => {});
    }
  }, [path]);

  if (node.kind === "primitive") {
    return (
      <div style={leafStyle} onClick={copyPath} title={`click to copy: ${path}`}>
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
        style={branchStyle}
        onClick={() => setOpen((o) => !o)}
        data-testid="snapshot-branch"
        data-path={path}
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
                />
              ))
            : node.entries.map(([k, v]) => (
                <TreeNode
                  key={`${path}.${k}`}
                  path={`${path}.${k}`}
                  value={v}
                  depth={depth + 1}
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
  padding: "2px 0",
  cursor: "pointer",
  fontSize: 11,
};
const leafStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 0 2px 18px",
  cursor: "pointer",
  fontSize: 11,
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
