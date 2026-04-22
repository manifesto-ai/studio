import { motion } from "motion/react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, X } from "lucide-react";
import type { GraphModel } from "@manifesto-ai/studio-react";
import { cn } from "@/lib/cn";
import type { SimulationPlaybackController } from "./useSimulationPlayback";

/**
 * Floating playback controls for simulation step-through.
 *
 * Visual design goals:
 *   - Unmissable on entry (slide-down + glow pulse when a new
 *     playback starts) — users hit Simulate and can't miss where
 *     the response appeared.
 *   - Self-explanatory content: "▶ 3/12 · state:tasks" reads as
 *     "on step 3 of 12, currently highlighting the state node tasks"
 *     without any extra label.
 *   - Status-aware glow — playing pulses, paused stays quiet, done
 *     fades the glow but keeps the bar so the user can Reset.
 */
export function PlaybackControlBar({
  controller,
  model,
  onExit,
}: {
  readonly controller: SimulationPlaybackController;
  readonly model: GraphModel;
  /**
   * Called when the user dismisses the simulation session via the ×
   * button or the Escape hotkey. Host apps wire this to their
   * `exitSimulation` context action so the bar and the simulation's
   * visual layer go away together.
   */
  readonly onExit?: () => void;
}): JSX.Element | null {
  const {
    status,
    currentStep,
    totalSteps,
    speed,
    steps,
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
  const safeIndex = Math.min(Math.max(0, currentStep), totalSteps - 1);
  const displayStep = isDone ? totalSteps : safeIndex + 1;
  const currentStepEntry = steps[safeIndex];
  const currentNode =
    currentStepEntry === undefined
      ? null
      : model.nodesById.get(currentStepEntry.nodeId) ?? null;
  const currentLabel =
    currentNode === null
      ? null
      : `${currentNode.kind}:${currentNode.name}`;
  const progress = Math.min(1, Math.max(0, displayStep / totalSteps));

  return (
    <motion.div
      role="group"
      aria-label="Simulation playback controls"
      // Big entry beat so the user's eye is pulled here the moment
      // they hit Simulate. Spring-settles to its resting state, then
      // the internal glow keyframes take over while playing.
      initial={{ opacity: 0, y: -14, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 340, damping: 26, mass: 0.8 }}
      className={cn(
        "absolute top-4 left-1/2 -translate-x-1/2 z-20",
        "flex flex-col gap-1.5 px-3 py-2 rounded-xl",
        "bg-[color-mix(in_oklch,var(--color-void-hi,#1A2036)_94%,var(--color-violet,#9f7bff))]",
        "border border-[color-mix(in_oklch,var(--color-violet)_55%,transparent)]",
        "backdrop-blur-xl",
        "font-mono text-[11px] text-[var(--color-ink)]",
        "select-none min-w-[300px] max-w-[520px]",
        isPlaying && "mf-playback-glow",
      )}
      style={{
        boxShadow: isDone
          ? "0 6px 20px color-mix(in oklch, var(--color-violet, #9f7bff) 18%, transparent)"
          : "0 8px 28px color-mix(in oklch, var(--color-violet, #9f7bff) 32%, transparent)",
      }}
    >
      {/* Row 1 — controls + step label + speed + reset */}
      <div className="flex items-center gap-1.5">
        <CtrlBtn label="Previous step" onClick={prev} disabled={atStart}>
          <SkipBack className="h-[14px] w-[14px]" />
        </CtrlBtn>
        <CtrlBtn
          label={isPlaying ? "Pause" : "Play"}
          onClick={isPlaying ? pause : play}
          accent
        >
          {isPlaying ? (
            <Pause className="h-[15px] w-[15px]" />
          ) : (
            <Play className="h-[15px] w-[15px]" />
          )}
        </CtrlBtn>
        <CtrlBtn label="Next step" onClick={next} disabled={atEnd && !isDone}>
          <SkipForward className="h-[14px] w-[14px]" />
        </CtrlBtn>

        <span className="mx-1.5 h-4 w-px bg-[var(--color-rule)]" aria-hidden />

        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className="tabular-nums tracking-[0.02em] text-[var(--color-ink)] font-semibold">
            {displayStep}
            <span className="text-[var(--color-ink-mute)]">/{totalSteps}</span>
          </span>
          {currentLabel !== null && !isDone ? (
            <>
              <span className="text-[var(--color-ink-mute)]">·</span>
              <span
                className="truncate text-[var(--color-violet-hot)]"
                title={currentLabel}
              >
                {currentLabel}
              </span>
            </>
          ) : null}
          {isDone ? (
            <>
              <span className="text-[var(--color-ink-mute)]">·</span>
              <span className="uppercase tracking-[0.08em] text-[var(--color-sig-action)] text-[10px]">
                done
              </span>
            </>
          ) : null}
        </span>

        <span className="ml-auto flex items-center gap-1.5">
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
          <CtrlBtn label="Reset" onClick={reset}>
            <RotateCcw className="h-[13px] w-[13px]" />
          </CtrlBtn>
          {onExit !== undefined ? (
            <CtrlBtn label="Exit simulation" onClick={onExit}>
              <X className="h-[13px] w-[13px]" />
            </CtrlBtn>
          ) : null}
        </span>
      </div>

      {/* Row 2 — linear progress. Fill width tracks currentStep; colour
       * stays calm on paused/done so motion = playing. */}
      <div
        aria-hidden
        className="
          relative h-[3px] w-full rounded-full overflow-hidden
          bg-[color-mix(in_oklch,var(--color-violet,#9f7bff)_14%,transparent)]
        "
      >
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background:
              "linear-gradient(to right, color-mix(in oklch, var(--color-violet, #9f7bff) 55%, transparent), var(--color-violet-hot, #c79cff))",
            width: `${progress * 100}%`,
          }}
          animate={{ width: `${progress * 100}%` }}
          transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
        />
      </div>
    </motion.div>
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
        "flex items-center justify-center rounded-md transition-colors",
        "h-7 w-7",
        "outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)]",
        "disabled:opacity-30 disabled:cursor-not-allowed",
        accent
          ? "text-[var(--color-violet-hot)] bg-[color-mix(in_oklch,var(--color-violet-hot)_22%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-violet-hot)_34%,transparent)]"
          : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[var(--color-glass)]",
      )}
    >
      {children}
    </button>
  );
}
