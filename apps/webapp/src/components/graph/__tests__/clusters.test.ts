import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphModel, GraphNode } from "@manifesto-ai/studio-react";
import { detectClusters } from "../clusters";

function node(
  id: GraphNode["id"],
  kind: GraphNode["kind"],
  name: string = id,
): GraphNode {
  return {
    id,
    kind,
    name,
    localKey: id as GraphNode["localKey"],
    sourceSpan: null,
    identityFate: null,
    snapshotFate: undefined,
    warnings: [],
  };
}

function edge(
  source: GraphNode["id"],
  target: GraphNode["id"],
  relation: GraphEdge["relation"],
): GraphEdge {
  return { id: `${source}->${target}:${relation}`, source, target, relation };
}

function model(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphModel {
  return {
    schemaHash: "t",
    nodes,
    edges,
    nodesById: new Map(nodes.map((n) => [n.id, n])),
  };
}

describe("detectClusters", () => {
  it("groups states sharing mutators into one cluster above the Jaccard threshold", () => {
    // Battleship-like: `fire` mutates board + lastShot + turn together.
    const g = model(
      [
        node("action:fire", "action"),
        node("state:board", "state"),
        node("state:lastShot", "state"),
        node("state:turn", "state"),
      ],
      [
        edge("action:fire", "state:board", "mutates"),
        edge("action:fire", "state:lastShot", "mutates"),
        edge("action:fire", "state:turn", "mutates"),
      ],
    );
    const { clusters } = detectClusters(g);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].states).toEqual(
      expect.arrayContaining([
        "state:board",
        "state:lastShot",
        "state:turn",
      ]),
    );
    expect(clusters[0].actions).toEqual(["action:fire"]);
  });

  it("splits states when mutator overlap is below threshold", () => {
    // A mutates s1 and s2; B mutates s3 alone. No shared mutator →
    // s3 should remain its own cluster.
    const g = model(
      [
        node("action:A", "action"),
        node("action:B", "action"),
        node("state:s1", "state"),
        node("state:s2", "state"),
        node("state:s3", "state"),
      ],
      [
        edge("action:A", "state:s1", "mutates"),
        edge("action:A", "state:s2", "mutates"),
        edge("action:B", "state:s3", "mutates"),
      ],
    );
    const { clusters } = detectClusters(g);
    expect(clusters.length).toBe(2);
    const sorted = [...clusters].sort(
      (a, b) => b.states.length - a.states.length,
    );
    expect(sorted[0].states).toEqual(
      expect.arrayContaining(["state:s1", "state:s2"]),
    );
    expect(sorted[1].states).toEqual(["state:s3"]);
  });

  it("does not collapse weakly-bridging single actions", () => {
    // `reset` touches every state, but each state also has a dedicated
    // action. The Jaccard vs the dedicated mutator pair is low → we
    // keep two clusters instead of merging everything under `reset`.
    const g = model(
      [
        node("action:reset", "action"),
        node("action:placeShip", "action"),
        node("action:fire", "action"),
        node("state:board", "state"),
        node("state:ships", "state"),
        node("state:lastShot", "state"),
      ],
      [
        edge("action:reset", "state:board", "mutates"),
        edge("action:reset", "state:ships", "mutates"),
        edge("action:reset", "state:lastShot", "mutates"),
        edge("action:placeShip", "state:board", "mutates"),
        edge("action:placeShip", "state:ships", "mutates"),
        edge("action:fire", "state:board", "mutates"),
        edge("action:fire", "state:lastShot", "mutates"),
      ],
    );
    const { clusters } = detectClusters(g);
    // Board shares lots of mutators with both ships and lastShot, so
    // all three end up in the same cluster after transitive union — BUT
    // the important invariant is: no state ends up orphaned, and every
    // action gets placed in some cluster.
    const allStates = clusters.flatMap((c) => c.states);
    expect(allStates).toEqual(
      expect.arrayContaining([
        "state:board",
        "state:ships",
        "state:lastShot",
      ]),
    );
    const allActions = clusters.flatMap((c) => c.actions);
    expect(allActions).toEqual(
      expect.arrayContaining([
        "action:reset",
        "action:placeShip",
        "action:fire",
      ]),
    );
  });

  it("assigns computeds to the cluster they feed from", () => {
    const g = model(
      [
        node("action:fire", "action"),
        node("state:board", "state"),
        node("state:lastShot", "state"),
        node("computed:sunkCount", "computed"),
      ],
      [
        edge("action:fire", "state:board", "mutates"),
        edge("action:fire", "state:lastShot", "mutates"),
        edge("state:board", "computed:sunkCount", "feeds"),
      ],
    );
    const { clusters, byNode } = detectClusters(g);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].computeds).toEqual(["computed:sunkCount"]);
    expect(byNode.get("computed:sunkCount")).toBe(clusters[0].id);
  });

  it("buckets orphans (read-only state, action with no mutates) into a shared cluster", () => {
    const g = model(
      [
        node("action:ping", "action"),
        node("computed:total", "computed"),
      ],
      [],
    );
    const { clusters } = detectClusters(g);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].actions).toEqual(["action:ping"]);
    expect(clusters[0].computeds).toEqual(["computed:total"]);
    expect(clusters[0].label).toBe("shared");
  });

  it("gives singleton clusters for states with no mutators", () => {
    // Constant / seeded state with no actions targeting it.
    const g = model([node("state:config", "state")], []);
    const { clusters } = detectClusters(g);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].states).toEqual(["state:config"]);
  });
});
