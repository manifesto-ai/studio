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
  const highlightStyle: CSSProperties = highlighted
    ? { borderColor: COLORS.err, boxShadow: `0 0 0 1px ${COLORS.err}22` }
    : {};

  // Groups (objects, arrays, records) keep the traditional stacked
  // chrome: bordered panel with header row + nested children below.
  if (asGroup) {
    return (
      <div style={{ ...groupChromeStyle, ...highlightStyle }}>
        {label !== undefined ? (
          <div style={labelRowStyle}>
            <LabelNode
              label={label}
              required={required}
              highlighted={highlighted}
              labelFor={labelFor}
            />
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

  // Leaf fields render horizontally: label | input | trailing actions
  // in a 3-col grid. Description (when present) drops to a second row
  // aligned under the input. Cuts vertical space in half for dense
  // object forms like Task / ClockStamp.
  return (
    <div style={{ ...leafGridStyle, ...highlightStyle }}>
      {label !== undefined ? (
        <LabelNode
          label={label}
          required={required}
          highlighted={highlighted}
          labelFor={labelFor}
          align="right"
        />
      ) : (
        <span />
      )}
      <div style={leafBodyStyle}>{children}</div>
      <div style={leafTrailingStyle}>{trailing}</div>
      {description !== undefined && description.length > 0 ? (
        <>
          <span />
          <div style={descriptionStyle}>{description}</div>
          <span />
        </>
      ) : null}
    </div>
  );
}

function LabelNode({
  label,
  required,
  highlighted,
  labelFor,
  align = "left",
}: {
  readonly label: string;
  readonly required: boolean;
  readonly highlighted: boolean;
  readonly labelFor?: string;
  readonly align?: "left" | "right";
}): JSX.Element {
  const style: CSSProperties = {
    ...labelStyle,
    color: highlighted ? COLORS.err : labelStyle.color,
    textAlign: align,
    padding: align === "right" ? "6px 0" : undefined,
  };
  const inner = (
    <>
      {label}
      {required ? null : <span style={optionalTagStyle}>opt</span>}
    </>
  );
  if (labelFor !== undefined) {
    return (
      <label htmlFor={labelFor} style={style}>
        {inner}
      </label>
    );
  }
  return <span style={style}>{inner}</span>;
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

const leafGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "92px 1fr auto",
  columnGap: 10,
  rowGap: 2,
  alignItems: "center",
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
};

const leafBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};

const leafTrailingStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const groupChromeStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
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
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  color: COLORS.textDim,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const optionalTagStyle: CSSProperties = {
  display: "inline-block",
  marginLeft: 5,
  padding: "0 4px",
  borderRadius: 3,
  background: `${COLORS.muted}22`,
  color: COLORS.muted,
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: 0.5,
  textTransform: "uppercase",
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
