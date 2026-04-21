import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { GraphNode } from "@manifesto-ai/studio-react";

/**
 * FocusProvider — single source of truth for "what the user is looking
 * at right now". Writers: graph card clicks, Monaco cursor, diagnostic
 * row clicks. Readers: LiveGraph (dim + neighbourhood), SourcePane (via
 * `useFocusSync`, which reveals + decorates on origin="graph" focus).
 *
 * The `origin` tag lets readers tell "who moved me here" so we can avoid
 * loops — e.g. when the Monaco cursor sets focus (origin="source"),
 * SourcePane does NOT re-reveal the same line, otherwise every typed
 * character would re-center the viewport.
 */

export type FocusOrigin = "graph" | "source" | "diagnostic";

export type Focus =
  | {
      readonly kind: "node";
      readonly id: GraphNode["id"];
      readonly origin: FocusOrigin;
    }
  | null;

type FocusContextValue = {
  readonly focus: Focus;
  readonly setFocus: (next: Focus) => void;
  readonly clear: () => void;
};

const FocusContext = createContext<FocusContextValue | null>(null);

export function FocusProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const [focus, setFocusState] = useState<Focus>(null);
  const setFocus = useCallback((next: Focus): void => setFocusState(next), []);
  const clear = useCallback((): void => setFocusState(null), []);
  const value = useMemo<FocusContextValue>(
    () => ({ focus, setFocus, clear }),
    [focus, setFocus, clear],
  );
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (ctx === null) {
    throw new Error("useFocus must be used inside <FocusProvider>");
  }
  return ctx;
}
