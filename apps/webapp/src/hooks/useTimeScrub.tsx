import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  replayEnvelopes,
  type DomainModule,
  type EditIntentEnvelope,
} from "@manifesto-ai/studio-core";
import { useStudio } from "@manifesto-ai/studio-react";

/**
 * Time-scrubbing state lives at the App level so the NowLine (writer)
 * and the Observatory / LiveGraph (reader) share a single source of
 * truth. The scrub cursor is an index into the currently-visible
 * history slice; `null` means "live".
 *
 * Past mode works by replaying the envelope stream through the build
 * pipeline to reconstruct a point-in-time module + canonical
 * snapshot. Dispatches are not replayed (no dispatch envelope kind
 * exists yet), so past snapshots show state as it was *right after
 * the last rebuild, before any dispatches ran*.
 */
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

const TimeScrubContext = createContext<TimeScrubContextValue | null>(null);

export function TimeScrubProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const { history } = useStudio();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Clamp: if the selected envelope falls off history (e.g. the user
  // rebuilt and the store gc'd old ones), drop back to live mode.
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
    (envelopeId: string | null) => setSelectedId(envelopeId),
    [],
  );
  const returnToNow = useCallback(() => setSelectedId(null), []);

  const value = useMemo<TimeScrubContextValue>(
    () => ({ state, select, returnToNow, selectedEnvelopeId: selectedId }),
    [state, select, returnToNow, selectedId],
  );

  return (
    <TimeScrubContext.Provider value={value}>
      {children}
    </TimeScrubContext.Provider>
  );
}

export function useTimeScrub(): TimeScrubContextValue {
  const ctx = useContext(TimeScrubContext);
  if (ctx === null) {
    throw new Error("useTimeScrub must be used inside <TimeScrubProvider>");
  }
  return ctx;
}
