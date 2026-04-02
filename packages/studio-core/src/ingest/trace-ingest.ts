import type { TraceGraph } from "../contracts/inputs.js";

import {
  createIssue,
  type IngestResult,
  type IngestValidationIssue,
  isPlainObject
} from "./issues.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cloneTraceNode(node: TraceGraph["root"]): TraceGraph["root"] {
  return {
    ...node,
    inputs: { ...node.inputs },
    children: node.children.map((child) => cloneTraceNode(child))
  };
}

function validateTraceNode(
  node: unknown,
  issues: IngestValidationIssue[],
  path: string
): node is TraceGraph["root"] {
  if (!isPlainObject(node)) {
    issues.push(
      createIssue("trace", "invalid-node", "Trace nodes must be objects.", path)
    );
    return false;
  }

  const requiredStrings = [node.id, node.kind, node.sourcePath].every(
    (value) => typeof value === "string"
  );
  const hasTimestamp = typeof node.timestamp === "number" && Number.isFinite(node.timestamp);
  const hasInputs = isPlainObject(node.inputs);
  const hasChildren = Array.isArray(node.children);

  if (!requiredStrings || !hasTimestamp || !hasInputs || !hasChildren) {
    issues.push(
      createIssue(
        "trace",
        "invalid-node",
        "Trace nodes must include id, kind, sourcePath, inputs, children, and timestamp.",
        path
      )
    );
    return false;
  }

  return true;
}

export function ingestTrace(trace: TraceGraph): IngestResult<TraceGraph> {
  const issues: IngestValidationIssue[] = [];

  if (!isPlainObject(trace)) {
    return {
      issues: [
        createIssue(
          "trace",
          "invalid-trace",
          "Trace overlay must be an object.",
          "trace"
        )
      ]
    };
  }

  if (!validateTraceNode(trace.root, issues, "trace.root")) {
    return { issues };
  }

  if (!isPlainObject(trace.nodes)) {
    issues.push(
      createIssue(
        "trace",
        "invalid-node-map",
        "trace.nodes must be a record of trace nodes.",
        "trace.nodes"
      )
    );
    return { issues };
  }

  const normalizedNodes: TraceGraph["nodes"] = {};
  for (const [nodeId, rawNode] of Object.entries(trace.nodes)) {
    if (!validateTraceNode(rawNode, issues, `trace.nodes.${nodeId}`)) {
      continue;
    }

    normalizedNodes[nodeId] = cloneTraceNode(rawNode);
  }

  if (!(trace.root.id in normalizedNodes)) {
    issues.push(
      createIssue(
        "trace",
        "missing-root-node",
        "trace.nodes must contain the trace.root.id entry.",
        `trace.nodes.${trace.root.id}`
      )
    );
  }

  const intentType = asString(trace.intent?.type);
  const baseVersion = asNumber(trace.baseVersion);
  const resultVersion = asNumber(trace.resultVersion);
  const duration = asNumber(trace.duration);
  const terminatedBy = asString(trace.terminatedBy);

  if (!intentType) {
    issues.push(
      createIssue(
        "trace",
        "invalid-intent-type",
        "trace.intent.type must be a string.",
        "trace.intent.type"
      )
    );
  }

  if (baseVersion === undefined || resultVersion === undefined || duration === undefined) {
    issues.push(
      createIssue(
        "trace",
        "invalid-version-fields",
        "trace.baseVersion, trace.resultVersion, and trace.duration must be finite numbers.",
        "trace"
      )
    );
  }

  if (
    terminatedBy !== "error" &&
    terminatedBy !== "effect" &&
    terminatedBy !== "halt" &&
    terminatedBy !== "complete"
  ) {
    issues.push(
      createIssue(
        "trace",
        "invalid-termination",
        "trace.terminatedBy must be one of error, effect, halt, or complete.",
        "trace.terminatedBy"
      )
    );
  }

  if (issues.length > 0) {
    return { issues };
  }

  return {
    value: {
      root: cloneTraceNode(trace.root),
      nodes: normalizedNodes,
      intent: {
        type: intentType!,
        input: trace.intent.input
      },
      baseVersion: baseVersion!,
      resultVersion: resultVersion!,
      duration: duration!,
      terminatedBy: terminatedBy as TraceGraph["terminatedBy"]
    },
    issues
  };
}
