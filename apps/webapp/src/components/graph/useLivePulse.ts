import { useEffect, useRef, useState } from "react";
import type { GraphModel, GraphNode } from "@manifesto-ai/studio-react";
import { useStudio } from "@manifesto-ai/studio-react";

export type Pulse = {
  /** Ordinal generation counter — bumps on every new envelope. */
  readonly generation: number;
  /** Which nodes are freshly "touched" by the latest envelope. */
  readonly touched: ReadonlySet<GraphNode["id"]>;
  /** The action node that triggered this generation, if identifiable. */
  readonly originAction: GraphNode["id"] | null;
};

const EMPTY_PULSE: Pulse = {
  generation: 0,
  touched: new Set(),
  originAction: null,
};

/**
 * Watches `useStudio().history` for newly appended envelopes and derives
 * which nodes should visibly pulse in response:
 *
 *   origin action → every state it mutates → every computed that
 *   transitively `feeds` off those states.
 *
 * Returns a stable `Pulse` value that consumers can key off. Resets to
 * an empty pulse ~1200ms after the triggering envelope so the
 * animation plays exactly once per commit.
 */
export function useLivePulse(model: GraphModel | null): Pulse {
  const { history } = useStudio();
  const lastEnvIdRef = useRef<string | null>(
    history[history.length - 1]?.id ?? null,
  );
  const [pulse, setPulse] = useState<Pulse>(EMPTY_PULSE);

  useEffect(() => {
    const latest = history[history.length - 1] ?? null;
    if (latest === null) return;
    if (latest.id === lastEnvIdRef.current) return;
    lastEnvIdRef.current = latest.id;

    if (model === null) {
      setPulse((prev) => ({
        generation: prev.generation + 1,
        touched: new Set(),
        originAction: null,
      }));
      return;
    }

    // Identify the origin action from the envelope payload. Edit
    // envelopes for source edits have payloadKind === "source.edit";
    // dispatched intent envelopes carry an action name in the payload.
    const originAction = resolveOriginAction(latest, model);
    const touched = computeReachableDownstream(model, originAction);

    setPulse((prev) => ({
      generation: prev.generation + 1,
      touched,
      originAction,
    }));
  }, [history, model]);

  useEffect(() => {
    if (pulse.generation === 0) return;
    const t = window.setTimeout(() => {
      setPulse((prev) =>
        prev.generation === pulse.generation
          ? { ...prev, touched: new Set(), originAction: null }
          : prev,
      );
    }, 1400);
    return () => window.clearTimeout(t);
  }, [pulse.generation]);

  return pulse;
}

function resolveOriginAction(
  env: { readonly payloadKind: string; readonly payload?: unknown },
  model: GraphModel,
): GraphNode["id"] | null {
  // Best-effort: the payload for a dispatched intent is `{ action, ... }`.
  const payload = env.payload as { readonly action?: unknown } | undefined;
  if (payload === undefined) return null;
  const name = payload.action;
  if (typeof name !== "string") return null;
  const id = `action:${name}` as GraphNode["id"];
  return model.nodesById.has(id) ? id : null;
}

function computeReachableDownstream(
  model: GraphModel,
  root: GraphNode["id"] | null,
): Set<GraphNode["id"]> {
  const out = new Set<GraphNode["id"]>();
  if (root === null) return out;
  out.add(root);

  // BFS across `mutates` (action → state) then `feeds` (state → computed,
  // computed → computed). Conservative: also include any target of
  // outgoing edges so the visualization covers the real cascade.
  const byFrom = new Map<GraphNode["id"], GraphNode["id"][]>();
  for (const e of model.edges) {
    const list = byFrom.get(e.source);
    if (list === undefined) byFrom.set(e.source, [e.target]);
    else list.push(e.target);
  }

  const queue: GraphNode["id"][] = [root];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    const children = byFrom.get(next) ?? [];
    for (const child of children) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}
