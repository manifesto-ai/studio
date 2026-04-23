/**
 * useFocus — adapter over the Studio UI runtime's focus slice.
 *
 * The actual storage lives in `domain/studio.mel` as three sibling
 * fields (`focusedNodeId`, `focusedNodeKind`, `focusedNodeOrigin`).
 * This hook preserves the historical `{focus, setFocus, clear}` shape
 * so existing consumers (LiveGraph, LensPane, FocusSync) don't need
 * edits — but every read and write now goes through the studio
 * runtime. No more React context for focus, no local useState.
 *
 * Why keep `Focus = {kind: "node", id, origin} | null` instead of
 * inlining the three fields at the call site?
 *   - Consumers already pattern-match on `.kind === "node"` for the
 *     null case, which keeps call sites terse.
 *   - Node ids encode kind+name (`"action:toggleTodo"`). The hook's
 *     job is to translate between the three-field runtime
 *     representation and the consumer-facing compact shape.
 */
import { useCallback, useMemo } from "react";
import type { GraphNode } from "@manifesto-ai/studio-react";
import { useStudioUi } from "@/domain/StudioUiRuntime";

export type FocusOrigin = "graph" | "source" | "diagnostic" | "interact";

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

export function useFocus(): FocusContextValue {
  const ui = useStudioUi();
  const {
    focusedNodeId,
    focusedNodeKind,
    focusedNodeOrigin,
  } = ui.snapshot;

  const focus = useMemo<Focus>(() => {
    if (focusedNodeId === null) return null;
    // The runtime widened focusedNodeOrigin to include "agent"; the
    // consumer-facing type still hides that since only the agent tool
    // uses it, never a React call site. Coerce defensively.
    const origin: FocusOrigin =
      focusedNodeOrigin === "graph" ||
      focusedNodeOrigin === "source" ||
      focusedNodeOrigin === "diagnostic" ||
      focusedNodeOrigin === "interact"
        ? focusedNodeOrigin
        : "graph";
    return {
      kind: "node",
      id: focusedNodeId as GraphNode["id"],
      origin,
    };
    // focusedNodeKind intentionally not read — it's used by the agent
    // and can be inferred from the id prefix by consumers that need it.
  }, [focusedNodeId, focusedNodeKind, focusedNodeOrigin]);

  const setFocus = useCallback(
    (next: Focus): void => {
      if (next === null) {
        ui.clearFocus();
        return;
      }
      const kind = deriveKindFromId(next.id);
      if (kind === null) {
        // Malformed id — ignore rather than dispatch a runtime error.
        // This matches the old behaviour (silent no-op) for invalid
        // focus requests.
        return;
      }
      ui.focusNode(next.id, kind, next.origin);
    },
    [ui],
  );

  const clear = useCallback(() => ui.clearFocus(), [ui]);

  return useMemo(
    () => ({ focus, setFocus, clear }),
    [focus, setFocus, clear],
  );
}

/**
 * Graph node ids use a `<kind>:<name>` format — parse the kind.
 * Unknown prefixes yield `null`, which `setFocus` treats as a no-op.
 */
function deriveKindFromId(
  id: string,
): "action" | "state" | "computed" | null {
  const idx = id.indexOf(":");
  if (idx < 0) return null;
  const prefix = id.slice(0, idx);
  return prefix === "action" || prefix === "state" || prefix === "computed"
    ? prefix
    : null;
}
