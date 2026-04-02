import type { LineageExport } from "../contracts/inputs.js";
import type { SemanticGraphIR } from "../contracts/graph-ir.js";

import { addEdge, addNode } from "../internal/graph.js";
import { cloneGraphForOverlay, finalizeMergedGraph } from "./graph-merge.js";

export function applyLineageOverlay(
  baseGraph: SemanticGraphIR,
  lineage: LineageExport
): SemanticGraphIR {
  const graph = cloneGraphForOverlay(baseGraph);
  graph.overlayVersions.lineageEpoch = Math.max(
    0,
    ...lineage.branches.map((branch) => branch.epoch)
  );

  for (const branch of lineage.branches) {
    const branchId = `lineage:branch:${branch.id}`;
    addNode(graph, {
      id: branchId,
      kind: "lineage-branch",
      sourcePath: `lineage.branches.${branch.id}`,
      provenance: "lineage",
      metadata: {
        branchId: branch.id,
        epoch: branch.epoch,
        active: branch.id === lineage.activeBranchId
      },
      overlayFacts: []
    });

    if (branch.headWorldId) {
      const headMarkerId = `lineage:head:${branch.id}`;
      addNode(graph, {
        id: headMarkerId,
        kind: "lineage-head",
        sourcePath: `lineage.branches.${branch.id}.head`,
        provenance: "lineage",
        metadata: {
          branchId: branch.id,
          worldId: branch.headWorldId
        },
        overlayFacts: []
      });
      addEdge(graph, {
        source: branchId,
        target: headMarkerId,
        kind: "parent-of",
        provenance: "lineage"
      });
      addEdge(graph, {
        source: headMarkerId,
        target: `lineage:world:${branch.headWorldId}`,
        kind: "branches-from",
        provenance: "lineage"
      });
    }

    if (branch.tipWorldId) {
      const tipMarkerId = `lineage:tip:${branch.id}`;
      addNode(graph, {
        id: tipMarkerId,
        kind: "lineage-tip",
        sourcePath: `lineage.branches.${branch.id}.tip`,
        provenance: "lineage",
        metadata: {
          branchId: branch.id,
          worldId: branch.tipWorldId
        },
        overlayFacts: []
      });
      addEdge(graph, {
        source: branchId,
        target: tipMarkerId,
        kind: "parent-of",
        provenance: "lineage"
      });
      addEdge(graph, {
        source: tipMarkerId,
        target: `lineage:world:${branch.tipWorldId}`,
        kind: "seals-into",
        provenance: "lineage"
      });
    }
  }

  for (const world of lineage.worlds.values()) {
    addNode(graph, {
      id: `lineage:world:${world.worldId}`,
      kind: "lineage-world",
      sourcePath: `lineage.worlds.${world.worldId}`,
      provenance: "lineage",
      metadata: {
        worldId: world.worldId,
        terminalStatus: world.terminalStatus,
        snapshotHash: world.snapshotHash,
        schemaHash: world.schemaHash,
        createdAt: world.createdAt
      },
      overlayFacts: []
    });

    if (world.parentWorldId) {
      addEdge(graph, {
        source: `lineage:world:${world.parentWorldId}`,
        target: `lineage:world:${world.worldId}`,
        kind: "parent-of",
        provenance: "lineage"
      });
    }
  }

  return finalizeMergedGraph(graph);
}

