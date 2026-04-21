import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Play } from "lucide-react";
import {
  useStudio,
  type DispatchDiff,
  type DispatchHistoryEntry,
} from "@manifesto-ai/studio-react";
import type { EditIntentEnvelope } from "@manifesto-ai/studio-core";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { useTimeScrub } from "@/hooks/useTimeScrub";
import { cn } from "@/lib/cn";

type TimelineTick =
  | {
      readonly kind: "edit";
      readonly key: string;
      readonly timestamp: number;
      readonly env: EditIntentEnvelope;
    }
  | {
      readonly kind: "dispatch";
      readonly key: string;
      readonly timestamp: number;
      readonly entry: DispatchHistoryEntry;
    };

/**
 * NowLine — the signature element of Deterministic Observatory.
 *
 * A slim horizontal beam across the bottom of the app. Every compile
 * (edit envelope) becomes a tick. The rightmost tick is "now". This
 * surfaces Manifesto's temporal dimension at all times: determinism is
 * no longer hidden, it is the chrome.
 *
 * In Phase 1 we only render the beam; scrubbing-to-past lands with
 * replay-from-here (P1-G8).
 */
export function NowLine(): JSX.Element {
  const { history, dispatchHistory, module } = useStudio();
  const { state: scrub, select, returnToNow, selectedEnvelopeId } =
    useTimeScrub();
  const [hovered, setHovered] = useState<string | null>(null);

  const ticks = useMemo<readonly TimelineTick[]>(() => {
    if (history.length === 0 && dispatchHistory.length === 0) return [];
    const merged: TimelineTick[] = [
      ...history.map((env) => ({
        kind: "edit" as const,
        key: `edit:${env.id}`,
        timestamp: env.timestamp,
        env,
      })),
      ...dispatchHistory.map((entry) => ({
        kind: "dispatch" as const,
        key: `dispatch:${entry.id}`,
        timestamp: entry.recordedAt,
        entry,
      })),
    ];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    // Keep the most recent 24 ticks; the beam is a live status strip,
    // not an archival view (Dispatches lens handles the full log).
    return merged.slice(-24);
  }, [history, dispatchHistory]);

  const now = ticks[ticks.length - 1];
  const scrubbing = scrub.mode === "past";

  return (
    <TooltipProvider delayDuration={120}>
      <div
        className={cn(
          "relative flex items-center gap-3 px-3",
          "h-[28px] shrink-0",
          "border-t border-[var(--color-rule)]",
          "bg-[color-mix(in_oklch,var(--color-void)_80%,transparent)]",
          "backdrop-blur-2xl",
          scrubbing &&
            "bg-[color-mix(in_oklch,var(--color-violet)_14%,var(--color-void))]",
        )}
      >
        {/* Beam */}
        <div className="relative flex-1 h-full flex items-center">
          <div className="measure-line absolute inset-x-0 top-1/2 -translate-y-1/2" />
          <div className="relative flex-1 flex items-center justify-between gap-1">
            {ticks.length === 0 ? null : (
              ticks.map((tick, i) => {
                const isNow = i === ticks.length - 1;
                const isSelected =
                  tick.kind === "edit" && tick.env.id === selectedEnvelopeId;
                return (
                  <Tooltip key={tick.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onPointerEnter={() => setHovered(tick.key)}
                        onPointerLeave={() =>
                          setHovered((h) => (h === tick.key ? null : h))
                        }
                        onClick={() => {
                          if (tick.kind === "dispatch") {
                            // Dispatch ticks aren't time-scrub anchors —
                            // SDK replay consumes edit envelopes only.
                            // Clicking one just drops back to live.
                            returnToNow();
                            return;
                          }
                          if (isSelected || isNow) {
                            returnToNow();
                          } else {
                            select(tick.env.id);
                          }
                        }}
                        className="
                          relative flex items-center justify-center
                          h-full w-3 outline-none
                          focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)]
                          focus-visible:outline-offset-2 rounded-sm
                        "
                        aria-label={
                          tick.kind === "edit"
                            ? `Envelope ${tick.env.id}`
                            : `Dispatch ${tick.entry.intentType}`
                        }
                        aria-pressed={isSelected}
                        data-tick-kind={tick.kind}
                      >
                        <TickMark
                          active={hovered === tick.key}
                          isNow={isNow}
                          isSelected={isSelected}
                          kind={tick.kind}
                          status={
                            tick.kind === "dispatch"
                              ? tick.entry.status
                              : undefined
                          }
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={10}>
                      {tick.kind === "edit" ? (
                        <TickTooltipBody
                          env={tick.env}
                          isNow={isNow}
                          isSelected={isSelected}
                        />
                      ) : (
                        <DispatchTooltipBody entry={tick.entry} isNow={isNow} />
                      )}
                    </TooltipContent>
                  </Tooltip>
                );
              })
            )}
          </div>
        </div>

        {/* Right — readout + return-to-now */}
        {scrubbing ? (
          <button
            type="button"
            onClick={returnToNow}
            className="
              flex items-center gap-1.5 h-5 px-2 rounded-md
              bg-[color-mix(in_oklch,var(--color-violet)_22%,transparent)]
              border border-[var(--color-violet-hot)]
              hover:bg-[color-mix(in_oklch,var(--color-violet)_34%,transparent)]
              font-sans text-[10px] font-medium tracking-[0.04em] uppercase
              text-[var(--color-violet-hot)]
              transition-colors
              outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)]
              focus-visible:outline-offset-2
            "
          >
            <Play className="h-[9px] w-[9px] fill-current" />
            Return to now
          </button>
        ) : (
          <span className="font-mono text-[10.5px] text-[var(--color-ink-dim)] shrink-0">
            {now !== undefined
              ? formatTime(now.timestamp)
              : module === null
                ? "—"
                : "fresh"}
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}

function TickMark({
  active,
  isNow,
  isSelected,
  kind,
  status,
}: {
  readonly active: boolean;
  readonly isNow: boolean;
  readonly isSelected: boolean;
  readonly kind: TimelineTick["kind"];
  readonly status?: DispatchHistoryEntry["status"];
}): JSX.Element {
  // Edit ticks use the violet temporal palette (the "time axis" identity).
  // Dispatch ticks reuse the Observatory status colors so successful /
  // rejected / failed transitions read at a glance.
  const baseColor =
    kind === "edit"
      ? "var(--color-rule-strong)"
      : status === "completed"
        ? "var(--color-sig-action)"
        : status === "rejected"
          ? "var(--color-sig-determ)"
          : "var(--color-sig-effect)";
  const hotColor =
    kind === "edit" ? "var(--color-violet-hot)" : baseColor;
  const color = isSelected
    ? "var(--color-violet-hot)"
    : isNow
      ? hotColor
      : active
        ? kind === "edit"
          ? "var(--color-violet)"
          : baseColor
        : baseColor;
  // Dispatch ticks render as a small square to visually distinguish from
  // the circular edit ticks without needing a legend.
  const isDispatch = kind === "dispatch";
  const size = isSelected ? 8 : isNow ? 7 : active ? 6 : 4;
  return (
    <motion.span
      layout
      aria-hidden
      className={isDispatch ? "block" : "block rounded-full"}
      style={{
        width: size,
        height: size,
        borderRadius: isDispatch ? 1 : undefined,
        background: color,
        boxShadow:
          isSelected || isNow
            ? `0 0 12px ${color}`
            : active
              ? `0 0 8px ${color}`
              : "none",
        outline: isSelected
          ? `1px solid var(--color-violet-hot)`
          : undefined,
        outlineOffset: isSelected ? "2px" : undefined,
      }}
      transition={{ duration: 0.15 }}
    />
  );
}

function DispatchTooltipBody({
  entry,
  isNow,
}: {
  readonly entry: DispatchHistoryEntry;
  readonly isNow: boolean;
}): JSX.Element {
  const statusLabel =
    entry.status === "completed"
      ? "completed"
      : entry.status === "rejected"
        ? `rejected · ${entry.rejectionCode?.toLowerCase().replace(/_/g, " ") ?? "blocked"}`
        : "failed";
  const statusColor =
    entry.status === "completed"
      ? "text-[var(--color-sig-action)]"
      : entry.status === "rejected"
        ? "text-[var(--color-sig-determ)]"
        : "text-[var(--color-sig-effect)]";
  const detail =
    entry.status === "completed"
      ? entry.changedPaths.length === 0
        ? "no state change"
        : `${entry.changedPaths.length} path${entry.changedPaths.length === 1 ? "" : "s"} changed`
      : entry.status === "failed"
        ? entry.failureMessage ?? "execution failed"
        : "blocked before execution";
  const diffs = entry.diffs ?? [];
  const extraDiffs = Math.max(
    0,
    entry.changedPaths.length - diffs.length,
  );
  return (
    <div className="flex flex-col gap-1 min-w-[240px] max-w-[360px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] text-[var(--color-ink)]">
          dispatch · {entry.intentType}
        </span>
        <span
          className={`font-sans text-[10px] font-medium tracking-[0.04em] uppercase ${
            isNow
              ? "text-[var(--color-violet-hot)]"
              : "text-[var(--color-ink-mute)]"
          }`}
        >
          {isNow ? "now" : formatTime(entry.recordedAt)}
        </span>
      </div>
      <div className={`font-mono text-[10px] ${statusColor}`}>{statusLabel}</div>
      <div className="font-mono text-[10px] text-[var(--color-ink-mute)]">
        {detail}
      </div>
      {diffs.length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-[10px] leading-[1.35] border-t border-[var(--color-rule)] pt-1.5">
          {diffs.map((d) => (
            <DispatchDiffRow key={d.path} diff={d} />
          ))}
          {extraDiffs > 0 ? (
            <div className="text-[var(--color-ink-mute)] mt-0.5">
              … +{extraDiffs} more path{extraDiffs === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DispatchDiffRow({ diff }: { readonly diff: DispatchDiff }): JSX.Element {
  const before = formatDiffValue(diff.before);
  const after = formatDiffValue(diff.after);
  // When the value is unchanged textually (e.g. object identity
  // changed but stringify collapses to the same output), hide the
  // `-` row so we don't show noise.
  const sameText = before === after;
  return (
    <div className="flex flex-col gap-0">
      <div className="text-[var(--color-ink-dim)] truncate" title={diff.path}>
        {diff.path}
      </div>
      {!sameText ? (
        <div className="text-[var(--color-err)] truncate" title={before}>
          <span className="text-[var(--color-err)] mr-1">−</span>
          {before}
        </div>
      ) : null}
      <div className="text-[var(--color-sig-action)] truncate" title={after}>
        <span className="text-[var(--color-sig-action)] mr-1">+</span>
        {after}
      </div>
    </div>
  );
}

function formatDiffValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return String(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  } catch {
    return String(v);
  }
}

function TickTooltipBody({
  env,
  isNow,
  isSelected,
}: {
  readonly env: EditIntentEnvelope;
  readonly isNow: boolean;
  readonly isSelected: boolean;
}): JSX.Element {
  const rightLabel = isSelected
    ? "viewing"
    : isNow
      ? "now"
      : formatTime(env.timestamp);
  const rightColor = isSelected
    ? "text-[var(--color-violet-hot)]"
    : isNow
      ? "text-[var(--color-violet-hot)]"
      : "text-[var(--color-ink-mute)]";
  return (
    <div className="flex flex-col gap-1 min-w-[200px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] text-[var(--color-ink)]">
          {env.payloadKind}
        </span>
        <span
          className={`font-sans text-[10px] font-medium tracking-[0.04em] uppercase ${rightColor}`}
        >
          {rightLabel}
        </span>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-ink-dim)]">
        <span>{shortHash(env.prevSchemaHash)}</span>
        <span className="text-[var(--color-ink-mute)]">→</span>
        <span className="text-[var(--color-ink)]">
          {shortHash(env.nextSchemaHash)}
        </span>
      </div>
      <div className="font-mono text-[10px] text-[var(--color-ink-mute)]">
        {env.author}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shortHash(hash: string | null): string {
  if (hash === null) return "∅";
  return hash.length <= 7 ? hash : hash.slice(0, 7);
}
