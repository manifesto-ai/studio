/**
 * Shared inline-style tokens for Phase 1 panels.
 *
 * Values are CSS variable references so the host app (studio-webapp) can
 * theme the whole panel family by defining those vars. The fallbacks in
 * each `var(…, …)` are the original Phase 1 hexes — they apply when
 * studio-react is consumed outside the webapp (tests, storybook).
 */
export const COLORS = {
  bg: "var(--color-void, #0B1020)",
  panel: "var(--color-glass, rgba(255,255,255,0.03))",
  panelAlt: "var(--color-void-hi, #1A2036)",
  surface: "var(--color-void-hi, #1E293B)",
  line: "var(--color-rule, #334155)",
  text: "var(--color-ink, #E6EBF8)",
  textDim: "var(--color-ink-dim, #95A3B8)",
  muted: "var(--color-ink-mute, #607089)",
  accent: "var(--color-violet-hot, #63B3FC)",
  state: "var(--color-sig-state, #7ABBFF)",
  computed: "var(--color-sig-computed, #C18CFF)",
  action: "var(--color-sig-action, #75DBA2)",
  warn: "var(--color-warn, #FAC263)",
  err: "var(--color-err, #FC6A6B)",
  preserved: "var(--color-sig-action, #75DBA2)",
  initialized: "var(--color-violet-hot, #63B3FC)",
  discarded: "var(--color-err, #FC6A6B)",
} as const;

export const FONT_STACK =
  'var(--font-sans, "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif)';
export const MONO_STACK =
  'var(--font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace)';

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
