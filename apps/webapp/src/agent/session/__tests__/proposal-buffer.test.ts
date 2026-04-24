import { describe, expect, it } from "vitest";
import { createAgentProposal } from "../proposal-buffer.js";
import { verifyMelProposal } from "../proposal-verifier.js";
import todoSource from "@/fixtures/todo.mel?raw";

describe("proposal-buffer", () => {
  it("creates a single proposal record from verifier output", () => {
    const proposal = createAgentProposal({
      originalSource: "state { count: number = 0 }",
      proposedSource: "state { count: number = 1 }",
      title: "Update count default",
      rationale: "Small repair",
      now: new Date("2026-04-24T00:00:00.000Z"),
      verification: {
        status: "verified",
        diagnostics: [],
        schemaHash: "abc",
        summary: "proposal builds cleanly",
      },
    });

    expect(proposal.id).toMatch(/^proposal-/);
    expect(proposal.status).toBe("verified");
    expect(proposal.title).toBe("Update count default");
    expect(proposal.schemaHash).toBe("abc");
  });
});

describe("verifyMelProposal", () => {
  it("accepts valid MEL", async () => {
    const result = await verifyMelProposal(todoSource);

    expect(result.status).toBe("verified");
    expect(result.schemaHash).toEqual(expect.any(String));
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("rejects compiler errors as diagnostics", async () => {
    const result = await verifyMelProposal("this is not valid MEL");

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.severity).toBe("error");
  });

  it("rejects reserved Manifesto namespaces before build", async () => {
    const result = await verifyMelProposal(
      'state { $host: string = "" }',
    );

    expect(result.status).toBe("invalid");
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "agent/reserved-namespace",
    });
  });
});
