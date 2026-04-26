import { describe, expect, it, vi } from "vitest";
import { compileMelModule } from "@manifesto-ai/compiler";
import {
  createAddActionTool,
  createAddComputedTool,
  createAddStateFieldTool,
  createCommitWorkspaceTool,
  createInspectWorkspaceTool,
  createPopLastOpTool,
  createRemoveDeclarationTool,
  createReplaceActionBodyTool,
  createReplaceComputedExprTool,
  type CommitWorkspaceContext,
  type WorkspaceToolContext,
} from "../workspace-tools.js";
import { createWorkspace, type Workspace } from "../../workspace/workspace.js";

const FIXTURE = `domain Counter {
  state {
    count: number = 0
  }

  computed doubled = count + count

  action tick() {
    onceIntent {
      patch count = count + 1
    }
  }
}`;

function bootWorkspace(): Workspace {
  const result = compileMelModule(FIXTURE, { mode: "module" });
  if (result.module === null) {
    throw new Error(`fixture failed: ${JSON.stringify(result.errors)}`);
  }
  return createWorkspace({ baseSource: FIXTURE, baseModule: result.module });
}

function makeCtx(ws: Workspace | null): WorkspaceToolContext {
  return { getWorkspace: () => ws };
}

describe("workspace op tools", () => {
  it("addStateField applies a clean op and grows the stack", async () => {
    const ws = bootWorkspace();
    const result = await createAddStateFieldTool().run(
      { name: "lastTouched", type: "number", defaultValue: 0 },
      makeCtx(ws),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.applied).toBe(true);
    expect(result.output.opKind).toBe("addStateField");
    expect(result.output.target).toBe("lastTouched");
    expect(result.output.status).toBe("clean");
    expect(result.output.canCommit).toBe(true);
    expect(result.output.stackDepth).toBe(1);
  });

  it("addAction surfaces diagnostics when body fails to compile", async () => {
    const ws = bootWorkspace();
    const result = await createAddActionTool().run(
      {
        name: "explode",
        params: [],
        body: `{
          onceIntent {
            patch unknownField = unknownReference + 1
          }
        }`,
      },
      makeCtx(ws),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.applied).toBe(false);
    expect(result.output.status).toBe("broken");
    expect(result.output.canCommit).toBe(false);
    expect(result.output.diagnosticCount).toBeGreaterThan(0);
  });

  it("addComputed validates input and rejects empty expr", async () => {
    const ws = bootWorkspace();
    const result = await createAddComputedTool().run(
      { name: "halved", expr: "" },
      makeCtx(ws),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_input");
  });

  it("replaceActionBody validates target prefix", async () => {
    const ws = bootWorkspace();
    const bad = await createReplaceActionBodyTool().run(
      { target: "computed:doubled", body: "{ }" },
      makeCtx(ws),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.kind).toBe("invalid_input");
  });

  it("replaceComputedExpr replaces the doubled expression", async () => {
    const ws = bootWorkspace();
    const result = await createReplaceComputedExprTool().run(
      { target: "computed:doubled", expr: "count * 3" },
      makeCtx(ws),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.applied).toBe(true);
    expect(result.output.target).toBe("computed:doubled");
  });

  it("removeDeclaration removes a state field", async () => {
    const ws = bootWorkspace();
    const result = await createRemoveDeclarationTool().run(
      { target: "computed:doubled" },
      makeCtx(ws),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.opKind).toBe("removeDeclaration");
  });

  it("returns runtime_error when no workspace is bound", async () => {
    const result = await createAddStateFieldTool().run(
      { name: "x", type: "number", defaultValue: 0 },
      makeCtx(null),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("runtime_error");
  });
});

describe("workspace control tools", () => {
  it("popLastOp undoes the last op", async () => {
    const ws = bootWorkspace();
    await createAddStateFieldTool().run(
      { name: "lastTouched", type: "number", defaultValue: 0 },
      makeCtx(ws),
    );
    const popped = await createPopLastOpTool().run({}, makeCtx(ws));
    expect(popped.ok).toBe(true);
    if (!popped.ok) return;
    expect(popped.output.popped).toBe(true);
    expect(popped.output.stackDepth).toBe(0);
    expect(popped.output.canCommit).toBe(false);
  });

  it("inspectWorkspace returns the current projection", async () => {
    const ws = bootWorkspace();
    await createAddStateFieldTool().run(
      { name: "lastTouched", type: "number", defaultValue: 0 },
      makeCtx(ws),
    );
    const inspect = await createInspectWorkspaceTool().run({}, makeCtx(ws));
    expect(inspect.ok).toBe(true);
    if (!inspect.ok) return;
    expect(inspect.output.stackDepth).toBe(1);
    expect(inspect.output.canCommit).toBe(true);
    expect(inspect.output.stack[0]).toMatchObject({
      kind: "addStateField",
      target: "lastTouched",
    });
  });
});

describe("commitWorkspace", () => {
  function makeCommitCtx(ws: Workspace | null) {
    const verify = vi.fn(async () => ({
      status: "verified" as const,
      diagnostics: [] as readonly never[],
      schemaHash: "h-test",
      summary: "proposal builds cleanly",
    }));
    const setProposal = vi.fn();
    const concludeAgentTurn = vi.fn(async () => {});
    const ctx: CommitWorkspaceContext = {
      getWorkspace: () => ws,
      getOriginalSource: () => FIXTURE,
      verify,
      setProposal,
      concludeAgentTurn,
    };
    return { ctx, verify, setProposal, concludeAgentTurn };
  }

  it("commits a clean workspace into a verified proposal and ends the turn", async () => {
    const ws = bootWorkspace();
    await createAddStateFieldTool().run(
      { name: "lastTouched", type: "number", defaultValue: 0 },
      makeCtx(ws),
    );
    const { ctx, setProposal, concludeAgentTurn } = makeCommitCtx(ws);

    const result = await createCommitWorkspaceTool().run(
      { title: "Add lastTouched", rationale: "track recency" },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.committed).toBe(true);
    expect(result.output.turnEnded).toBe(true);
    expect(result.output.status).toBe("verified");
    expect(setProposal).toHaveBeenCalledTimes(1);
    expect(concludeAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("rejects commit when workspace is broken", async () => {
    const ws = bootWorkspace();
    await createAddActionTool().run(
      {
        name: "explode",
        params: [],
        body: `{ onceIntent { patch unknownField = unknownReference } }`,
      },
      makeCtx(ws),
    );
    const { ctx, setProposal, concludeAgentTurn } = makeCommitCtx(ws);
    const result = await createCommitWorkspaceTool().run(
      { title: "broken" },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("runtime_error");
    expect(setProposal).not.toHaveBeenCalled();
    expect(concludeAgentTurn).not.toHaveBeenCalled();
  });

  it("rejects commit when stack is empty", async () => {
    const ws = bootWorkspace();
    const { ctx } = makeCommitCtx(ws);
    const result = await createCommitWorkspaceTool().run(
      { title: "nothing" },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it("requires a non-empty title", async () => {
    const ws = bootWorkspace();
    await createAddStateFieldTool().run(
      { name: "lastTouched", type: "number", defaultValue: 0 },
      makeCtx(ws),
    );
    const { ctx } = makeCommitCtx(ws);
    const result = await createCommitWorkspaceTool().run(
      { title: "" },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_input");
  });
});
