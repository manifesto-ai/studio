import { type CSSProperties } from "react";
import { useStudio } from "./useStudio.js";
import type { Marker } from "./type-imports.js";
import { COLORS, PANEL_BODY, PANEL_EMPTY, PANEL_HEADER } from "./style-tokens.js";

export type DiagnosticsPanelProps = {
  /**
   * Called when the user clicks a marker. Consumers usually call
   * `editor.revealLineInCenter(span.start.line)` + `editor.setPosition(...)`
   * on their Monaco instance. studio-react intentionally does not hold the
   * editor reference — SE-UI-6 (no sdk/widget reach-through).
   */
  readonly onSelect?: (marker: Marker) => void;
};

export function DiagnosticsPanel({ onSelect }: DiagnosticsPanelProps): JSX.Element {
  const { diagnostics } = useStudio();

  return (
    <div style={rootStyle}>
      <div style={PANEL_HEADER}>
        <span>Diagnostics</span>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>
          {diagnostics.length} issue{diagnostics.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={PANEL_BODY}>
        {diagnostics.length === 0 ? (
          <div style={PANEL_EMPTY}>No diagnostics. Build to refresh.</div>
        ) : (
          <ul style={listStyle}>
            {diagnostics.map((m, i) => (
              <li
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                style={rowStyle}
                onClick={() => onSelect?.(m)}
                data-testid="diagnostic-row"
                data-severity={m.severity}
              >
                <span style={{ ...dotStyle, background: colorFor(m.severity) }} />
                <span style={messageStyle}>{m.message}</span>
                <span style={posStyle}>
                  {m.span.start.line}:{m.span.start.column}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function colorFor(severity: Marker["severity"]): string {
  switch (severity) {
    case "error":
      return COLORS.err;
    case "warning":
      return COLORS.warn;
    case "info":
      return COLORS.accent;
  }
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: COLORS.panel,
  minHeight: 0,
};
const listStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 14px",
  borderBottom: `1px solid ${COLORS.line}`,
  cursor: "pointer",
  fontSize: 12,
};
const dotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 4,
  flexShrink: 0,
};
const messageStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: COLORS.text,
};
const posStyle: CSSProperties = {
  color: COLORS.muted,
  fontSize: 10,
  flexShrink: 0,
};
