import { describe, expect, it, vi } from "vitest";
import {
  createAuthorMelProposalTool,
  type AuthorMelProposalContext,
} from "../author-mel-proposal.js";
import {
  createCreateProposalTool,
  type CreateProposalContext,
} from "../create-proposal.js";
import {
  createSimulateIntentTool,
  type SimulateIntentContext,
} from "../simulate-intent.js";
import {
  createSourceMapTool,
  type SourceMapContext,
} from "../source-map.js";

describe("simulateIntent", () => {
  it("returns compact projected impact for admitted intents", async () => {
    const ctx: SimulateIntentContext = {
      createIntent: (action) => ({ type: action }),
      explainIntent: () => ({
        kind: "admitted",
        available: true,
        dispatchable: true,
        changedPaths: ["data.todos[0]"],
        newAvailableActions: ["clearDone"],
        requirements: [],
      }),
      simulate: () => ({
        changedPaths: ["data.todos[0]", "computed.todoCount"],
        newAvailableActions: ["clearDone"],
        requirements: [{ id: "r1", type: "email" }],
        status: "idle",
        meta: { schemaHash: "hash1" },
      }),
      listActionNames: () => ["addTodo"],
    };
    const result = await createSimulateIntentTool().run(
      { action: "addTodo", args: [{ title: "x" }] },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.status).toBe("simulated");
    expect(result.output.changedPaths).toEqual([
      "data.todos[0]",
      "computed.todoCount",
    ]);
    expect(result.output.requirementCount).toBe(1);
    expect(result.output.schemaHash).toBe("hash1");
  });

  it("does not simulate blocked intents", async () => {
    const simulate = vi.fn();
    const ctx: SimulateIntentContext = {
      createIntent: (action) => ({ type: action }),
      explainIntent: () => ({
        kind: "blocked",
        available: false,
        dispatchable: false,
        blockers: [{ layer: "available", evaluatedResult: false }],
      }),
      simulate,
    };
    const result = await createSimulateIntentTool().run(
      { action: "shoot" },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(simulate).not.toHaveBeenCalled();
    if (result.ok) expect(result.output.status).toBe("blocked");
  });
});

describe("locateSource", () => {
  it("normalizes graph state node ids to source-map local keys", async () => {
    const ctx: SourceMapContext = {
      getSource: () => "state {\n  todos: string = \"\"\n}\n",
      getModule: () =>
        ({
          schema: { hash: "h1" },
          sourceMap: {
            entries: {
              "state_field:todos": {
                span: {
                  start: { line: 2, column: 3 },
                  end: { line: 2, column: 24 },
                },
              },
            },
          },
        }) as never,
    };

    const result = await createSourceMapTool().run(
      { target: "state:todos" },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.localKey).toBe("state_field:todos");
    expect(result.output.preview).toContain("2:   todos");
  });
});

describe("createProposal", () => {
  it("verifies and stores a full-source proposal without applying it", async () => {
    let stored = null as unknown;
    const ctx: CreateProposalContext = {
      getOriginalSource: () => "state { count: number = 0 }",
      verify: async () => ({
        status: "verified",
        diagnostics: [],
        schemaHash: "h1",
        summary: "proposal builds cleanly",
      }),
      setProposal: (proposal) => {
        stored = proposal;
      },
    };

    const result = await createCreateProposalTool().run(
      {
        proposedSource: "state { count: number = 1 }",
        title: "Change default",
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.status).toBe("verified");
    expect(stored).toMatchObject({
      title: "Change default",
      proposedSource: "state { count: number = 1 }",
    });
  });

  it("rejects unchanged source", async () => {
    const result = await createCreateProposalTool().run(
      { proposedSource: "state {}" },
      {
        getOriginalSource: () => "state {}",
        verify: async () => {
          throw new Error("should not verify unchanged source");
        },
        setProposal: () => {},
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid_input");
  });
});

describe("authorMelProposal", () => {
  it("delegates authoring, verifies the returned source, and stores a proposal", async () => {
    let stored = null as unknown;
    const ctx: AuthorMelProposalContext = {
      getOriginalSource: () => "domain Todo { state { count: number = 0 } }",
      draft: async () => ({
        ok: true,
        output: {
          title: "Add increment",
          rationale: "Adds a write action.",
          proposedSource:
            "domain Todo { state { count: number = 0 } action increment() { onceIntent { patch count = add(count, 1) } } }",
          status: "verified",
          diagnostics: [],
          schemaHash: "h1",
          summary: "workspace source builds cleanly",
        },
      }),
      verify: async () => ({
        status: "verified",
        diagnostics: [],
        schemaHash: "h2",
        summary: "proposal builds cleanly",
      }),
      setProposal: (proposal) => {
        stored = proposal;
      },
    };

    const result = await createAuthorMelProposalTool().run(
      {
        request: "increment action 추가",
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.status).toBe("verified");
    expect(result.output.authorStatus).toBe("verified");
    expect(stored).toMatchObject({
      title: "Add increment",
      schemaHash: "h2",
    });
  });

  it("rejects unchanged author drafts", async () => {
    const source = "domain Todo { state { count: number = 0 } }";
    const result = await createAuthorMelProposalTool().run(
      { request: "change source" },
      {
        getOriginalSource: () => source,
        draft: async () => ({
          ok: true,
          output: {
            title: "No change",
            rationale: "",
            proposedSource: source,
            status: "verified",
            diagnostics: [],
            schemaHash: "h1",
            summary: "workspace source builds cleanly",
          },
        }),
        verify: async () => {
          throw new Error("should not verify unchanged author draft");
        },
        setProposal: () => {},
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid_input");
  });
});
