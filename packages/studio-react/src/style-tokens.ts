/**
 * Shared inline-style tokens for Phase 1 panels. Not a design system —
 * just enough to keep the webapp cohesive without inventing a styling
 * solution in W2. A real token layer (CSS vars + dark/light switch)
 * lands with P1-OQ-2 resolution.
 */
export const COLORS = {
  bg: "#0B1020",
  panel: "#0F172A",
  panelAlt: "#1A2036",
  surface: "#1E293B",
  line: "#334155",
  text: "#E6EBF8",
  textDim: "#95A3B8",
  muted: "#607089",
  accent: "#63B3FC",
  state: "#7ABBFF",
  computed: "#C18CFF",
  action: "#75DBA2",
  warn: "#FAC263",
  err: "#FC6A6B",
  preserved: "#75DBA2",
  initialized: "#63B3FC",
  discarded: "#FC6A6B",
} as const;

export const FONT_STACK =
  '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MONO_STACK =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace';

export const PANEL_HEADER: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: `1px solid ${COLORS.line}`,
  background: COLORS.panelAlt,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  color: COLORS.text,
};

export const PANEL_BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  padding: 0,
  color: COLORS.text,
  fontFamily: FONT_STACK,
  fontSize: 12,
};

export const PANEL_EMPTY: React.CSSProperties = {
  padding: 16,
  color: COLORS.muted,
  fontSize: 12,
  fontStyle: "italic",
};

export const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 1.4,
  color: COLORS.muted,
  textTransform: "uppercase",
};
