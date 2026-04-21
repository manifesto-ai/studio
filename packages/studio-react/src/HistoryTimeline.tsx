import { type CSSProperties, useState } from "react";
import { useStudio } from "./useStudio.js";
import type { EditIntentEnvelope } from "@manifesto-ai/studio-core";
import {
  COLORS,
  MONO_STACK,
  PANEL_BODY,
  PANEL_EMPTY,
  PANEL_HEADER,
} from "./style-tokens.js";

export type HistoryTimelineProps = {
  /**
   * Called when the user selects an envelope. The host app can react by
   * highlighting that point in time, loading its source into the editor,
   * or (P1-G8, Week 5) running replay-from-here.
   */
  readonly onSelect?: (envelope: EditIntentEnvelope) => void;
};

function shortHash(hash: string | null): string {
  if (hash === null) return "∅";
  return hash.length <= 8 ? hash : hash.slice(0, 8);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function HistoryTimeline({ onSelect }: HistoryTimelineProps): JSX.Element {
  const { history } = useStudio();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={rootStyle}>
      <div style={PANEL_HEADER}>
        <span>History</span>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>
          {history.length} envelope{history.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={PANEL_BODY}>
        {history.length === 0 ? (
          <div style={PANEL_EMPTY}>No edit history yet. Every successful build appends one.</div>
        ) : (
          <ul style={listStyle}>
            {history.map((env) => {
              const active = selected === env.id;
              return (
                <li
                  key={env.id}
                  style={{
                    ...rowStyle,
                    background: active ? COLORS.panelAlt : "transparent",
                  }}
                  onClick={() => {
                    setSelected(env.id);
                    onSelect?.(env);
                  }}
                  data-testid="history-row"
                  data-envelope-id={env.id}
                >
                  <span style={dotStyle} />
                  <div style={meta}>
                    <div style={firstLine}>
                      <span style={{ color: COLORS.text }}>{env.payloadKind}</span>
                      <span style={{ color: COLORS.muted }}>
                        {shortHash(env.prevSchemaHash)} → {shortHash(env.nextSchemaHash)}
                      </span>
                    </div>
                    <div style={secondLine}>
                      <span style={{ color: COLORS.muted }}>
                        {formatTime(env.timestamp)} · {env.author}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: COLORS.panel,
  minHeight: 0,
  fontFamily: MONO_STACK,
};
const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 14px",
  borderBottom: `1px solid ${COLORS.line}`,
  cursor: "pointer",
};
const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 3,
  background: COLORS.accent,
  flexShrink: 0,
};
const meta: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 11,
  minWidth: 0,
};
const firstLine: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
};
const secondLine: CSSProperties = {
  fontSize: 10,
  marginTop: 2,
};
