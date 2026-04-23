/**
 * useTimeScrub — adapter over the Studio UI runtime's scrub slice.
 *
 * Semantic storage (which envelope the user is scrubbing to) lives in
 * studio.mel's `scrubEnvelopeId` field. Expensive derivation — the
 * replayed module + snapshot reconstructed from the envelope prefix
 * — stays in React as a useMemo: it's not semantic world state, it's
 * a side-effect computation triggered by the scrub transition.
 *
 * Legality gate on the runtime side: the `scrubTo` MEL action is only
 * dispatchable from `viewMode == "live" || "scrub"`, so entering a
 * scrub while simulating is rejected at the runtime boundary — no
 * check needed here.
 *
 * Public API preserved ({state, select, returnToNow, selectedEnvelopeId})
 * so NowLine / ObservatoryPane / LiveGraph etc. don't need edits.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import {
  replayEnvelopes,
  type DomainModule,
  type EditIntentEnvelope,
} from "@manifesto-ai/studio-core";
import { useStudio } from "@manifesto-ai/studio-react";
import { useStudioUi } from "@/domain/StudioUiRuntime";

export type TimeScrubState =
  | { readonly mode: "live" }
  | {
      readonly mode: "past";
      readonly envelope: EditIntentEnvelope;
      readonly envelopeIndex: number;
      readonly module: DomainModule | null;
      readonly snapshot: {
        readonly data?: unknown;
        readonly computed?: Record<string, unknown>;
      } | null;
    };

type TimeScrubContextValue = {
  readonly state: TimeScrubState;
  readonly select: (envelopeId: string | null) => void;
  readonly returnToNow: () => void;
  readonly selectedEnvelopeId: string | null;
};

/**
 * No longer a real React provider — the studio runtime owns the
 * state. We keep the JSX wrapper for call-site compatibility; it
 * just renders its children.
 */
export function TimeScrubProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return <>{children}</>;
}

export function useTimeScrub(): TimeScrubContextValue {
  const { history } = useStudio();
  const ui = useStudioUi();

  // Canonical scrub target from studio runtime. `null` when live.
  const selectedId = ui.snapshot.scrubEnvelopeId;

  // Clamp: if the selected envelope falls off history (e.g. the user
  // rebuilt and the store gc'd old ones), drop back to live mode.
  // Clamp dispatches through the studio runtime so the semantic state
  // stays authoritative even on stale targets.
  const selectedIndex = useMemo(() => {
    if (selectedId === null) return -1;
    return history.findIndex((e) => e.id === selectedId);
  }, [history, selectedId]);

  const state: TimeScrubState = useMemo(() => {
    if (selectedId === null || selectedIndex < 0) return { mode: "live" };
    const envelope = history[selectedIndex];
    if (envelope === undefined) return { mode: "live" };

    const prefix = history.slice(0, selectedIndex + 1);
    const result = replayEnvelopes(prefix);

    return {
      mode: "past",
      envelope,
      envelopeIndex: selectedIndex,
      module: result.module,
      snapshot:
        result.canonicalSnapshot === null
          ? null
          : {
              data: (result.canonicalSnapshot as { readonly data?: unknown })
                .data,
              computed:
                ((result.canonicalSnapshot as {
                  readonly computed?: Record<string, unknown>;
                }).computed) ?? {},
            },
    };
  }, [history, selectedIndex, selectedId]);

  const select = useCallback(
    (envelopeId: string | null) => {
      if (envelopeId === null) {
        // Going back to live — studio runtime gates this on
        // `viewMode == "scrub"`; if we're already live this is a silent
        // no-op, which matches the old behaviour.
        ui.resetScrub();
        return;
      }
      ui.scrubTo(envelopeId);
    },
    [ui],
  );
  const returnToNow = useCallback(() => ui.resetScrub(), [ui]);

  return useMemo<TimeScrubContextValue>(
    () => ({ state, select, returnToNow, selectedEnvelopeId: selectedId }),
    [state, select, returnToNow, selectedId],
  );
}
