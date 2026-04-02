import type { DomainSchema, FieldSpec } from "../contracts/inputs.js";
import type {
  GraphNode,
  SemanticGraphIR
} from "../contracts/graph-ir.js";

import { flattenFieldSpec } from "../internal/field.js";
import { analyzeFlow } from "../internal/flow.js";
import { addEdge, addNode, finalizeGraph } from "../internal/graph.js";
import { collectExprReads, summarizeExpr } from "../internal/expr.js";
import { topLevelPath } from "../internal/path.js";

function stateNodeId(path: string): string {
  return `state:${path}`;
}

function computedNodeId(path: string): string {
  return `computed:${path}`;
}

function actionNodeId(actionId: string): string {
  return `action:${actionId}`;
}

function guardNodeId(actionId: string): string {
  return `guard:${actionId}`;
}

function effectNodeId(actionId: string, index: number): string {
  return `effect:${actionId}:${index}`;
}

function patchNodeId(actionId: string, path: string): string {
  return `patch:${actionId}:${path}`;
}

function resolveRefNodeId(
  ref: string,
  statePaths: Set<string>,
  computedPaths: Set<string>
): string | undefined {
  if (statePaths.has(ref)) {
    return stateNodeId(ref);
  }

  if (computedPaths.has(ref)) {
    return computedNodeId(ref);
  }

  return undefined;
}

function fieldTypeLabel(field: FieldSpec["type"]): string {
  return typeof field === "string" ? field : "enum";
}

export function buildStaticGraph(schema: DomainSchema): SemanticGraphIR {
  const graph: SemanticGraphIR = {
    nodes: new Map(),
    edges: [],
    schemaHash: schema.hash,
    overlayVersions: {
      schemaHash: schema.hash
    }
  };

  const flattenedState = flattenFieldSpec(schema.state.fields);
  const statePaths = new Set(flattenedState.map((entry) => entry.path));
  const computedPaths = new Set(Object.keys(schema.computed.fields));

  for (const entry of flattenedState) {
    addNode(graph, {
      id: stateNodeId(entry.path),
      kind: "state",
      sourcePath: `state.${entry.path}`,
      provenance: "static",
      metadata: {
        path: entry.path,
        topLevelPath: topLevelPath(entry.path),
        type: fieldTypeLabel(entry.field.type),
        required: entry.field.required,
        hasDefault: Object.prototype.hasOwnProperty.call(entry.field, "default"),
        isLeaf: entry.isLeaf,
        hasNestedFields: Boolean(entry.field.fields)
      },
      overlayFacts: []
    });
  }

  for (const [computedName, computed] of Object.entries(schema.computed.fields)) {
    addNode(graph, {
      id: computedNodeId(computedName),
      kind: "computed",
      sourcePath: `computed.${computedName}`,
      provenance: "static",
      metadata: {
        path: computedName,
        deps: [...computed.deps],
        description: computed.description,
        reads: collectExprReads(computed.expr),
        expression: summarizeExpr(computed.expr),
        expr: computed.expr
      },
      overlayFacts: []
    });

    for (const dependency of computed.deps) {
      const target = resolveRefNodeId(dependency, statePaths, computedPaths);
      if (!target) {
        continue;
      }

      addEdge(graph, {
        source: computedNodeId(computedName),
        target,
        kind: "depends-on",
        provenance: "static"
      });
    }
  }

  for (const [actionId, action] of Object.entries(schema.actions)) {
    const flowBasePath = `actions.${actionId}.flow`;
    const flow = analyzeFlow(action.flow, flowBasePath);

    addNode(graph, {
      id: actionNodeId(actionId),
      kind: "action",
      sourcePath: `actions.${actionId}`,
      provenance: "static",
      metadata: {
        actionId,
        description: action.description,
        calledActions: flow.calls.map((entry) => entry.flow),
        reads: flow.reads
      },
      overlayFacts: []
    });

    for (const read of flow.reads) {
      const target = resolveRefNodeId(read, statePaths, computedPaths);
      if (!target) {
        continue;
      }

      addEdge(graph, {
        source: actionNodeId(actionId),
        target,
        kind: "reads",
        provenance: "static"
      });
    }

    for (const call of flow.calls) {
      if (!(call.flow in schema.actions)) {
        continue;
      }

      addEdge(graph, {
        source: actionNodeId(actionId),
        target: actionNodeId(call.flow),
        kind: "depends-on",
        provenance: "static",
        metadata: {
          sourcePath: call.sourcePath
        }
      });
    }

    if (action.available) {
      addNode(graph, {
        id: guardNodeId(actionId),
        kind: "guard",
        sourcePath: `actions.${actionId}.available`,
        provenance: "static",
        metadata: {
          actionId,
          expression: summarizeExpr(action.available),
          reads: collectExprReads(action.available),
          expr: action.available
        },
        overlayFacts: []
      });

      addEdge(graph, {
        source: actionNodeId(actionId),
        target: guardNodeId(actionId),
        kind: "enables",
        provenance: "static"
      });
      addEdge(graph, {
        source: guardNodeId(actionId),
        target: actionNodeId(actionId),
        kind: "blocks",
        provenance: "static"
      });

      for (const read of collectExprReads(action.available)) {
        const target = resolveRefNodeId(read, statePaths, computedPaths);
        if (!target) {
          continue;
        }

        addEdge(graph, {
          source: guardNodeId(actionId),
          target,
          kind: "reads",
          provenance: "static"
        });
      }
    }

    const patchTargets = new Map<string, string>();
    for (const patch of flow.patches) {
      const patchId = patchNodeId(actionId, patch.path);
      if (!patchTargets.has(patch.path)) {
        patchTargets.set(patch.path, patchId);
        addNode(graph, {
          id: patchId,
          kind: "patch-target",
          sourcePath: patch.sourcePath,
          provenance: "static",
          metadata: {
            actionId,
            path: patch.path,
            op: patch.op
          },
          overlayFacts: []
        });
      }

      addEdge(graph, {
        source: actionNodeId(actionId),
        target: patchId,
        kind: "produces",
        provenance: "static"
      });

      const target = statePaths.has(patch.path)
        ? stateNodeId(patch.path)
        : statePaths.has(topLevelPath(patch.path))
          ? stateNodeId(topLevelPath(patch.path))
          : undefined;

      if (target) {
        addEdge(graph, {
          source: patchId,
          target,
          kind: "writes",
          provenance: "static"
        });
      }
    }

    for (const effect of flow.effects) {
      const effectId = effectNodeId(actionId, effect.index);
      addNode(graph, {
        id: effectId,
        kind: "effect",
        sourcePath: effect.sourcePath,
        provenance: "static",
        metadata: {
          actionId,
          effectType: effect.type,
          index: effect.index
        },
        overlayFacts: []
      });

      addEdge(graph, {
        source: actionNodeId(actionId),
        target: effectId,
        kind: "produces",
        provenance: "static"
      });
    }
  }

  return finalizeGraph(graph);
}
