import { type CSSProperties, useState } from "react";
import { useStudio } from "./useStudio.js";
import {
  COLORS,
  MONO_STACK,
  PANEL_BODY,
  PANEL_EMPTY,
  PANEL_HEADER,
} from "./style-tokens.js";
import type { DispatchHistoryEntry } from "./StudioProvider.js";

export type DispatchTimelineProps = {
  /**
   * Called when the user selects a dispatch entry. The host app can react
   * by seeking the graph/time-scrub to that point or loading the intent
   * back into the editor.
   */
  readonly onSelect?: (entry: DispatchHistoryEntry) => void;
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

function statusColor(status: DispatchHistoryEntry["status"]): string {
  if (status === "completed") return COLORS.accent;
  if (status === "rejected") return COLORS.warn;
  return COLORS.err;
}

function statusLabel(entry: DispatchHistoryEntry): string {
  if (entry.status === "completed") return "completed";
  if (entry.status === "rejected") {
    return entry.rejectionCode
      ? `rejected · ${entry.rejectionCode.toLowerCase().replace(/_/g, " ")}`
      : "rejected";
  }
  return "failed";
}

export function DispatchTimeline({ onSelect }: DispatchTimelineProps = {}): JSX.Element {
  const { dispatchHistory } = useStudio();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={rootStyle}>
      <div style={PANEL_HEADER}>
        <span>Dispatches</span>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>
          {dispatchHistory.length} dispatch{dispatchHistory.length === 1 ? "" : "es"}
        </span>
      </div>
      <div style={PANEL_BODY}>
        {dispatchHistory.length === 0 ? (
          <div style={PANEL_EMPTY}>
            No dispatches yet. Run an intent to populate the timeline.
          </div>
        ) : (
          <ul style={listStyle}>
            {dispatchHistory.map((entry) => {
              const active = selected === entry.id;
              const detail =
                entry.status === "completed"
                  ? entry.changedPaths.length === 0
                    ? "no changes"
                    : `${entry.changedPaths.length} path${entry.changedPaths.length === 1 ? "" : "s"} changed`
                  : entry.status === "failed"
                    ? entry.failureMessage ?? "execution failed"
                    : "no state change";
              return (
                <li
                  key={entry.id}
                  style={{
                    ...rowStyle,
                    background: active ? COLORS.panelAlt : "transparent",
                  }}
                  onClick={() => {
                    setSelected(entry.id);
                    onSelect?.(entry);
                  }}
                  data-testid="dispatch-row"
                  data-dispatch-id={entry.id}
                  data-dispatch-status={entry.status}
                >
                  <span
                    style={{ ...dotStyle, background: statusColor(entry.status) }}
                  />
                  <div style={meta}>
                    <div style={firstLine}>
                      <span style={{ color: COLORS.text }}>{entry.intentType}</span>
                      <span style={{ color: COLORS.muted }}>
                        @ {shortHash(entry.schemaHash)}
                      </span>
                    </div>
                    <div style={secondLine}>
                      <span style={{ color: statusColor(entry.status) }}>
                        {statusLabel(entry)}
                      </span>
                      <span style={{ color: COLORS.muted }}>{detail}</span>
                      <span style={{ color: COLORS.muted }}>
                        {formatTime(entry.recordedAt)}
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
  flexShrink: 0,
};
const meta: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 11,
  minWidth: 0,
  flex: 1,
};
const firstLine: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
};
const secondLine: CSSProperties = {
  display: "flex",
  gap: 10,
  fontSize: 10,
  marginTop: 2,
  flexWrap: "wrap",
};
