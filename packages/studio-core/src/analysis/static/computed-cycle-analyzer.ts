import type { Finding } from "../../contracts/findings.js";
import type { SemanticGraphIR } from "../../contracts/graph-ir.js";

import { createFinding } from "../../internal/findings.js";
import { getNode, getNodesByKind, getOutgoingEdges } from "../../internal/query.js";

export function analyzeComputedCycles(graph: SemanticGraphIR): Finding[] {
  const findings: Finding[] = [];
  const computedNodes = getNodesByKind(graph, ["computed"]);
  const computedIds = new Set(computedNodes.map((node) => node.id));
  const visited = new Set<string>();
  const stack = new Set<string>();
  const recordedCycles = new Set<string>();

  function visit(nodeId: string, path: string[]): void {
    visited.add(nodeId);
    stack.add(nodeId);
    const outgoing = getOutgoingEdges(graph, nodeId, "depends-on").filter((edge) =>
      computedIds.has(edge.target)
    );

    for (const edge of outgoing) {
      if (!visited.has(edge.target)) {
        visit(edge.target, [...path, edge.target]);
        continue;
      }

      if (!stack.has(edge.target)) {
        continue;
      }

      const cycleStart = path.indexOf(edge.target);
      const cycle = [...path.slice(cycleStart), edge.target];
      const cycleKey = cycle.join("->");
      if (recordedCycles.has(cycleKey)) {
        continue;
      }

      recordedCycles.add(cycleKey);
      const subject = getNode(graph, edge.target);
      if (!subject) {
        continue;
      }

      findings.push(
        createFinding({
          kind: "cyclic-dependency",
          subject: { nodeId: subject.id, path: subject.sourcePath },
          message: `Computed dependency cycle detected: ${cycle
            .map((id) => String(getNode(graph, id)?.metadata.path ?? id))
            .join(" -> ")}.`,
          evidence: cycle
            .map((id) => getNode(graph, id))
            .filter(Boolean)
            .map((node) => ({
              ref: { nodeId: node!.id, path: node!.sourcePath },
              role: "cycle-member"
            }))
        })
      );
    }

    stack.delete(nodeId);
  }

  for (const node of computedNodes) {
    if (!visited.has(node.id)) {
      visit(node.id, [node.id]);
    }
  }

  return findings;
}

