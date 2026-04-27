/**
 * Visual primitives for tool-result rendering inside the Agent panel.
 *
 * Four shapes cover all 14 tools:
 *   - DiffRow       — a single `path  before → after` line
 *   - ChipCluster   — wrapped pills, color-coded by status
 *   - VerdictBlock  — a PASS / BLOCKED card with the failing guard
 *   - MiniTimeline  — vertical lineage list with intent labels
 *
 * Colours come straight from the existing `--color-sig-*` palette so the
 * agent panel speaks the same visual language as Lineage / Observatory.
 */
import type { JSX } from "react";

export type ChipTone = "state" | "action" | "computed" | "effect" | "neutral";

const TONE_FG: Record<ChipTone, string> = {
  state: "var(--color-sig-state)",
  action: "var(--color-sig-action)",
  computed: "var(--color-sig-computed)",
  effect: "var(--color-sig-effect)",
  neutral: "var(--color-ink-mute)",
};

const TONE_BG: Record<ChipTone, string> = {
  state: "color-mix(in oklch, var(--color-sig-state) 14%, transparent)",
  action: "color-mix(in oklch, var(--color-sig-action) 14%, transparent)",
  computed: "color-mix(in oklch, var(--color-sig-computed) 14%, transparent)",
  effect: "color-mix(in oklch, var(--color-sig-effect) 16%, transparent)",
  neutral: "color-mix(in oklch, var(--color-rule) 60%, transparent)",
};

export type Chip = {
  readonly label: string;
  readonly tone?: ChipTone;
  readonly title?: string;
};

export function ChipCluster({
  chips,
}: {
  readonly chips: readonly Chip[];
}): JSX.Element | null {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <span
          key={`${chip.label}-${i}`}
          title={chip.title}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] px-2 py-[2px] font-mono text-[10.5px]"
          style={{
            color: TONE_FG[chip.tone ?? "neutral"],
            background: TONE_BG[chip.tone ?? "neutral"],
            border: "1px solid color-mix(in oklch, currentColor 22%, transparent)",
          }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

export type DiffRowProps = {
  readonly path: string;
  readonly before?: unknown;
  readonly after?: unknown;
  /** When true, treat as `path changed` instead of before→after. */
  readonly pathOnly?: boolean;
};

export function DiffRow({
  path,
  before,
  after,
  pathOnly,
}: DiffRowProps): JSX.Element {
  return (
    <div className="flex items-baseline gap-2 font-mono text-[11px] leading-relaxed">
      <span className="text-[var(--color-ink-dim)] truncate min-w-0">
        {path}
      </span>
      {pathOnly === true ? (
        <span className="text-[var(--color-sig-action)] ml-auto whitespace-nowrap">
          changed
        </span>
      ) : (
        <span className="ml-auto flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[var(--color-sig-state)]">
            {formatScalar(before)}
          </span>
          <span className="text-[var(--color-ink-faint)]">→</span>
          <span className="text-[var(--color-sig-action)]">
            {formatScalar(after)}
          </span>
        </span>
      )}
    </div>
  );
}

export type VerdictBlockProps = {
  readonly verdict: "PASS" | "BLOCKED" | "INVALID";
  readonly title: string;
  readonly reason?: string;
  readonly guardExpression?: string;
  readonly evaluatedResult?: unknown;
};

export function VerdictBlock({
  verdict,
  title,
  reason,
  guardExpression,
  evaluatedResult,
}: VerdictBlockProps): JSX.Element {
  const tone: ChipTone =
    verdict === "PASS" ? "state" : verdict === "INVALID" ? "effect" : "effect";
  return (
    <div
      className="rounded-[8px] px-3 py-2 font-mono text-[11.5px]"
      style={{
        background: TONE_BG[tone],
        border: `1px solid color-mix(in oklch, ${TONE_FG[tone]} 28%, transparent)`,
      }}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="text-[10.5px] font-semibold tracking-wider"
          style={{ color: TONE_FG[tone] }}
        >
          {verdict}
        </span>
        <span className="text-[var(--color-ink)] truncate">{title}</span>
      </div>
      {guardExpression !== undefined ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-2 text-[11px]">
          <span className="text-[var(--color-ink-mute)]">guard</span>
          <span className="text-[var(--color-ink-dim)] break-all">
            {guardExpression}
          </span>
          {evaluatedResult !== undefined ? (
            <>
              <span className="text-[var(--color-ink-faint)]">=</span>
              <span style={{ color: TONE_FG[tone] }}>
                {formatScalar(evaluatedResult)}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      {reason !== undefined && reason !== "" ? (
        <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          {reason}
        </div>
      ) : null}
    </div>
  );
}

export type TimelineEntry = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly tone?: ChipTone;
};

export function MiniTimeline({
  entries,
}: {
  readonly entries: readonly TimelineEntry[];
}): JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <ol className="flex flex-col">
      {entries.map((entry, i) => {
        const tone = entry.tone ?? "computed";
        const isLast = i === entries.length - 1;
        return (
          <li key={entry.id} className="flex gap-2.5 min-h-[22px]">
            <div className="flex flex-col items-center pt-[5px]">
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{
                  background: TONE_FG[tone],
                  boxShadow: `0 0 6px ${TONE_FG[tone]}`,
                }}
              />
              {!isLast ? (
                <span
                  className="w-px flex-1 mt-1"
                  style={{
                    background: `color-mix(in oklch, ${TONE_FG[tone]} 30%, transparent)`,
                  }}
                />
              ) : null}
            </div>
            <div className="flex-1 min-w-0 pb-2 font-mono text-[11px] leading-relaxed">
              <div className="flex items-baseline gap-2">
                <span className="text-[var(--color-ink)] truncate">
                  {entry.label}
                </span>
                {entry.hint !== undefined ? (
                  <span className="text-[var(--color-ink-mute)] truncate">
                    {entry.hint}
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function formatScalar(value: unknown): string {
  if (value === undefined) return "·";
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.length > 32 ? `"${value.slice(0, 29)}..."` : `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    return `{${keys.length}}`;
  }
  return String(value);
}
