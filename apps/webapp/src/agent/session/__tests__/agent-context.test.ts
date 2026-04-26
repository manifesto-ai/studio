import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  readStudioAgentContext,
  type AgentContextCore,
} from "../agent-context.js";

function makeCore(overrides: Partial<AgentContextCore> = {}): AgentContextCore {
  const defaults: AgentContextCore = {
    getModule: () =>
      ({
        schema: {
          id: "Todo",
          hash: "schema-hash",
          types: {
            Priority: {
              definition: {
                kind: "union",
                types: [
                  { kind: "literal", value: "low" },
                  { kind: "literal", value: "med" },
                  { kind: "literal", value: "high" },
                ],
              },
            },
          },
          state: { fields: { todos: {}, filter: {} } },
          computed: { fields: { openCount: {} } },
          actions: {
            addTodo: {
              params: ["title", "priority"],
              inputType: {
                kind: "object",
                fields: {
                  title: {
                    type: { kind: "primitive", type: "string" },
                    optional: false,
                  },
                  priority: {
                    type: { kind: "ref", name: "Priority" },
                    optional: false,
                  },
                },
              },
              description: "Add a todo item.",
            },
            clearDone: {
              params: [],
              dispatchable: {},
            },
          },
        },
        graph: {
          nodes: [{ id: "state:todos" }, { id: "action:addTodo" }],
          edges: [{ source: "action:addTodo", target: "state:todos" }],
        },
      }) as unknown as ReturnType<AgentContextCore["getModule"]>,
    getDiagnostics: () => [],
  };
  return { ...defaults, ...overrides };
}

describe("readStudioAgentContext", () => {
  it("returns a compact domain summary instead of raw MEL", () => {
    const ctx = readStudioAgentContext(makeCore(), "domain Todo {\n}");

    expect(ctx.hasModule).toBe(true);
    expect(ctx).not.toHaveProperty("melSource");
    expect(ctx.domainSummary).toMatchObject({
      schemaId: "Todo",
      schemaHash: "schema-hash",
      source: { present: true, lineCount: 2 },
      stateFields: ["filter", "todos"],
      computedFields: ["openCount"],
      graph: { nodeCount: 2, edgeCount: 1 },
    });
    expect(ctx.domainSummary.actions).toEqual([
      {
        name: "addTodo",
        params: ["title", "priority"],
        paramHints: ['title: string', 'priority: "low" | "med" | "high"'],
        inputHint: 'title: string, priority: "low" | "med" | "high"',
        hasDispatchableGate: false,
        description: "Add a todo item.",
      },
      {
        name: "clearDone",
        params: [],
        paramHints: [],
        inputHint: null,
        hasDispatchableGate: true,
        description: null,
      },
    ]);
  });

  it("returns hasModule:false with diagnostics and source stats", () => {
    const ctx = readStudioAgentContext(
      makeCore({
        getModule: () => null,
        getDiagnostics: () =>
          [
            { severity: "error" } as never,
            { severity: "error" } as never,
            { severity: "warning" } as never,
          ],
      }),
      "state { bad }",
    );

    expect(ctx.hasModule).toBe(false);
    expect(ctx.diagnostics).toEqual({ errors: 2, warnings: 1 });
    expect(ctx.domainSummary.source).toMatchObject({
      present: true,
      lineCount: 1,
      charCount: "state { bad }".length,
    });
  });
});

describe("buildAgentSystemPrompt", () => {
  it("contains the live tool contract and grounding rules", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}");
    const prompt = buildAgentSystemPrompt(ctx);

    expect(prompt).toContain("compact schema summary plus live tools");
    expect(prompt).toContain("inspectToolAffordances");
    expect(prompt).toContain("inspectFocus()");
    expect(prompt).toContain("inspectSnapshot()");
    expect(prompt).toContain("inspectAvailability()");
    expect(prompt).toContain("inspectNeighbors");
    expect(prompt).toContain("explainLegality");
    expect(prompt).toContain("simulateIntent");
    expect(prompt).toContain("dispatch({action, args})");
    expect(prompt).toContain("studioDispatch({action, args})");
    expect(prompt).toContain("endTurn({summary?})");
    expect(prompt).toContain("'이거'");
  });

  it("emits a compact domain summary without full MEL source", () => {
    const source = "domain Todo { state { count: number = 0 } }";
    const ctx = readStudioAgentContext(makeCore(), source);
    const prompt = buildAgentSystemPrompt(ctx);

    expect(prompt).toContain("# Domain Summary");
    expect(prompt).toContain("compiled: true");
    expect(prompt).toContain("schema: Todo @ schema-hash");
    expect(prompt).toContain("state: filter, todos");
    expect(prompt).toContain("computed: openCount");
    expect(prompt).toContain('addTodo(title: string, priority: "low" | "med" | "high")');
    expect(prompt).toContain("clearDone [guarded]");
    expect(prompt).not.toContain("```mel");
    expect(prompt).not.toContain(source);
  });

  it("does not advertise source-authoring or removed mock tools", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext(makeCore(), "state {}"),
    );

    expect(prompt).toContain("You do not have source-authoring tools");
    expect(prompt).not.toContain("createProposal");
    expect(prompt).not.toContain("inspectSourceOutline");
    expect(prompt).not.toContain("readDeclaration");
    expect(prompt).not.toContain("findInSource");
    expect(prompt).not.toContain("seedMock");
    expect(prompt).not.toContain("generateMock");
    expect(prompt).not.toContain("inspectConversation");
  });

  it("falls back to diagnostics without embedding invalid source", () => {
    const ctx = readStudioAgentContext(
      makeCore({
        getModule: () => null,
        getDiagnostics: () =>
          [
            { severity: "error" } as never,
            { severity: "warning" } as never,
            { severity: "error" } as never,
          ],
      }),
      "state { bad }",
    );
    const prompt = buildAgentSystemPrompt(ctx);

    expect(prompt).toContain("compiled: false");
    expect(prompt).toContain("diagnostics: 2 errors, 1 warnings");
    expect(prompt).not.toContain("state { bad }");
  });

  it("emits the recent turns newest-first", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}", [
      {
        turnId: "t3",
        userPrompt: "why is this blocked?",
        assistantExcerpt: "clearDone is guarded.",
        toolCount: 2,
      },
      {
        turnId: "t2",
        userPrompt: "what's focused?",
        assistantExcerpt: "",
        toolCount: 1,
      },
    ]);
    const prompt = buildAgentSystemPrompt(ctx);

    expect(prompt).toContain("# Recent Conversation");
    const idxTurn2 = prompt.indexOf("turn 2");
    const idxTurn1 = prompt.indexOf("turn 1");
    expect(idxTurn2).toBeGreaterThan(-1);
    expect(idxTurn1).toBeGreaterThan(idxTurn2);
    expect(prompt).toContain("user: why is this blocked?");
    expect(prompt).toContain("you: clearDone is guarded.");
    expect(prompt).toContain("you: (tool-only turn)");
  });

  it("does not embed dynamic runtime state", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext(makeCore(), "state {}"),
    );

    expect(prompt).not.toMatch(/^focus = /m);
    expect(prompt).not.toMatch(/^ui = /m);
    expect(prompt).not.toMatch(/^- [✓✗] \w+/m);
    expect(prompt).not.toContain("```json");
    expect(prompt).not.toContain("Your current state (snapshot)");
  });
});
