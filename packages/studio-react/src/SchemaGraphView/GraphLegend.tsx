import { useState, type CSSProperties } from "react";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";

/**
 * Collapsible floating legend for the schema graph. Explains the node
 * glyphs (S / ƒ / A) and edge relation styles (feeds / mutates /
 * unlocks) so the visual grammar is discoverable.
 */
export function GraphLegend(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div style={legendStyle} data-testid="graph-legend">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={toggleStyle}
        aria-expanded={open}
        aria-label={open ? "Collapse legend" : "Expand legend"}
      >
        <span style={{ fontWeight: 600, letterSpacing: 0.6 }}>Legend</span>
        <span style={{ color: COLORS.textDim, fontSize: 10 }}>{open ? "–" : "+"}</span>
      </button>

      {open ? (
        <div style={bodyStyle}>
          <section>
            <header style={headerStyle}>Nodes</header>
            <ul style={listStyle}>
              <LegendRow glyph="S" glyphBg={COLORS.state} label="state" hint="stored field" />
              <LegendRow glyph="ƒ" glyphBg={COLORS.computed} label="computed" hint="derived" />
              <LegendRow glyph="A" glyphBg={COLORS.action} label="action" hint="intent handler" />
            </ul>
          </section>
          <section style={{ marginTop: 10 }}>
            <header style={headerStyle}>Edges</header>
            <ul style={listStyle}>
              <EdgeRow color={COLORS.textDim} dashed={false} label="feeds" hint="reads" />
              <EdgeRow color="#F59E0B" dashed={false} label="mutates" hint="writes" />
              <EdgeRow color={COLORS.muted} dashed label="unlocks" hint="availability" />
            </ul>
          </section>
          <section style={{ marginTop: 10 }}>
            <header style={headerStyle}>Plan</header>
            <ul style={listStyle}>
              <PlanRow color={COLORS.initialized} glyph="+" label="initialized" hint="new / retyped" />
              <PlanRow color={COLORS.discarded} glyph="–" label="discarded" hint="removed" />
              <PlanRow color={COLORS.accent} glyph="↦" label="renamed" hint="identity moved" />
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}

type LegendRowProps = {
  readonly glyph: string;
  readonly glyphBg: string;
  readonly label: string;
  readonly hint: string;
};

function LegendRow({ glyph, glyphBg, label, hint }: LegendRowProps): JSX.Element {
  return (
    <li style={rowStyle}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 4,
          background: glyphBg,
          color: "#0B1020",
          fontFamily: MONO_STACK,
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {glyph}
      </span>
      <span style={{ color: COLORS.text }}>{label}</span>
      <span style={{ color: COLORS.muted, marginLeft: "auto", fontSize: 10 }}>{hint}</span>
    </li>
  );
}

function PlanRow({
  color,
  glyph,
  label,
  hint,
}: {
  readonly color: string;
  readonly glyph: string;
  readonly label: string;
  readonly hint: string;
}): JSX.Element {
  return (
    <li style={rowStyle}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 8,
          background: color,
          color: "#0B1020",
          fontFamily: MONO_STACK,
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {glyph}
      </span>
      <span style={{ color: COLORS.text }}>{label}</span>
      <span style={{ color: COLORS.muted, marginLeft: "auto", fontSize: 10 }}>{hint}</span>
    </li>
  );
}

function EdgeRow({
  color,
  dashed,
  label,
  hint,
}: {
  readonly color: string;
  readonly dashed: boolean;
  readonly label: string;
  readonly hint: string;
}): JSX.Element {
  return (
    <li style={rowStyle}>
      <svg width={22} height={10} aria-hidden="true" style={{ display: "block" }}>
        <line
          x1={1}
          y1={5}
          x2={21}
          y2={5}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={dashed ? "3 2" : undefined}
        />
        <path d="M18,2 L22,5 L18,8 z" fill={color} />
      </svg>
      <span style={{ color: COLORS.text }}>{label}</span>
      <span style={{ color: COLORS.muted, marginLeft: "auto", fontSize: 10 }}>{hint}</span>
    </li>
  );
}

const legendStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  background: COLORS.panelAlt,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 8,
  fontFamily: FONT_STACK,
  fontSize: 11,
  color: COLORS.text,
  boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
  minWidth: 168,
};

const toggleStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 12px",
  background: "transparent",
  color: COLORS.text,
  border: "none",
  borderBottom: `1px solid ${COLORS.line}`,
  cursor: "pointer",
  fontFamily: FONT_STACK,
  fontSize: 11,
};

const bodyStyle: CSSProperties = {
  padding: "10px 12px",
};

const headerStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 1.4,
  textTransform: "uppercase",
  color: COLORS.muted,
  marginBottom: 6,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};
