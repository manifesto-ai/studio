import type { CSSProperties, ReactNode } from "react";
import { COLORS, FONT_STACK, MONO_STACK } from "../../style-tokens.js";
import { pathToKey, type FormPath } from "../form-path-utils.js";

export function FieldChrome({
  label,
  required,
  description,
  labelFor,
  children,
  asGroup = false,
  trailing,
  highlighted = false,
}: {
  readonly label?: string;
  readonly required: boolean;
  readonly description?: string;
  readonly labelFor?: string;
  readonly children: ReactNode;
  readonly asGroup?: boolean;
  readonly trailing?: ReactNode;
  readonly highlighted?: boolean;
}): JSX.Element {
  const chromeStyle = asGroup ? groupChromeStyle : fieldChromeStyle;
  return (
    <div
      style={{
        ...chromeStyle,
        ...(highlighted
          ? { borderColor: COLORS.err, boxShadow: `0 0 0 1px ${COLORS.err}22` }
          : null),
      }}
    >
      {label !== undefined ? (
        <div style={labelRowStyle}>
          {labelFor !== undefined ? (
            <label
              htmlFor={labelFor}
              style={{
                ...labelStyle,
                color: highlighted ? COLORS.err : labelStyle.color,
              }}
            >
              {label}
              {required ? <span style={requiredStyle}>*</span> : null}
            </label>
          ) : (
            <span
              style={{
                ...labelStyle,
                color: highlighted ? COLORS.err : labelStyle.color,
              }}
            >
              {label}
              {required ? <span style={requiredStyle}>*</span> : null}
            </span>
          )}
          {trailing}
        </div>
      ) : trailing !== undefined ? (
        <div style={labelRowStyle}>
          <span />
          {trailing}
        </div>
      ) : null}
      {description !== undefined && description.length > 0 ? (
        <div style={descriptionStyle}>{description}</div>
      ) : null}
      {children}
    </div>
  );
}

export function composeTrailing(
  ...items: readonly (ReactNode | null | undefined)[]
): ReactNode | undefined {
  const visible = items.filter(
    (item): item is ReactNode => item !== null && item !== undefined,
  );
  if (visible.length === 0) return undefined;
  return <div style={trailingStackStyle}>{visible}</div>;
}

export function makeId(path: FormPath, label: string | undefined): string {
  const parts = label !== undefined ? [...path, label] : path;
  return `form-${parts.join("-").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isPathHighlighted(
  highlightedPaths: ReadonlySet<string> | undefined,
  path: FormPath,
): boolean {
  if (highlightedPaths === undefined) return false;
  return highlightedPaths.has(pathToKey(path));
}

export function inputStyle(highlighted: boolean): CSSProperties {
  return {
    ...baseInputStyle,
    border: `1px solid ${highlighted ? COLORS.err : COLORS.line}`,
  };
}

export const smallBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  padding: "3px 8px",
  borderRadius: 4,
  border: `1px solid ${COLORS.line}`,
  background: COLORS.bg,
  color: COLORS.textDim,
  fontFamily: FONT_STACK,
  fontSize: 10.5,
  cursor: "pointer",
};

export const optionalHintStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  paddingTop: 4,
};

export const emptyHintStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.muted,
  fontStyle: "italic",
};

export const nestedGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 4,
};

export const rootGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const arrayListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

export const recordKeyStyle: CSSProperties = {
  minWidth: 92,
  alignSelf: "flex-start",
  padding: "6px 8px",
  borderRadius: 4,
  background: COLORS.bg,
  border: `1px solid ${COLORS.line}`,
  fontFamily: MONO_STACK,
  fontSize: 11,
  color: COLORS.textDim,
  wordBreak: "break-word",
};

export const arrayRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
};

export const recordAddRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

export const errorStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.err,
  fontFamily: MONO_STACK,
};

const fieldChromeStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
};

const groupChromeStyle: CSSProperties = {
  ...fieldChromeStyle,
  padding: "8px 10px",
  borderRadius: 6,
  background: COLORS.panelAlt,
  border: `1px solid ${COLORS.line}`,
};

const labelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.8,
  color: COLORS.textDim,
  textTransform: "uppercase",
};

const requiredStyle: CSSProperties = {
  color: COLORS.err,
  marginLeft: 3,
};

const descriptionStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.muted,
};

const trailingStackStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const baseInputStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 4,
  background: COLORS.bg,
  color: COLORS.text,
  fontFamily: FONT_STACK,
  fontSize: 12,
};
