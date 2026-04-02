import type { RuntimeOverlayContext } from "../contracts/inputs.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";

import { cloneGraphForOverlay, finalizeMergedGraph } from "./graph-merge.js";
import { appendFact } from "../internal/graph.js";

export function applyRuntimeOverlay(
  baseGraph: SemanticGraphIR,
  runtime: RuntimeOverlayContext
): SemanticGraphIR {
  const graph = cloneGraphForOverlay(baseGraph);
  graph.overlayVersions.snapshotVersion = runtime.snapshotVersion;

  for (const [nodeId, value] of Object.entries(runtime.nodeValues)) {
    const node = graph.nodes.get(nodeId);
    if (!node) {
      continue;
    }

    graph.nodes.set(
      nodeId,
      appendFact(node, {
        key: "runtime:value",
        value,
        provenance: "runtime",
        observedAt: runtime.snapshotTimestamp
      })
    );
  }

  for (const [nodeId, explanation] of Object.entries(runtime.explainedValues)) {
    const node = graph.nodes.get(nodeId);
    if (!node) {
      continue;
    }

    const withValue = appendFact(node, {
      key: "runtime:explained-value",
      value: explanation.value,
      provenance: "runtime",
      observedAt: runtime.snapshotTimestamp
    });

    graph.nodes.set(
      nodeId,
      appendFact(withValue, {
        key: "runtime:deps",
        value: explanation.deps,
        provenance: "runtime",
        observedAt: runtime.snapshotTimestamp
      })
    );
  }

  for (const [actionId, fact] of Object.entries(runtime.actionFacts)) {
    const listedAvailable = runtime.availableActions.includes(actionId);
    for (const nodeId of [`action:${actionId}`, `guard:${actionId}`]) {
      const node = graph.nodes.get(nodeId);
      if (!node) {
        continue;
      }

      let enriched = appendFact(node, {
        key: "runtime:available",
        value: fact.available,
        provenance: "runtime",
        observedAt: runtime.snapshotTimestamp
      });

      if (fact.guardExpression) {
        enriched = appendFact(enriched, {
          key: "runtime:guard-expression",
          value: fact.guardExpression,
          provenance: "runtime",
          observedAt: runtime.snapshotTimestamp
        });
      }

      enriched = appendFact(enriched, {
        key: "runtime:guard-breakdown",
        value: fact.breakdown,
        provenance: "runtime",
        observedAt: runtime.snapshotTimestamp
      });

      if (nodeId === `action:${actionId}`) {
        enriched = appendFact(enriched, {
          key: "runtime:listed-available",
          value: listedAvailable,
          provenance: "runtime",
          observedAt: runtime.snapshotTimestamp
        });
      }

      graph.nodes.set(nodeId, enriched);
    }
  }

  return finalizeMergedGraph(graph);
}
