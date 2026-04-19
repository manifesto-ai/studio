import { useEffect, useRef, useState } from "react";
import type {
  GraphModel,
  GraphNode,
  SimulationPlayback,
} from "@manifesto-ai/studio-react";
import type { Rect } from "./layout";

export const PLAYBACK_STEP_DELAY_MS = 140;
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

export function useSimulationPlayback(
  model: GraphModel | null,
  playback: SimulationPlayback | null,
  options: {
    readonly disabled?: boolean;
  } = {},
): SimulationPlaybackPulse {
  const disabled = options.disabled === true;
  const [pulse, setPulse] = useState<SimulationPlaybackPulse>(EMPTY_PULSE);
  const lastHandledGenerationRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(
    () => () => {
      clearPlaybackTimers(timersRef.current);
      timersRef.current = [];
    },
    [],
  );

  useEffect(() => {
    if (playback === null || model === null || disabled) {
      if (playback !== null) {
        lastHandledGenerationRef.current = playback.generation;
      }
      clearPlaybackTimers(timersRef.current);
      timersRef.current = [];
      setPulse((prev) =>
        prev.generation === 0 &&
        prev.activeNodes.size === 0 &&
        prev.activeEdges.size === 0 &&
        prev.originAction === null
          ? prev
          : EMPTY_PULSE,
      );
      return;
    }

    if (lastHandledGenerationRef.current === playback.generation) {
      return;
    }
    lastHandledGenerationRef.current = playback.generation;
    clearPlaybackTimers(timersRef.current);
    timersRef.current = [];

    const originAction = resolveActionNodeId(model, playback.actionName);
    const steps =
      playback.mode === "step" && playback.traceNodeId !== null
        ? buildTraceNodePlaybackSteps(model, playback, playback.traceNodeId)
        : buildSimulationPlaybackSteps(model, playback);

    setPulse({
      generation: playback.generation,
      activeNodes: new Set(),
      activeEdges: new Set(),
      originAction,
    });

    if (steps.length === 0) {
      return;
    }

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const timerId = window.setTimeout(() => {
        setPulse({
          generation: playback.generation,
          activeNodes: new Set([step.nodeId]),
          activeEdges:
            step.edgeId === null ? new Set() : new Set([step.edgeId]),
          originAction,
        });
      }, index * PLAYBACK_STEP_DELAY_MS);
      timersRef.current.push(timerId);
    }

    const clearId = window.setTimeout(() => {
      setPulse({
        generation: playback.generation,
        activeNodes: new Set(),
        activeEdges: new Set(),
        originAction: null,
      });
    }, steps.length * PLAYBACK_STEP_DELAY_MS + PLAYBACK_TAIL_MS);
    timersRef.current.push(clearId);
  }, [disabled, model, playback]);

  return pulse;
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
