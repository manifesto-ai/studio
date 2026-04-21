import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GraphModel,
  GraphNode,
  SimulationPlayback,
} from "@manifesto-ai/studio-react";
import type { Rect } from "./layout";

export const PLAYBACK_STEP_DELAY_MS = 280;
export const PLAYBACK_TAIL_MS = 700;

export type SimulationPlaybackStep = {
  readonly nodeId: GraphNode["id"];
  readonly edgeId: string | null;
};

export type SimulationPlaybackPulse = {
  readonly generation: number;
  readonly activeNodes: ReadonlySet<GraphNode["id"]>;
  readonly activeEdges: ReadonlySet<string>;
  readonly originAction: GraphNode["id"] | null;
};

export type PlaybackStatus = "idle" | "playing" | "paused" | "done";

export type SimulationPlaybackController = {
  readonly pulse: SimulationPlaybackPulse;
  readonly status: PlaybackStatus;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly speed: number;
  readonly steps: readonly SimulationPlaybackStep[];
  readonly play: () => void;
  readonly pause: () => void;
  readonly next: () => void;
  readonly prev: () => void;
  readonly reset: () => void;
  readonly setSpeed: (speed: number) => void;
};

export type PlaybackViewport = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
};

const EMPTY_PULSE: SimulationPlaybackPulse = {
  generation: 0,
  activeNodes: new Set(),
  activeEdges: new Set(),
  originAction: null,
};

/**
 * Playback controller for simulation trace.
 *
 * Decouples three concerns:
 *   1. Step derivation — pure function from (model, playback) →
 *      SimulationPlaybackStep[].
 *   2. Playback state — `status` (idle/playing/paused/done), `index`
 *      (cursor into steps), `speed` (rate multiplier).
 *   3. Pulse — what EdgeLayer/NodeCard render as the "currently lit"
 *      node/edge, derived purely from index + steps.
 *
 * Timer only runs while `status === "playing"`. pause/next/prev move
 * the cursor without re-firing the timer. reset returns to idle and
 * clears the pulse. A new `playback.generation` (next simulate call)
 * resets state, rebuilds steps, and auto-plays from the start.
 */
export function useSimulationPlayback(
  model: GraphModel | null,
  playback: SimulationPlayback | null,
  options: {
    readonly disabled?: boolean;
    readonly autoPlay?: boolean;
  } = {},
): SimulationPlaybackController {
  const disabled = options.disabled === true;
  const autoPlay = options.autoPlay !== false;

  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [index, setIndex] = useState<number>(-1);
  const [speed, setSpeedState] = useState<number>(1);
  const [steps, setSteps] = useState<readonly SimulationPlaybackStep[]>([]);
  const [originAction, setOriginAction] = useState<GraphNode["id"] | null>(null);
  const [generation, setGeneration] = useState<number>(0);

  const timerRef = useRef<number | null>(null);
  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => clearTimer(), [clearTimer]);

  // New playback generation → rebuild + start.
  useEffect(() => {
    if (playback === null || model === null || disabled) {
      clearTimer();
      setStatus("idle");
      setIndex(-1);
      setSteps([]);
      setOriginAction(null);
      setGeneration(0);
      return;
    }
    if (playback.generation === generation) return;
    setGeneration(playback.generation);
    clearTimer();

    const origin = resolveActionNodeId(model, playback.actionName);
    const built =
      playback.mode === "step" && playback.traceNodeId !== null
        ? buildTraceNodePlaybackSteps(model, playback, playback.traceNodeId)
        : buildSimulationPlaybackSteps(model, playback);
    setOriginAction(origin);
    setSteps(built);
    if (built.length === 0) {
      setStatus("idle");
      setIndex(-1);
      return;
    }
    setIndex(0);
    setStatus(autoPlay ? "playing" : "paused");
  }, [playback, model, disabled, autoPlay, generation, clearTimer]);

  // Auto-advance timer — only while playing.
  useEffect(() => {
    clearTimer();
    if (status !== "playing") return;
    if (steps.length === 0 || index < 0) return;
    if (index >= steps.length - 1) {
      // Tail: let last step linger, then mark done.
      timerRef.current = window.setTimeout(() => {
        setStatus("done");
      }, PLAYBACK_TAIL_MS / Math.max(0.1, speed));
      return;
    }
    const delay = PLAYBACK_STEP_DELAY_MS / Math.max(0.1, speed);
    timerRef.current = window.setTimeout(() => {
      setIndex((i) => i + 1);
    }, delay);
  }, [status, index, steps.length, speed, clearTimer]);

  // Pulse derived purely from (status, index, steps).
  const pulse = useMemo<SimulationPlaybackPulse>(() => {
    if (status === "idle" || index < 0 || steps.length === 0) {
      return EMPTY_PULSE;
    }
    if (status === "done") {
      return {
        generation,
        activeNodes: new Set(),
        activeEdges: new Set(),
        originAction: null,
      };
    }
    const step = steps[Math.min(index, steps.length - 1)];
    return {
      generation,
      activeNodes: step === undefined ? new Set() : new Set([step.nodeId]),
      activeEdges:
        step === undefined || step.edgeId === null
          ? new Set()
          : new Set([step.edgeId]),
      originAction,
    };
  }, [status, index, steps, generation, originAction]);

  const play = useCallback((): void => {
    if (steps.length === 0) return;
    if (status === "done") setIndex(0);
    else if (index < 0) setIndex(0);
    setStatus("playing");
  }, [steps.length, status, index]);

  const pause = useCallback((): void => {
    if (status === "idle") return;
    setStatus("paused");
  }, [status]);

  const next = useCallback((): void => {
    if (steps.length === 0) return;
    setStatus("paused");
    setIndex((i) => Math.min(Math.max(0, i) + 1, steps.length - 1));
  }, [steps.length]);

  const prev = useCallback((): void => {
    if (steps.length === 0) return;
    setStatus("paused");
    setIndex((i) => Math.max(0, i - 1));
  }, [steps.length]);

  const reset = useCallback((): void => {
    clearTimer();
    setIndex(-1);
    setStatus("idle");
  }, [clearTimer]);

  const setSpeed = useCallback((s: number): void => {
    setSpeedState(Math.max(0.25, Math.min(4, s)));
  }, []);

  return {
    pulse,
    status,
    currentStep: index,
    totalSteps: steps.length,
    speed,
    steps,
    play,
    pause,
    next,
    prev,
    reset,
    setSpeed,
  };
}

export function buildSimulationPlaybackSteps(
  model: GraphModel,
  playback: Pick<SimulationPlayback, "actionName" | "trace">,
): readonly SimulationPlaybackStep[] {
  const edgeByPair = new Map<string, string>();
  for (const edge of model.edges) {
    const key = `${edge.source}->${edge.target}`;
    if (!edgeByPair.has(key)) {
      edgeByPair.set(key, edge.id);
    }
  }

  const rawSequence: GraphNode["id"][] = [];
  const originAction = resolveActionNodeId(model, playback.actionName);
  if (originAction !== null) {
    rawSequence.push(originAction);
  }

  const pushMappedNode = (nodeId: GraphNode["id"] | null): void => {
    if (nodeId === null) return;
    rawSequence.push(nodeId);
    if (nodeId.startsWith("state:")) {
      rawSequence.push(...collectDownstreamComputedNodes(model, nodeId));
    }
  };

  walkTracePreOrder(playback.trace.root, (node) => {
    pushMappedNode(traceNodeToGraphNodeId(model, node));
  });

  const sequence = collapseConsecutive(rawSequence);
  return sequence.map((nodeId, index) => ({
    nodeId,
    edgeId:
      index === 0
        ? null
        : edgeByPair.get(`${sequence[index - 1]}->${nodeId}`) ?? null,
  }));
}

export function buildTraceNodePlaybackSteps(
  model: GraphModel,
  playback: Pick<SimulationPlayback, "actionName" | "trace">,
  traceNodeId: string,
): readonly SimulationPlaybackStep[] {
  const traceNode = resolveTraceNodeById(playback.trace, traceNodeId);
  if (traceNode === null) return [];

  const sequence = collapseConsecutive(
    projectTraceNodeSequence(model, playback.actionName, traceNode),
  );
  if (sequence.length === 0) return [];

  const edgeByPair = new Map<string, string>();
  for (const edge of model.edges) {
    const key = `${edge.source}->${edge.target}`;
    if (!edgeByPair.has(key)) {
      edgeByPair.set(key, edge.id);
    }
  }

  return sequence.map((nodeId, index) => ({
    nodeId,
    edgeId:
      index === 0
        ? null
        : edgeByPair.get(`${sequence[index - 1]}->${nodeId}`) ?? null,
  }));
}

export function computePlaybackScrollTarget(
  rect: Rect,
  viewport: PlaybackViewport,
): { readonly left: number; readonly top: number } | null {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  const visibleLeft = viewport.left;
  const visibleTop = viewport.top;
  const visibleRight = visibleLeft + viewport.width;
  const visibleBottom = visibleTop + viewport.height;

  const fullyVisible =
    rect.x >= visibleLeft &&
    rect.y >= visibleTop &&
    rect.x + rect.width <= visibleRight &&
    rect.y + rect.height <= visibleBottom;

  if (fullyVisible) {
    return null;
  }

  const maxLeft = Math.max(0, viewport.scrollWidth - viewport.width);
  const maxTop = Math.max(0, viewport.scrollHeight - viewport.height);

  return {
    left: clamp(rect.x + rect.width / 2 - viewport.width / 2, 0, maxLeft),
    top: clamp(rect.y + rect.height / 2 - viewport.height / 2, 0, maxTop),
  };
}

function clearPlaybackTimers(timerIds: readonly number[]): void {
  for (const timerId of timerIds) {
    window.clearTimeout(timerId);
  }
}

function walkTracePreOrder(
  node: SimulationPlayback["trace"]["root"],
  visit: (node: SimulationPlayback["trace"]["root"]) => void,
): void {
  visit(node);
  for (const child of node.children) {
    walkTracePreOrder(child, visit);
  }
}

function traceNodeToGraphNodeId(
  model: GraphModel,
  node: SimulationPlayback["trace"]["root"],
  actionName: string | null = null,
): GraphNode["id"] | null {
  const computed = resolveComputedNodeId(model, node.sourcePath);
  if (computed !== null) return computed;
  if (node.kind === "patch") {
    const patchPath =
      typeof node.inputs.path === "string" ? node.inputs.path : null;
    if (patchPath !== null) {
      const state = resolveStateNodeId(model, patchPath);
      if (state !== null) return state;
    }
  }
  return resolveTraceActionNodeId(model, node.sourcePath, actionName);
}

function resolveActionNodeId(
  model: GraphModel,
  actionName: string,
): GraphNode["id"] | null {
  const nodeId = `action:${actionName}` as GraphNode["id"];
  return model.nodesById.has(nodeId) ? nodeId : null;
}

function resolveTraceActionNodeId(
  model: GraphModel,
  sourcePath: string,
  fallbackActionName: string | null,
): GraphNode["id"] | null {
  const match = /^actions\.([^[.]+)/.exec(sourcePath);
  if (match !== null) {
    return resolveActionNodeId(model, match[1]);
  }
  if (fallbackActionName !== null) {
    return resolveActionNodeId(model, fallbackActionName);
  }
  return null;
}

function resolveComputedNodeId(
  model: GraphModel,
  sourcePath: string,
): GraphNode["id"] | null {
  if (!sourcePath.startsWith("computed.")) return null;
  const match = /^computed\.([^[.]+)/.exec(sourcePath);
  if (match === null) return null;
  const nodeId = `computed:${match[1]}` as GraphNode["id"];
  return model.nodesById.has(nodeId) ? nodeId : null;
}

function resolveStateNodeId(
  model: GraphModel,
  patchPath: string,
): GraphNode["id"] | null {
  const normalized = patchPath.startsWith("data.")
    ? patchPath.slice("data.".length)
    : patchPath;
  if (normalized === "" || normalized.startsWith("$")) return null;
  const match = /^([^[.]+)/.exec(normalized);
  if (match === null) return null;
  const nodeId = `state:${match[1]}` as GraphNode["id"];
  return model.nodesById.has(nodeId) ? nodeId : null;
}

function collectDownstreamComputedNodes(
  model: GraphModel,
  root: GraphNode["id"],
): readonly GraphNode["id"][] {
  const childrenBySource = new Map<GraphNode["id"], GraphNode["id"][]>();
  for (const edge of model.edges) {
    if (edge.relation !== "feeds") continue;
    if (!edge.target.startsWith("computed:")) continue;
    const list = childrenBySource.get(edge.source);
    if (list === undefined) {
      childrenBySource.set(edge.source, [edge.target]);
    } else {
      list.push(edge.target);
    }
  }

  const out: GraphNode["id"][] = [];
  const seen = new Set<GraphNode["id"]>();
  const stack = [...(childrenBySource.get(root) ?? [])].reverse();

  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    const children = childrenBySource.get(next) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }

  return out;
}

function resolveTraceNodeById(
  trace: SimulationPlayback["trace"],
  traceNodeId: string,
): SimulationPlayback["trace"]["root"] | null {
  if (trace.root.id === traceNodeId) return trace.root;
  return trace.nodes[traceNodeId] ?? null;
}

function projectTraceNodeSequence(
  model: GraphModel,
  actionName: string,
  traceNode: SimulationPlayback["trace"]["root"],
): GraphNode["id"][] {
  const mappedNode = traceNodeToGraphNodeId(model, traceNode, actionName);
  if (mappedNode === null) return [];
  if (mappedNode.startsWith("state:")) {
    return [mappedNode, ...collectDownstreamComputedNodes(model, mappedNode)];
  }
  return [mappedNode];
}

function collapseConsecutive<T>(values: readonly T[]): T[] {
  const out: T[] = [];
  for (const value of values) {
    if (out.length > 0 && Object.is(out[out.length - 1], value)) continue;
    out.push(value);
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
