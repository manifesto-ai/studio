import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Play } from "lucide-react";
import { useStudio } from "@manifesto-ai/studio-react";
import type { EditIntentEnvelope } from "@manifesto-ai/studio-core";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { useTimeScrub } from "@/hooks/useTimeScrub";
import { cn } from "@/lib/cn";

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
  const { history, module } = useStudio();
  const { state: scrub, select, returnToNow, selectedEnvelopeId } =
    useTimeScrub();
  const [hovered, setHovered] = useState<string | null>(null);

  const ticks = useMemo(() => {
    if (history.length === 0) return [] as readonly EditIntentEnvelope[];
    // Keep the most recent 24 envelopes; the beam is a live status strip,
    // not an archival view (History lens handles that).
    return history.slice(-24);
  }, [history]);

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
              ticks.map((env, i) => {
                const isNow = i === ticks.length - 1;
                const isSelected = env.id === selectedEnvelopeId;
                return (
                  <Tooltip key={env.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onPointerEnter={() => setHovered(env.id)}
                        onPointerLeave={() =>
                          setHovered((h) => (h === env.id ? null : h))
                        }
                        onClick={() => {
                          if (isSelected) {
                            returnToNow();
                          } else if (isNow) {
                            returnToNow();
                          } else {
                            select(env.id);
                          }
                        }}
                        className="
                          relative flex items-center justify-center
                          h-full w-3 outline-none
                          focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)]
                          focus-visible:outline-offset-2 rounded-sm
                        "
                        aria-label={`Envelope ${env.id}`}
                        aria-pressed={isSelected}
                      >
                        <TickMark
                          active={hovered === env.id}
                          isNow={isNow}
                          isSelected={isSelected}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={10}>
                      <TickTooltipBody
                        env={env}
                        isNow={isNow}
                        isSelected={isSelected}
                      />
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
}: {
  readonly active: boolean;
  readonly isNow: boolean;
  readonly isSelected: boolean;
}): JSX.Element {
  const color = isSelected
    ? "var(--color-violet-hot)"
    : isNow
      ? "var(--color-violet-hot)"
      : active
        ? "var(--color-violet)"
        : "var(--color-rule-strong)";
  const size = isSelected ? 8 : isNow ? 7 : active ? 6 : 4;
  return (
    <motion.span
      layout
      aria-hidden
      className="block rounded-full"
      style={{
        width: size,
        height: size,
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
