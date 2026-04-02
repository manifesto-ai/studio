import type { GovernanceExport } from "../contracts/inputs.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";

import { addEdge, addNode } from "../internal/graph.js";
import { cloneGraphForOverlay, finalizeMergedGraph } from "./graph-merge.js";

export function applyGovernanceOverlay(
  baseGraph: SemanticGraphIR,
  governance: GovernanceExport
): SemanticGraphIR {
  const graph = cloneGraphForOverlay(baseGraph);
  graph.overlayVersions.governanceEpoch = Math.max(
    0,
    ...[...governance.gates.values()].map((gate) => gate.epoch)
  );

  for (const binding of governance.bindings) {
    addNode(graph, {
      id: `gov:actor:${binding.actorId}`,
      kind: "governance-actor",
      sourcePath: `governance.bindings.${binding.actorId}`,
      provenance: "governance",
      metadata: {
        actorId: binding.actorId,
        authorityId: binding.authorityId,
        permissions: [...binding.permissions]
      },
      overlayFacts: []
    });
  }

  for (const proposal of governance.proposals.values()) {
    addNode(graph, {
      id: `gov:proposal:${proposal.id}`,
      kind: "governance-proposal",
      sourcePath: `governance.proposals.${proposal.id}`,
      provenance: "governance",
      metadata: {
        proposalId: proposal.id,
        branchId: proposal.branchId,
        stage: proposal.stage,
        outcome: proposal.outcome,
        actorId: proposal.actorId,
        createdAt: proposal.createdAt,
        terminalizedAt: proposal.terminalizedAt
      },
      overlayFacts: []
    });

    addEdge(graph, {
      source: `gov:actor:${proposal.actorId}`,
      target: `gov:proposal:${proposal.id}`,
      kind: "proposes",
      provenance: "governance"
    });
  }

  for (const gate of governance.gates.values()) {
    addNode(graph, {
      id: `gov:gate:${gate.branchId}`,
      kind: "governance-gate",
      sourcePath: `governance.gates.${gate.branchId}`,
      provenance: "governance",
      metadata: {
        branchId: gate.branchId,
        locked: gate.locked,
        currentProposalId: gate.currentProposalId,
        epoch: gate.epoch
      },
      overlayFacts: []
    });

    if (gate.currentProposalId) {
      addEdge(graph, {
        source: `gov:proposal:${gate.currentProposalId}`,
        target: `gov:gate:${gate.branchId}`,
        kind: "gates",
        provenance: "governance"
      });
    }
  }

  return finalizeMergedGraph(graph);
}

