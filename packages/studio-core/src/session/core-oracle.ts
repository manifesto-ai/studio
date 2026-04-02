import {
  createContext,
  createTraceContext,
  evaluateExpr,
  explain,
  getAvailableActions,
  getByPath,
  isActionAvailable
} from "@manifesto-ai/core";

import type { DomainSchema, RuntimeOverlayContext, Snapshot } from "../contracts/inputs.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";
import type { GuardBreakdownFact } from "../contracts/inputs.js";

import { collectExprReads, summarizeExpr } from "../internal/expr.js";
import { getNodesByKind } from "../internal/query.js";

function evaluateBreakdown(
  schema: DomainSchema,
  snapshot: Snapshot,
  actionId: string
): GuardBreakdownFact[] {
  const action = schema.actions[actionId];
  if (!action?.available) {
    return [];
  }

  const timestamp = snapshot.meta.timestamp;
  const trace = createTraceContext(timestamp);
  const ctx = createContext(
    snapshot,
    schema,
    actionId,
    `actions.${actionId}.available`,
    undefined,
    trace
  );
  const expressions =
    action.available.kind === "and" || action.available.kind === "or"
      ? action.available.args
      : [action.available];

  return expressions.map((expr) => {
    const result = evaluateExpr(expr, ctx);
    return {
      expression: summarizeExpr(expr),
      evaluated: result.ok ? Boolean(result.value) : false,
      dependencies: collectExprReads(expr)
    };
  });
}

export function buildRuntimeOverlayContext(
  schema: DomainSchema,
  snapshot: Snapshot,
  graph: SemanticGraphIR
): RuntimeOverlayContext {
  const nodeValues: Record<string, unknown> = {};
  const explainedValues: RuntimeOverlayContext["explainedValues"] = {};
  const actionFacts: RuntimeOverlayContext["actionFacts"] = {};
  const availableActions = [...getAvailableActions(schema, snapshot)].sort();

  for (const node of getNodesByKind(graph, ["state"])) {
    const path = String(node.metadata.path);
    nodeValues[node.id] = getByPath(snapshot.data, path);
    try {
      const explained = explain(schema, snapshot, path);
      explainedValues[node.id] = {
        value: explained.value,
        deps: [...explained.deps]
      };
    } catch {
      // Some paths may not be explainable from Core; keep value-only facts.
    }
  }

  for (const node of getNodesByKind(graph, ["computed"])) {
    const path = String(node.metadata.path);
    nodeValues[node.id] = snapshot.computed[path];
    try {
      const explained = explain(schema, snapshot, path);
      explainedValues[node.id] = {
        value: explained.value,
        deps: [...explained.deps]
      };
    } catch {
      // Ignore explain errors for partially invalid schemas.
    }
  }

  for (const node of getNodesByKind(graph, ["action"])) {
    const actionId = String(node.metadata.actionId);
    const action = schema.actions[actionId];
    actionFacts[actionId] = {
      actionId,
      available: isActionAvailable(schema, snapshot, actionId),
      guardExpression: action?.available ? summarizeExpr(action.available) : undefined,
      breakdown: evaluateBreakdown(schema, snapshot, actionId)
    };
  }

  return {
    snapshotVersion: snapshot.meta.version,
    snapshotTimestamp: snapshot.meta.timestamp,
    nodeValues,
    explainedValues,
    actionFacts,
    availableActions
  };
}
