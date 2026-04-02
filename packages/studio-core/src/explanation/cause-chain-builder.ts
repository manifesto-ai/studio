import type { CauseChain, CauseNode } from "../contracts/explanations.js";
import type { Finding } from "../contracts/findings.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";

function causeFromNode(
  graph: SemanticGraphIR,
  nodeId: string,
  fallback: string,
  isRoot: boolean
): CauseNode {
  const node = graph.nodes.get(nodeId);

  return {
    ref: { nodeId, path: node?.sourcePath },
    fact: fallback,
    provenance: node?.provenance ?? "static",
    isRoot
  };
}

export function buildCauseChain(
  graph: SemanticGraphIR,
  finding: Finding
): CauseChain {
  const evidenceNodes = finding.evidence.map((evidence) =>
    causeFromNode(
      graph,
      evidence.ref.nodeId,
      `${evidence.role}: ${evidence.ref.path ?? evidence.ref.nodeId}`,
      false
    )
  );

  const observation = causeFromNode(
    graph,
    finding.subject.nodeId,
    finding.message,
    false
  );

  const root = evidenceNodes.at(-1) ?? {
    ...observation,
    isRoot: true
  };

  const path = [...evidenceNodes.slice(0, -1), root].map((node, index, array) => ({
    ...node,
    isRoot: index === array.length - 1
  }));

  return {
    observation,
    path,
    root: path.at(-1) ?? root,
    summary: finding.message
  };
}

