import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SimulationPlaybackController } from "./useSimulationPlayback";

/**
 * Floating playback controls for simulation step-through. Renders at
 * the top of LiveGraph whenever a simulation has active steps (status
 * ≠ "idle"). State machine + pulse live in the controller; this
 * component is pure UI over that.
 */
export function PlaybackControlBar({
  controller,
}: {
  readonly controller: SimulationPlaybackController;
}): JSX.Element | null {
  const {
    status,
    currentStep,
    totalSteps,
    speed,
    play,
    pause,
    next,
    prev,
    reset,
    setSpeed,
  } = controller;

  if (status === "idle" || totalSteps === 0) return null;

  const isPlaying = status === "playing";
  const isDone = status === "done";
  const atStart = currentStep <= 0;
  const atEnd = currentStep >= totalSteps - 1;
  const stepLabel = isDone
    ? `${totalSteps} / ${totalSteps}`
    : `${Math.max(0, currentStep) + 1} / ${totalSteps}`;

  return (
    <div
      role="group"
      aria-label="Simulation playback controls"
      className="
        absolute top-3 left-1/2 -translate-x-1/2 z-20
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
        bg-[color-mix(in_oklch,var(--color-void-hi,#1A2036)_92%,var(--color-violet,#9f7bff))]
        border border-[color-mix(in_oklch,var(--color-violet)_45%,transparent)]
        shadow-[0_6px_24px_color-mix(in_oklch,var(--color-violet,#9f7bff)_26%,transparent)]
        backdrop-blur-xl
        font-mono text-[11px] text-[var(--color-ink)]
        select-none
      "
    >
      <CtrlBtn label="Previous step" onClick={prev} disabled={atStart}>
        <SkipBack className="h-3 w-3" />
      </CtrlBtn>
      <CtrlBtn
        label={isPlaying ? "Pause" : "Play"}
        onClick={isPlaying ? pause : play}
        accent
      >
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </CtrlBtn>
      <CtrlBtn label="Next step" onClick={next} disabled={atEnd && !isDone}>
        <SkipForward className="h-3 w-3" />
      </CtrlBtn>

      <span className="mx-1 h-4 w-px bg-[var(--color-rule)]" aria-hidden />

      <span className="tabular-nums tracking-[0.04em] text-[var(--color-ink-dim)]">
        {stepLabel}
      </span>

      <span className="mx-1 h-4 w-px bg-[var(--color-rule)]" aria-hidden />

      <label className="flex items-center gap-1 text-[10px] text-[var(--color-ink-mute)]">
        <span className="uppercase tracking-[0.08em]">speed</span>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.currentTarget.value))}
          className="
            bg-transparent border border-[var(--color-rule)] rounded px-1 py-0.5
            text-[10.5px] text-[var(--color-ink)]
            outline-none focus-visible:border-[var(--color-violet-hot)]
          "
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
      </label>

      <span className="mx-1 h-4 w-px bg-[var(--color-rule)]" aria-hidden />

      <CtrlBtn label="Reset" onClick={reset}>
        <RotateCcw className="h-3 w-3" />
      </CtrlBtn>
    </div>
  );
}

function CtrlBtn({
  label,
  onClick,
  disabled = false,
  accent = false,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly accent?: boolean;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center rounded transition-colors",
        "h-6 w-6",
        "outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)]",
        "disabled:opacity-35 disabled:cursor-not-allowed",
        accent
          ? "text-[var(--color-violet-hot)] bg-[color-mix(in_oklch,var(--color-violet-hot)_18%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-violet-hot)_28%,transparent)]"
          : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[var(--color-glass)]",
      )}
    >
      {children}
    </button>
  );
}
