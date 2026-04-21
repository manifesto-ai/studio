import { type CSSProperties, useMemo } from "react";
import { formatPlan } from "@manifesto-ai/studio-core";
import { useStudio } from "./useStudio.js";
import type { IdentityFate, LocalTargetKey } from "@manifesto-ai/studio-core";
import {
  COLORS,
  MONO_STACK,
  PANEL_BODY,
  PANEL_EMPTY,
  PANEL_HEADER,
  SECTION_LABEL,
} from "./style-tokens.js";

type Bucket = {
  readonly label: string;
  readonly color: string;
  readonly count: number;
  readonly keys: readonly LocalTargetKey[];
};

function buildBuckets(
  map: ReadonlyMap<LocalTargetKey, IdentityFate>,
): readonly Bucket[] {
  const preserved: LocalTargetKey[] = [];
  const initialized: LocalTargetKey[] = [];
  const discarded: LocalTargetKey[] = [];
  const renamed: LocalTargetKey[] = [];
  for (const [key, fate] of map.entries()) {
    switch (fate.kind) {
      case "preserved":
        preserved.push(key);
        break;
      case "initialized":
        initialized.push(key);
        break;
      case "discarded":
        discarded.push(key);
        break;
      case "renamed":
        renamed.push(key);
        break;
    }
  }
  return [
    { label: "preserved", color: COLORS.preserved, count: preserved.length, keys: preserved.sort() },
    { label: "initialized", color: COLORS.initialized, count: initialized.length, keys: initialized.sort() },
    { label: "discarded", color: COLORS.discarded, count: discarded.length, keys: discarded.sort() },
    { label: "renamed", color: COLORS.muted, count: renamed.length, keys: renamed.sort() },
  ];
}

function hashShort(hash: string | null): string {
  if (hash === null) return "∅";
  return hash.length <= 10 ? hash : `${hash.slice(0, 8)}…`;
}

export function PlanPanel(): JSX.Element {
  const { plan } = useStudio();

  const buckets = useMemo(
    () => (plan === null ? null : buildBuckets(plan.identityMap)),
    [plan],
  );
  const rawText = useMemo(
    () => (plan === null ? "" : formatPlan(plan, { maxPerBucket: 40 })),
    [plan],
  );

  return (
    <div style={rootStyle}>
      <div style={PANEL_HEADER}>
        <span>Plan</span>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>
          {plan === null
            ? "—"
            : `${hashShort(plan.prevSchemaHash)} → ${hashShort(plan.nextSchemaHash)}`}
        </span>
      </div>
      <div style={PANEL_BODY}>
        {plan === null || buckets === null ? (
          <div style={PANEL_EMPTY}>No plan yet. Build to generate a reconciliation plan.</div>
        ) : (
          <>
            <section style={sectionStyle}>
              <div style={SECTION_LABEL}>Identity</div>
              <div style={bucketsRowStyle}>
                {buckets.map((b) => (
                  <div key={b.label} style={bucketChipStyle(b.color)}>
                    <span style={{ color: b.color, fontWeight: 600 }}>
                      {b.count}
                    </span>
                    <span style={{ color: COLORS.textDim }}>{b.label}</span>
                  </div>
                ))}
              </div>
            </section>
            <section style={sectionStyle}>
              <div style={SECTION_LABEL}>Snapshot</div>
              <BucketList label="preserved" keys={plan.snapshotPlan.preserved} color={COLORS.preserved} />
              <BucketList label="initialized" keys={plan.snapshotPlan.initialized} color={COLORS.initialized} />
              <BucketList label="discarded" keys={plan.snapshotPlan.discarded} color={COLORS.discarded} />
            </section>
            <section style={sectionStyle}>
              <div style={SECTION_LABEL}>Traces</div>
              <div style={bucketsRowStyle}>
                <span style={bucketChipStyle(COLORS.preserved)}>
                  <span style={{ color: COLORS.preserved, fontWeight: 600 }}>
                    {plan.traceTag.stillValid.length}
                  </span>
                  <span style={{ color: COLORS.textDim }}>stillValid</span>
                </span>
                <span style={bucketChipStyle(COLORS.discarded)}>
                  <span style={{ color: COLORS.discarded, fontWeight: 600 }}>
                    {plan.traceTag.obsolete.length}
                  </span>
                  <span style={{ color: COLORS.textDim }}>obsolete</span>
                </span>
                <span style={bucketChipStyle(COLORS.muted)}>
                  <span style={{ color: COLORS.muted, fontWeight: 600 }}>
                    {plan.traceTag.renamed.length}
                  </span>
                  <span style={{ color: COLORS.textDim }}>renamed</span>
                </span>
              </div>
            </section>
            <details style={detailsStyle}>
              <summary style={{ cursor: "pointer", color: COLORS.accent, fontSize: 11 }}>
                raw formatPlan(plan)
              </summary>
              <pre style={rawStyle} data-testid="raw-plan">
                {rawText}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function BucketList({
  label,
  keys,
  color,
}: {
  readonly label: string;
  readonly keys: readonly LocalTargetKey[];
  readonly color: string;
}): JSX.Element {
  if (keys.length === 0) return <></>;
  return (
    <div style={bucketListStyle}>
      <span style={{ color, fontSize: 11, fontWeight: 600 }}>
        {label} ({keys.length})
      </span>
      <ul style={keyListStyle}>
        {keys.map((k) => (
          <li key={k} style={keyItemStyle}>
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: COLORS.panel,
  minHeight: 0,
};
const sectionStyle: CSSProperties = {
  padding: "14px 14px 0",
};
const bucketsRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 6,
  marginBottom: 4,
};
const bucketChipStyle = (border: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  border: `1px solid ${border}`,
  borderRadius: 12,
  fontSize: 11,
  background: COLORS.panelAlt,
});
const bucketListStyle: CSSProperties = {
  marginTop: 8,
  paddingLeft: 6,
  borderLeft: `1px solid ${COLORS.line}`,
};
const keyListStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "4px 0 8px",
  fontFamily: MONO_STACK,
  fontSize: 11,
  color: COLORS.text,
};
const keyItemStyle: CSSProperties = {
  padding: "2px 0",
};
const detailsStyle: CSSProperties = {
  margin: "14px",
  padding: "8px 10px",
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  background: COLORS.panelAlt,
};
const rawStyle: CSSProperties = {
  marginTop: 6,
  padding: 10,
  background: COLORS.bg,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  fontFamily: MONO_STACK,
  fontSize: 10,
  color: COLORS.text,
  overflow: "auto",
  whiteSpace: "pre",
  maxHeight: 240,
};
