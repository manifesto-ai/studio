import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createStudioSession } from "../src/index.js";
import {
  createSampleSnapshot,
  sampleGovernance,
  sampleLineage,
  sampleSchema,
  sampleTrace
} from "./fixtures/sample-domain.js";
import { listSourceFiles, readText } from "./helpers.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPLANATION_ROOT = path.resolve(TEST_DIR, "../src/explanation");

describe("studio-core provenance and explanation isolation", () => {
  it("preserves overlay provenance on nodes, edges, and facts", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot(),
      trace: sampleTrace,
      lineage: sampleLineage,
      governance: sampleGovernance
    });
    const graph = session.getGraph("full");

    expect(
      graph.nodes
        .filter((node) => node.kind.startsWith("lineage-"))
        .every((node) => node.provenance === "lineage")
    ).toBe(true);
    expect(
      graph.nodes
        .filter((node) => node.kind.startsWith("governance-"))
        .every((node) => node.provenance === "governance")
    ).toBe(true);
    expect(
      graph.nodes
        .flatMap((node) => node.overlayFacts ?? [])
        .filter((fact) => fact.key.startsWith("runtime:"))
        .every((fact) => fact.provenance === "runtime")
    ).toBe(true);
    expect(
      graph.nodes
        .flatMap((node) => node.overlayFacts ?? [])
        .filter((fact) => fact.key.startsWith("trace:"))
        .every((fact) => fact.provenance === "trace")
    ).toBe(true);
    expect(
      graph.edges
        .filter((edge) => ["seals-into", "branches-from", "parent-of"].includes(edge.kind))
        .every((edge) => edge.provenance === "lineage")
    ).toBe(true);
    expect(
      graph.edges
        .filter((edge) => ["proposes", "approves", "gates"].includes(edge.kind))
        .every((edge) => edge.provenance === "governance")
    ).toBe(true);
  });

  it("keeps trace findings mapped to canonical trace evidence refs", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      trace: sampleTrace
    });
    const trace = session.analyzeTrace();

    expect(trace.status).toBe("ready");
    if (trace.status === "ready") {
      expect(
        trace.findings.every((finding) =>
          finding.evidence.every((evidence) => evidence.ref.nodeId.startsWith("trace:"))
        )
      ).toBe(true);
    }
  });

  it("keeps explanation modules free of raw artifact types", () => {
    const violations = listSourceFiles(EXPLANATION_ROOT)
      .filter((absolutePath) => {
        const source = readText(absolutePath);
        return (
          /import\s+type\s*{[^}]*\b(DomainSchema|Snapshot|TraceGraph|LineageExport|GovernanceExport)\b[^}]*}\s+from/.test(
            source
          ) ||
          /:\s*(DomainSchema|Snapshot|TraceGraph|LineageExport|GovernanceExport)\b/.test(
            source
          )
        );
      })
      .map((absolutePath) => path.relative(path.resolve(TEST_DIR, ".."), absolutePath));

    expect(violations).toEqual([]);
  });
});
