import type {
  ObservationRecord,
  ProjectionGroupBySelection,
  ProjectionPreset,
  ProjectionSignatureEntry,
  ProjectionTransformSpec,
  TransitionGraphEdge,
  TransitionGraphNode,
  TransitionGraphProjection
} from "../contracts/projections.js";
import type { Snapshot } from "../contracts/inputs.js";

type ProjectionOptions = {
  currentSnapshot?: Snapshot;
};

type Signature = {
  key: string;
  entries: ProjectionSignatureEntry[];
};

type NodeAggregate = {
  id: string;
  label: string;
  signature: ProjectionSignatureEntry[];
  observationCount: number;
  current: boolean;
};

type EdgeAggregate = {
  id: string;
  source: string;
  target: string;
  actionId: string;
  changedDimensions: Set<string>;
  recordIds: string[];
  liveCount: number;
  dryRunCount: number;
  blockedCount: number;
  latestTimestamp: number;
  selfLoop: boolean;
};

function readPathValue(value: unknown, path: string): unknown {
  if (!path) {
    return value;
  }

  return path.split(".").reduce<unknown>((current, part) => {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[part];
  }, value);
}

function getSelectionLabel(selection: ProjectionGroupBySelection): string {
  return selection.label ?? (selection.source === "state" ? selection.path : selection.id);
}

function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function toPresence(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return true;
}

function applyTransform(value: unknown, transform: ProjectionTransformSpec): string {
  switch (transform.kind) {
    case "raw":
    case "enum":
      return stringifyValue(value);
    case "boolean":
      return String(Boolean(value));
    case "presence":
      return String(toPresence(value));
    case "bucket": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "non-numeric";
      }

      const matched = transform.ranges.find((range) => {
        const withinMin = range.min === undefined || value >= range.min;
        const withinMax = range.max === undefined || value < range.max;
        return withinMin && withinMax;
      });

      return matched?.label ?? "unbucketed";
    }
  }
}

export function summarizeProjectionSignature(
  snapshot: Snapshot,
  preset: ProjectionPreset
): Signature {
  const entries = preset.groupBy
    .map<ProjectionSignatureEntry>((selection) => {
      const rawValue =
        selection.source === "state"
          ? readPathValue(snapshot.data, selection.path)
          : readPathValue(snapshot.computed, selection.id);

      return {
        key: selection.source === "state" ? selection.path : selection.id,
        label: getSelectionLabel(selection),
        rawValue,
        value: applyTransform(rawValue, selection.transform)
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));

  return {
    key: JSON.stringify(
      entries.map((entry) => ({
        key: entry.key,
        value: entry.value
      }))
    ),
    entries
  };
}

function ensureNode(
  nodes: Map<string, NodeAggregate>,
  signature: Signature,
  options?: {
    countObservation?: boolean;
    current?: boolean;
  }
): void {
  const existing = nodes.get(signature.key);

  if (existing) {
    if (options?.countObservation) {
      existing.observationCount += 1;
    }

    if (options?.current) {
      existing.current = true;
    }

    return;
  }

  nodes.set(signature.key, {
    id: `projection:${signature.key}`,
    label: signature.entries.map((entry) => `${entry.label}=${entry.value}`).join(" · "),
    signature: signature.entries,
    observationCount: options?.countObservation ? 1 : 0,
    current: Boolean(options?.current)
  });
}

function diffSignatureDimensions(from: Signature, to: Signature): string[] {
  const nextValues = new Map(to.entries.map((entry) => [entry.key, entry.value]));
  return from.entries
    .filter((entry) => nextValues.get(entry.key) !== entry.value)
    .map((entry) => entry.label)
    .sort((left, right) => left.localeCompare(right));
}

function includeAction(record: ObservationRecord, preset: ProjectionPreset): boolean {
  const observedActions = preset.observe
    .filter((selection) => selection.kind === "action")
    .map((selection) => selection.id);

  if (observedActions.length === 0) {
    return true;
  }

  return observedActions.includes(record.actionId);
}

function toSortedNodes(nodes: Iterable<NodeAggregate>, currentNodeId?: string): TransitionGraphNode[] {
  return Array.from(nodes)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      ...node,
      current: currentNodeId === node.id ? true : node.current
    }));
}

function toSortedEdges(edges: Iterable<EdgeAggregate>): TransitionGraphEdge[] {
  return Array.from(edges)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      actionId: edge.actionId,
      changedDimensions: Array.from(edge.changedDimensions).sort((left, right) =>
        left.localeCompare(right)
      ),
      recordIds: edge.recordIds,
      liveCount: edge.liveCount,
      dryRunCount: edge.dryRunCount,
      blockedCount: edge.blockedCount,
      latestTimestamp: edge.latestTimestamp,
      selfLoop: edge.selfLoop
    }));
}

export function projectTransitionGraph(
  records: ObservationRecord[],
  preset: ProjectionPreset,
  options?: ProjectionOptions
): TransitionGraphProjection {
  if (preset.groupBy.length === 0) {
    return {
      status: "invalid-preset",
      presetId: preset.id,
      presetName: preset.name,
      message: "Select at least one state or computed field in group by.",
      nodes: [],
      edges: []
    };
  }

  const nodes = new Map<string, NodeAggregate>();
  const edges = new Map<string, EdgeAggregate>();
  const includeBlocked = preset.options?.includeBlocked ?? true;
  const includeDryRun = preset.options?.includeDryRun ?? true;
  const currentSignature = options?.currentSnapshot
    ? summarizeProjectionSignature(options.currentSnapshot, preset)
    : undefined;

  if (currentSignature) {
    ensureNode(nodes, currentSignature, { current: true });
  }

  for (const record of records) {
    if (!includeAction(record, preset)) {
      continue;
    }

    if (!includeDryRun && record.mode === "dry-run") {
      continue;
    }

    if (!includeBlocked && record.outcome === "blocked") {
      continue;
    }

    const fromSignature = summarizeProjectionSignature(record.beforeSnapshot, preset);
    const targetSnapshot = record.afterSnapshot ?? record.beforeSnapshot;
    const toSignature = summarizeProjectionSignature(targetSnapshot, preset);

    ensureNode(nodes, fromSignature, { countObservation: true });
    ensureNode(nodes, toSignature, { countObservation: true });

    const sourceNodeId = nodes.get(fromSignature.key)!.id;
    const targetNodeId = nodes.get(toSignature.key)!.id;
    const edgeId = [
      sourceNodeId,
      targetNodeId,
      record.actionId,
      record.mode,
      record.outcome
    ].join("::");
    const existing = edges.get(edgeId);
    const changedDimensions = diffSignatureDimensions(fromSignature, toSignature);

    if (existing) {
      existing.recordIds.push(record.id);
      for (const changedDimension of changedDimensions) {
        existing.changedDimensions.add(changedDimension);
      }
      existing.latestTimestamp = Math.max(existing.latestTimestamp, record.timestamp);
      existing.liveCount += record.mode === "live" ? 1 : 0;
      existing.dryRunCount += record.mode === "dry-run" ? 1 : 0;
      existing.blockedCount += record.outcome === "blocked" ? 1 : 0;
      continue;
    }

    edges.set(edgeId, {
      id: edgeId,
      source: sourceNodeId,
      target: targetNodeId,
      actionId: record.actionId,
      changedDimensions: new Set(changedDimensions),
      recordIds: [record.id],
      liveCount: record.mode === "live" ? 1 : 0,
      dryRunCount: record.mode === "dry-run" ? 1 : 0,
      blockedCount: record.outcome === "blocked" ? 1 : 0,
      latestTimestamp: record.timestamp,
      selfLoop: sourceNodeId === targetNodeId
    });
  }

  const currentNodeId = currentSignature ? nodes.get(currentSignature.key)?.id : undefined;

  return {
    status: "ready",
    presetId: preset.id,
    presetName: preset.name,
    currentNodeId,
    nodes: toSortedNodes(nodes.values(), currentNodeId),
    edges: toSortedEdges(edges.values())
  };
}
