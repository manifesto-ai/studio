import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useStudio } from "@manifesto-ai/studio-react";

/**
 * SnapshotRipple — the signature moment.
 *
 * Whenever a new envelope is appended (i.e. a successful build/dispatch),
 * a violet ripple propagates from the bottom of the viewport. Short
 * (~700ms) and subtle, but reinforces the "world just advanced to a new
 * deterministic snapshot" concept. Keyed on envelope id so each new
 * commit triggers exactly one ripple.
 */
export function SnapshotRipple(): JSX.Element {
  const { history, dispatchHistory } = useStudio();
  // Ripple fires whenever the world advances — either by a schema edit
  // (new envelope) or by a dispatch (new snapshot transition). We pick
  // whichever stream's tail is newer.
  const lastEdit = history[history.length - 1] ?? null;
  const lastDispatch = dispatchHistory[dispatchHistory.length - 1] ?? null;
  const latestId =
    lastEdit === null && lastDispatch === null
      ? null
      : lastDispatch === null
        ? `edit:${lastEdit!.id}`
        : lastEdit === null
          ? `dispatch:${lastDispatch.id}`
          : lastDispatch.recordedAt >= lastEdit.timestamp
            ? `dispatch:${lastDispatch.id}`
            : `edit:${lastEdit.id}`;
  const prevIdRef = useRef<string | null>(latestId);
  const [pulseKey, setPulseKey] = useState<string | null>(null);

  useEffect(() => {
    if (latestId === null) return;
    if (latestId === prevIdRef.current) return;
    prevIdRef.current = latestId;
    setPulseKey(latestId);
  }, [latestId]);

  useEffect(() => {
    if (pulseKey === null) return;
    const t = window.setTimeout(() => setPulseKey(null), 900);
    return () => window.clearTimeout(t);
  }, [pulseKey]);

  return (
    <AnimatePresence>
      {pulseKey !== null && (
        <motion.div
          key={pulseKey}
          aria-hidden
          initial={{ opacity: 0.45, scaleY: 0.1 }}
          animate={{ opacity: 0, scaleY: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.85, ease: [0.2, 0.7, 0.4, 1] }}
          className="
            pointer-events-none fixed inset-x-0 bottom-0 z-40
            h-[220px] origin-bottom
          "
          style={{
            background: `linear-gradient(to top,
              color-mix(in oklch, var(--color-violet-hot) 32%, transparent) 0%,
              color-mix(in oklch, var(--color-violet) 18%, transparent) 45%,
              transparent 100%)`,
          }}
        />
      )}
    </AnimatePresence>
  );
}
