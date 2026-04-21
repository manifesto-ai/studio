import { type CSSProperties, type ReactNode, useMemo } from "react";
import { useStudio } from "./useStudio.js";
import {
  COLORS,
  FONT_STACK,
  PANEL_BODY,
  PANEL_HEADER,
} from "./style-tokens.js";

export type SourceEditorProps = {
  /**
   * The Monaco host. `<div ref={...} />` that the consumer's Monaco
   * lifecycle mounts into. Passing this through keeps studio-react
   * widget-agnostic — we don't import monaco-editor here.
   */
  readonly children: ReactNode;
  /** Filename shown on the tab chip. Cosmetic; no state coupled to it. */
  readonly filename?: string;
};

/**
 * Panel chrome around a Monaco host. Renders header + footer + the
 * editor mount provided by the host app (`children`). Reads current
 * diagnostics and build status from `useStudio` to render the footer.
 */
export function SourceEditor({
  children,
  filename = "source.mel",
}: SourceEditorProps): JSX.Element {
  const { diagnostics, version } = useStudio();
  const { errors, warnings } = useMemo(() => {
    let e = 0;
    let w = 0;
    for (const m of diagnostics) {
      if (m.severity === "error") e += 1;
      else if (m.severity === "warning") w += 1;
    }
    return { errors: e, warnings: w };
    // depend on `version` to refresh when diagnostics change after build
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnostics, version]);

  return (
    <div style={rootStyle}>
      <div style={PANEL_HEADER}>
        <div style={tabChipStyle}>
          <span>{filename}</span>
        </div>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>⌘/Ctrl + S to build</span>
      </div>
      <div style={PANEL_BODY}>{children}</div>
      <div style={footerStyle}>
        <span style={{ ...dotStyle, background: errors > 0 ? COLORS.err : COLORS.muted }} />
        <span>
          {errors} error{errors === 1 ? "" : "s"}
        </span>
        <span style={{ width: 16 }} />
        <span style={{ ...dotStyle, background: warnings > 0 ? COLORS.warn : COLORS.muted }} />
        <span>
          {warnings} warning{warnings === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  background: COLORS.panel,
  fontFamily: FONT_STACK,
  height: "100%",
  minHeight: 0,
};
const tabChipStyle: CSSProperties = {
  padding: "4px 10px",
  background: COLORS.panel,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  fontSize: 11,
  color: COLORS.text,
};
const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  borderTop: `1px solid ${COLORS.line}`,
  background: COLORS.panelAlt,
  color: COLORS.textDim,
  fontSize: 11,
};
const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 3,
  display: "inline-block",
};
