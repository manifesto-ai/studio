import type { CSSProperties } from "react";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import type {
  IntentExplanation,
  Snapshot,
  StudioDispatchResult,
  StudioSimulateResult,
} from "@manifesto-ai/studio-core";

export type SimulatePreviewProps = {
  readonly beforeSnapshot: Snapshot<unknown> | null;
  readonly result?: StudioSimulateResult | null;
  readonly explanation?: IntentExplanation | null;
  readonly dispatchResult?: StudioDispatchResult | null;
  readonly stale?: boolean;
};

/**
 * Renders the current interaction insight inline in the Interact panel.
 * The card summarizes legality, projected impact, availability deltas,
 * host requirements, and the latest simulate/dispatch outcome.
 */
export function SimulatePreview({
  beforeSnapshot,
  result = null,
  explanation = null,
  dispatchResult = null,
  stale = false,
}: SimulatePreviewProps): JSX.Element | null {
  if (stale) return null;
  const insight = buildInsight({
    beforeSnapshot,
    result,
    explanation,
    dispatchResult,
  });
  if (insight === null) return null;

  return (
    <div style={rootStyle} data-testid="intent-insight">
      <header style={headerStyle}>
        <span style={dotStyle(insight.tone)} />
        <span style={{ fontWeight: 600 }}>Intent Insight</span>
        <span style={statusLabelStyle(insight.tone)}>{insight.outcomeLabel}</span>
        <span style={{ marginLeft: "auto", color: COLORS.muted, fontSize: 10.5 }}>
          {insight.changedPaths.length} path
          {insight.changedPaths.length === 1 ? "" : "s"}
        </span>
      </header>

      <Section title="Legality">
        <div style={pillRowStyle}>
          <Pill label={`available ${flagLabel(insight.available)}`} tone={insight.available ? "ok" : "err"} />
          <Pill
            label={`dispatchable ${flagLabel(insight.dispatchable)}`}
            tone={insight.dispatchable ? "ok" : "err"}
          />
          {insight.actionName !== null ? (
            <Pill label={insight.actionName} tone="neutral" mono />
          ) : null}
        </div>
      </Section>

      <Section title="Impact">
        {insight.changedPaths.length === 0 ? (
          <div style={emptyHintStyle}>(no projected snapshot change)</div>
        ) : (
          <ul style={pathListStyle}>
            {insight.changedPaths.map((path) => (
              <PathRow
                key={path}
                path={path}
                before={resolvePath(insight.beforeRoot, path)}
                after={resolvePath(insight.afterRoot, path)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Availability">
        {insight.unlocked.length === 0 && insight.locked.length === 0 ? (
          <div style={emptyHintStyle}>(no availability change)</div>
        ) : (
          <div style={availabilityStackStyle}>
            {insight.unlocked.length > 0 ? (
              <AvailabilityRow
                label="Unlocked"
                items={insight.unlocked}
                tone="ok"
              />
            ) : null}
            {insight.locked.length > 0 ? (
              <AvailabilityRow
                label="Locked"
                items={insight.locked}
                tone="err"
              />
            ) : null}
          </div>
        )}
      </Section>

      <Section title={`Requirements (${insight.requirements.length})`}>
        <div style={requirementsHeaderStyle}>
          <Pill label={`status ${insight.status}`} tone={statusTone(insight.status)} mono />
        </div>
        {insight.requirements.length === 0 ? (
          <div style={emptyHintStyle}>(no host effects)</div>
        ) : (
          <ul style={reqListStyle}>
            {insight.requirements.map((r) => (
              <li key={r.id} style={reqRowStyle}>
                <code style={reqTypeStyle}>{r.type}</code>
                <code style={reqParamsStyle}>
                  {truncate(JSON.stringify(r.params) ?? "undefined")}
                </code>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Outcome">
        <div style={outcomeStyle}>{insight.outcomeSummary}</div>
      </Section>
    </div>
  );
}

type InsightBuildInput = {
  readonly beforeSnapshot: Snapshot<unknown> | null;
  readonly result: StudioSimulateResult | null;
  readonly explanation: IntentExplanation | null;
  readonly dispatchResult: StudioDispatchResult | null;
};

type InsightTone = "ok" | "warn" | "err" | "neutral";

type InsightModel = {
  readonly tone: InsightTone;
  readonly actionName: string | null;
  readonly available: boolean;
  readonly dispatchable: boolean;
  readonly changedPaths: readonly string[];
  readonly unlocked: readonly string[];
  readonly locked: readonly string[];
  readonly requirements: readonly (StudioSimulateResult["requirements"][number])[];
  readonly status: string;
  readonly beforeRoot: unknown;
  readonly afterRoot: unknown;
  readonly outcomeLabel: string;
  readonly outcomeSummary: string;
};

function buildInsight({
  beforeSnapshot,
  result,
  explanation,
  dispatchResult,
}: InsightBuildInput): InsightModel | null {
  if (dispatchResult?.kind === "completed") {
    const diff = dispatchResult.outcome.projected;
    const delta = diff.availability;
    const isNoop =
      diff.changedPaths.length === 0 &&
      delta.unlocked.length === 0 &&
      delta.locked.length === 0;
    return {
      tone: isNoop ? "warn" : "ok",
      actionName: dispatchResult.admission.actionName,
      available: true,
      dispatchable: true,
      changedPaths: sortPaths(diff.changedPaths),
      unlocked: delta.unlocked.map(String),
      locked: delta.locked.map(String),
      requirements: dispatchResult.outcome.canonical.pendingRequirements,
      status: String(dispatchResult.outcome.canonical.status),
      beforeRoot: diff.beforeSnapshot,
      afterRoot: diff.afterSnapshot,
      outcomeLabel: isNoop ? "noop dispatch" : "dispatch completed",
      outcomeSummary: isNoop
        ? "dispatch completed without projected state or availability changes"
        : `dispatch completed · ${dispatchResult.traceIds.length} trace${dispatchResult.traceIds.length === 1 ? "" : "s"}`,
    };
  }

  if (dispatchResult?.kind === "rejected") {
    const failure = dispatchResult.admission.failure;
    const available = failure.kind === "not_dispatchable";
    return {
      tone: "err",
      actionName: dispatchResult.admission.actionName,
      available,
      dispatchable: false,
      changedPaths: [],
      unlocked: [],
      locked: [],
      requirements: [],
      status: "blocked",
      beforeRoot: dispatchResult.beforeSnapshot,
      afterRoot: dispatchResult.beforeSnapshot,
      outcomeLabel: "dispatch rejected",
      outcomeSummary: dispatchResult.rejection.reason,
    };
  }

  if (explanation?.kind === "blocked") {
    return {
      tone: "err",
      actionName: explanation.actionName,
      available: explanation.available,
      dispatchable: explanation.dispatchable,
      changedPaths: [],
      unlocked: [],
      locked: [],
      requirements: [],
      status: "blocked",
      beforeRoot: beforeSnapshot,
      afterRoot: beforeSnapshot,
      outcomeLabel: "simulate blocked",
      outcomeSummary: explanation.available
        ? "simulate skipped — intent is not dispatchable"
        : "simulate skipped — action is unavailable",
    };
  }

  if (explanation?.kind === "admitted") {
    const after = result?.snapshot ?? explanation.snapshot;
    return {
      tone: "warn",
      actionName: explanation.actionName,
      available: explanation.available,
      dispatchable: explanation.dispatchable,
      changedPaths: sortPaths(result?.changedPaths ?? explanation.changedPaths),
      unlocked: (result?.newAvailableActions ?? explanation.newAvailableActions).map(String),
      locked: [],
      requirements: result?.requirements ?? explanation.requirements,
      status: String(result?.status ?? explanation.status),
      beforeRoot: beforeSnapshot,
      afterRoot: after,
      outcomeLabel: "simulate preview",
      outcomeSummary: "projected state and availability before dispatch",
    };
  }

  return null;
}

function PathRow({
  path,
  before,
  after,
}: {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}): JSX.Element {
  return (
    <li style={pathRowStyle}>
      <code style={pathLabelStyle}>{path}</code>
      <div style={diffBoxStyle}>
        <code style={beforeValueStyle}>{formatValue(before)}</code>
        <span style={arrowStyle}>→</span>
        <code style={afterValueStyle}>{formatValue(after)}</code>
      </div>
    </li>
  );
}

function AvailabilityRow({
  label,
  items,
  tone,
}: {
  readonly label: string;
  readonly items: readonly string[];
  readonly tone: "ok" | "err";
}): JSX.Element {
  return (
    <div style={availabilityRowStyle}>
      <span style={availabilityLabelStyle}>{label}</span>
      <ul style={chipListStyle}>
        {items.map((item) => (
          <li key={`${label}:${item}`}>
            <Pill label={item} tone={tone} mono />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section style={sectionStyle}>
      <header style={sectionHeaderStyle}>{title}</header>
      {children}
    </section>
  );
}

function Pill({
  label,
  tone,
  mono = false,
}: {
  readonly label: string;
  readonly tone: InsightTone;
  readonly mono?: boolean;
}): JSX.Element {
  return (
    <span
      style={{
        ...pillStyle,
        ...pillToneStyle(tone),
        fontFamily: mono ? MONO_STACK : FONT_STACK,
      }}
    >
      {label}
    </span>
  );
}

function resolvePath(root: unknown, path: string): unknown {
  if (root === null || root === undefined) return undefined;
  const segments = tokenizePath(path);
  let current: unknown = root;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(seg);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function tokenizePath(path: string): readonly string[] {
  return path
    .replace(/\[([^\]]+)\]/g, (_, raw: string) => {
      const next = raw.replace(/^["']|["']$/g, "");
      return `.${next}`;
    })
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== "$");
}

function sortPaths(paths: readonly string[]): readonly string[] {
  return [...paths].sort((left, right) => {
    const leftRank = namespaceRank(left);
    const rightRank = namespaceRank(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });
}

function namespaceRank(path: string): number {
  const head = tokenizePath(path)[0] ?? "";
  switch (head) {
    case "data":
      return 0;
    case "computed":
      return 1;
    case "system":
      return 2;
    default:
      return 3;
  }
}

function flagLabel(value: boolean): string {
  return value ? "yes" : "no";
}

function formatValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  try {
    const s = JSON.stringify(v);
    return truncate(s);
  } catch {
    return "(value)";
  }
}

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function statusTone(status: string): InsightTone {
  if (status === "error" || status === "blocked") return "err";
  if (status === "settled" || status === "idle") return "ok";
  if (status === "computing" || status === "pending") return "warn";
  return "neutral";
}

function dotStyle(tone: InsightTone): CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: 4,
    background: toneColor(tone),
    display: "inline-block",
  };
}

function statusLabelStyle(tone: InsightTone): CSSProperties {
  return {
    fontSize: 10.5,
    color: toneColor(tone),
    letterSpacing: 0.6,
    textTransform: "uppercase",
  };
}

function pillToneStyle(tone: InsightTone): CSSProperties {
  return {
    background: `${toneColor(tone)}22`,
    color: toneColor(tone),
    border: `1px solid ${toneColor(tone)}33`,
  };
}

function toneColor(tone: InsightTone): string {
  switch (tone) {
    case "ok":
      return COLORS.preserved;
    case "warn":
      return COLORS.warn;
    case "err":
      return COLORS.err;
    default:
      return COLORS.textDim;
  }
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "10px 12px",
  background: COLORS.panelAlt,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const sectionHeaderStyle: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: COLORS.muted,
};

const pillRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 8px",
  borderRadius: 999,
  fontSize: 10.5,
};

const pathListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const pathRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const pathLabelStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: 10.5,
  color: COLORS.textDim,
};

const diffBoxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: MONO_STACK,
  fontSize: 11,
};

const beforeValueStyle: CSSProperties = {
  color: COLORS.muted,
  textDecoration: "line-through",
  background: COLORS.bg,
  padding: "2px 5px",
  borderRadius: 3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "48%",
};

const afterValueStyle: CSSProperties = {
  color: COLORS.preserved,
  background: COLORS.bg,
  padding: "2px 5px",
  borderRadius: 3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "48%",
};

const arrowStyle: CSSProperties = {
  color: COLORS.muted,
  fontSize: 11,
};

const availabilityStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const availabilityRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const availabilityLabelStyle: CSSProperties = {
  fontSize: 10.5,
  color: COLORS.textDim,
};

const chipListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const requirementsHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
};

const reqListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const reqRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "baseline",
  fontFamily: MONO_STACK,
  fontSize: 10.5,
};

const reqTypeStyle: CSSProperties = {
  color: COLORS.warn,
};

const reqParamsStyle: CSSProperties = {
  color: COLORS.textDim,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

const outcomeStyle: CSSProperties = {
  fontSize: 11.5,
  color: COLORS.text,
};

const emptyHintStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.muted,
  fontStyle: "italic",
};
