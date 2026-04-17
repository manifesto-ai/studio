import type { CSSProperties } from "react";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import type { Snapshot, StudioSimulateResult } from "@manifesto-ai/studio-core";

export type SimulatePreviewProps = {
  readonly result: StudioSimulateResult;
  readonly beforeSnapshot: Snapshot<unknown> | null;
};

/**
 * Renders a simulate() outcome: changed paths with before/after values,
 * newly-available action names, pending host requirements, and a status
 * banner. This is the "preview" layer — it never causes a dispatch.
 */
export function SimulatePreview({
  result,
  beforeSnapshot,
}: SimulatePreviewProps): JSX.Element {
  const { snapshot: after, changedPaths, newAvailableActions, requirements, status } = result;
  return (
    <div style={rootStyle}>
      <header style={headerStyle}>
        <span style={dotStyle(status)} />
        <span style={{ fontWeight: 600 }}>simulate</span>
        <span style={statusLabelStyle(status)}>{status}</span>
        <span style={{ marginLeft: "auto", color: COLORS.muted, fontSize: 10.5 }}>
          {changedPaths.length} path{changedPaths.length === 1 ? "" : "s"} · schema{" "}
          {result.meta.schemaHash.slice(0, 8)}
        </span>
      </header>

      <Section title="Changed paths">
        {changedPaths.length === 0 ? (
          <div style={emptyHintStyle}>(no paths change)</div>
        ) : (
          <ul style={pathListStyle}>
            {changedPaths.map((p) => (
              <PathRow
                key={p}
                path={p}
                before={resolvePath(beforeSnapshot?.data, p)}
                after={resolvePath(after.data, p)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Now available">
        {newAvailableActions.length === 0 ? (
          <div style={emptyHintStyle}>(no new actions unlocked)</div>
        ) : (
          <ul style={chipListStyle}>
            {newAvailableActions.map((a) => (
              <li key={String(a)} style={chipStyle}>
                {String(a)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Host requirements (${requirements.length})`}>
        {requirements.length === 0 ? (
          <div style={emptyHintStyle}>(no host effects)</div>
        ) : (
          <ul style={reqListStyle}>
            {requirements.map((r) => (
              <li key={r.id} style={reqRowStyle}>
                <code style={reqTypeStyle}>{r.type}</code>
                <code style={reqParamsStyle}>
                  {truncate(JSON.stringify(r.params))}
                </code>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function PathRow({
  path,
  before,
  after,
}: {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}): JSX.Element {
  return (
    <li style={pathRowStyle}>
      <code style={pathLabelStyle}>{path}</code>
      <div style={diffBoxStyle}>
        <code style={beforeValueStyle}>{formatValue(before)}</code>
        <span style={arrowStyle}>→</span>
        <code style={afterValueStyle}>{formatValue(after)}</code>
      </div>
    </li>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section style={sectionStyle}>
      <header style={sectionHeaderStyle}>{title}</header>
      {children}
    </section>
  );
}

function resolvePath(data: unknown, path: string): unknown {
  if (data === null || data === undefined) return undefined;
  // Paths look like "data.todos.0.title" or "state.todos". Handle both
  // root prefixes lazily.
  const segments = path.split(".").filter((s) => s !== "" && s !== "$");
  let cur: unknown = data;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isFinite(idx)) {
        // Maybe the path points to a named subtree (like "data") that we
        // already skipped. Return current cursor.
        return cur;
      }
      cur = cur[idx];
      continue;
    }
    if (typeof cur !== "object") return undefined;
    const rec = cur as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rec, seg)) {
      cur = rec[seg];
    } else if (seg === "data" && "data" in rec) {
      cur = rec.data;
    } else {
      return undefined;
    }
  }
  return cur;
}

function formatValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  try {
    const s = JSON.stringify(v);
    return truncate(s);
  } catch {
    return "(value)";
  }
}

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function dotStyle(status: string): CSSProperties {
  const color =
    status === "idle" || status === "settled"
      ? COLORS.preserved
      : status === "computing" || status === "pending"
        ? COLORS.warn
        : status === "error"
          ? COLORS.err
          : COLORS.muted;
  return {
    width: 8,
    height: 8,
    borderRadius: 4,
    background: color,
    display: "inline-block",
  };
}

function statusLabelStyle(status: string): CSSProperties {
  const color =
    status === "error"
      ? COLORS.err
      : status === "computing" || status === "pending"
        ? COLORS.warn
        : COLORS.textDim;
  return { fontSize: 10.5, color, letterSpacing: 0.6, textTransform: "uppercase" };
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "10px 12px",
  background: COLORS.panelAlt,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const sectionHeaderStyle: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: COLORS.muted,
};

const pathListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const pathRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const pathLabelStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: 10.5,
  color: COLORS.textDim,
};

const diffBoxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: MONO_STACK,
  fontSize: 11,
};

const beforeValueStyle: CSSProperties = {
  color: COLORS.muted,
  textDecoration: "line-through",
  background: COLORS.bg,
  padding: "2px 5px",
  borderRadius: 3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "48%",
};

const afterValueStyle: CSSProperties = {
  color: COLORS.preserved,
  background: COLORS.bg,
  padding: "2px 5px",
  borderRadius: 3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "48%",
};

const arrowStyle: CSSProperties = {
  color: COLORS.muted,
  fontSize: 11,
};

const chipListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const chipStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: 10.5,
  padding: "2px 8px",
  borderRadius: 10,
  background: `${COLORS.accent}22`,
  color: COLORS.accent,
};

const reqListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const reqRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "baseline",
  fontFamily: MONO_STACK,
  fontSize: 10.5,
};

const reqTypeStyle: CSSProperties = {
  color: COLORS.warn,
};

const reqParamsStyle: CSSProperties = {
  color: COLORS.textDim,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

const emptyHintStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.muted,
  fontStyle: "italic",
};
