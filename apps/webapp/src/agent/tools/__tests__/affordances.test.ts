import { describe, expect, it } from "vitest";
import {
  admitToolCall,
  buildToolAffordanceReport,
  createAdmittedToolRegistry,
  createInspectToolAffordancesTool,
  explainAdmissionAvailability,
  rejectUnavailableTool,
  type DispatchResultLike,
  type ToolAdmissionRuntime,
  type ToolImplementation,
} from "../affordances.js";
import { bindTool, type BoundAgentTool } from "../types.js";

const ALL_TOOLS: readonly ToolImplementation[] = [
  toolImplementation("inspectToolAffordances"),
  toolImplementation("inspectFocus"),
  toolImplementation("inspectSnapshot"),
  toolImplementation("inspectAvailability"),
  toolImplementation("studioDispatch"),
  toolImplementation("dispatch"),
  toolImplementation("simulateIntent"),
  toolImplementation("endTurn"),
];

describe("Manifesto tool admission", () => {
  it("builds the exposed registry from studio.mel admission actions", () => {
    const runtime = fakeRuntime(["requestTool"], {
      admittedTools: [
        "inspectToolAffordances",
        "inspectFocus",
        "studioDispatch",
        "endTurn",
      ],
    });

    const registry = createAdmittedToolRegistry(ALL_TOOLS, runtime);

    expect(registry.list().map((entry) => entry.name)).toEqual([
      "inspectToolAffordances",
      "inspectFocus",
      "studioDispatch",
      "endTurn",
    ]);
  });

  it("dispatches the MEL admission action before running a tool", async () => {
    const calls: Array<{ readonly action: string; readonly args: unknown[] }> =
      [];
    const runtime = fakeRuntime(["requestTool"], {
      dispatch: (action, args) => {
        calls.push({ action, args: [...args] });
        return { kind: "completed" };
      },
    });
    const dispatchEntry = ALL_TOOLS.find(
      (entry) => entry.tool.name === "dispatch",
    );
    expect(dispatchEntry).toBeDefined();
    if (dispatchEntry === undefined) return;

    const result = await admitToolCall(dispatchEntry, runtime, {
      action: "submit",
    });

    expect(result).toEqual({ ok: true, output: { admitted: true } });
    expect(calls).toEqual([{ action: "requestTool", args: ["dispatch"] }]);
  });

  it("returns the runtime rejection when admission fails", async () => {
    const runtime = fakeRuntime(["requestTool"], {
      admittedTools: [],
      dispatch: () => ({
        kind: "rejected",
        rejection: { reason: 'focused action "submit" is not available' },
      }),
    });
    const dispatchEntry = ALL_TOOLS.find(
      (entry) => entry.tool.name === "dispatch",
    );
    expect(dispatchEntry).toBeDefined();
    if (dispatchEntry === undefined) return;

    const result = await admitToolCall(dispatchEntry, runtime, {
      action: "submit",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(
      'focused action "submit" is not available',
    );
  });

  it("explains blocked tools from Manifesto legality diagnostics", () => {
    const runtime = fakeRuntime(["requestTool"], {
      admittedTools: ["inspectFocus"],
      reasons: {
        "requestTool:dispatch": 'focused action "submit" is not available',
      },
    });

    const report = buildToolAffordanceReport(ALL_TOOLS, runtime, {
      toolName: "dispatch",
      includeUnavailable: true,
    });

    expect(report.availableTools).toEqual(["inspectFocus"]);
    expect(report.requestedToolAvailable).toBe(false);
    expect(report.requestedToolReason).toContain(
      'focused action "submit" is not available',
    );
    expect(report.recoveryTools).toEqual(["inspectFocus"]);
  });

  it("explains unknown or removed tools with recovery tools", () => {
    const result = rejectUnavailableTool(
      ALL_TOOLS,
      "seedMock",
      fakeRuntime(["requestTool"], {
        admittedTools: ["inspectToolAffordances", "endTurn"],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('"seedMock" is unavailable');
    expect(result.message).toContain("mock-data generation was removed");
    expect(result.detail).toMatchObject({
      requestedTool: "seedMock",
      requestedToolAvailable: false,
      requestedToolReason:
        "mock-data generation was removed from the current AgentLens runtime; inspect available domain actions and use dispatch with explicit action arguments instead",
    });
  });

  it("points domain action tool mistakes to dispatch", () => {
    const result = rejectUnavailableTool(
      ALL_TOOLS,
      "addTodo",
      fakeRuntime(["requestTool"], {
        admittedTools: [
          "inspectToolAffordances",
          "dispatch",
          "simulateIntent",
        ],
      }),
      { domainActionNames: ["addTodo", "removeTodo"] },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('"addTodo" is a domain action');
    expect(result.message).toContain(
      'dispatch({ action: "addTodo", args: [...] })',
    );
    expect(result.detail).toMatchObject({
      requestedTool: "addTodo",
      requestedToolAvailable: false,
      domainActionHint: {
        action: "addTodo",
        dispatchToolAvailable: true,
        recommendedToolCall: {
          tool: "dispatch",
          input: { action: "addTodo", args: [] },
        },
      },
      recoveryTools: ["dispatch", "simulateIntent"],
    });
  });

  it("reports the live tool catalog through the inspect tool", async () => {
    const runtime = fakeRuntime(["requestTool"], {
      admittedTools: ["inspectToolAffordances"],
      reasons: {
        "requestTool:dispatch": "no focused domain action",
      },
    });
    const tool = bindTool(createInspectToolAffordancesTool(), {
      getTools: () => ALL_TOOLS,
      getRuntime: () => runtime,
    });

    const result = await tool.run({
      toolName: "dispatch",
      includeUnavailable: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.output as {
      readonly availableTools: readonly string[];
      readonly requestedTool: string | null;
      readonly requestedToolAvailable: boolean | null;
      readonly requestedToolReason: string | null;
    };
    expect(output.availableTools).toEqual(["inspectToolAffordances"]);
    expect(output.requestedTool).toBe("dispatch");
    expect(output.requestedToolAvailable).toBe(false);
    expect(output.requestedToolReason).toContain("no focused domain action");
  });

  it("reports domain action hints through the inspect tool", async () => {
    const runtime = fakeRuntime(["requestTool"], {
      admittedTools: [
        "inspectToolAffordances",
        "dispatch",
        "inspectAvailability",
      ],
    });
    const tool = bindTool(createInspectToolAffordancesTool(), {
      getTools: () => ALL_TOOLS,
      getRuntime: () => runtime,
      getDomainActionNames: () => ["addTodo"],
    });

    const result = await tool.run({ toolName: "addTodo" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.output as {
      readonly requestedToolReason: string | null;
      readonly domainActionHint: unknown;
      readonly recoveryTools: readonly string[];
    };
    expect(output.requestedToolReason).toContain(
      'dispatch({ action: "addTodo", args: [...] })',
    );
    expect(output.domainActionHint).toMatchObject({
      action: "addTodo",
      dispatchToolAvailable: true,
    });
    expect(output.recoveryTools).toEqual(["dispatch", "inspectAvailability"]);
  });

  it("explains the end-turn gate directly", () => {
    const endTurnEntry = ALL_TOOLS.find(
      (entry) => entry.tool.name === "endTurn",
    );
    expect(endTurnEntry).toBeDefined();
    if (endTurnEntry === undefined) return;

    const decision = explainAdmissionAvailability(
      endTurnEntry,
      fakeRuntime([], {
        reasons: {
          requestTool: "agent turn is not running",
        },
      }),
    );

    expect(decision).toEqual({
      available: false,
      reason: "available when guard blocked: agent turn is not running",
    });
  });
});

function toolImplementation(
  name: string,
  admissionAction = "requestTool",
  buildAdmissionArgs?: (input: unknown) => readonly unknown[],
): ToolImplementation {
  const tool: BoundAgentTool = {
    name,
    description: `${name} test tool`,
    jsonSchema: { type: "object" },
    run: async () => ({ ok: true, output: { name } }),
  };
  return {
    tool,
    admissionAction,
    admissionArgs: admissionAction === "requestTool" ? [name] : [],
    buildAdmissionArgs,
  };
}

function fakeRuntime(
  availableActions: readonly string[],
  options: {
    readonly dispatch?: (
      action: string,
      args: readonly unknown[],
    ) => DispatchResultLike;
    readonly reasons?: Record<string, string>;
    readonly admittedTools?: readonly string[];
  } = {},
): ToolAdmissionRuntime {
  return {
    isActionAvailable: (actionName) => availableActions.includes(actionName),
    createIntent: (actionName, ...args) => ({ actionName, args }),
    dispatchAsync: async (intent) => {
      const action = readIntentAction(intent);
      const args = readIntentArgs(intent);
      if (options.dispatch !== undefined) return options.dispatch(action, args);
      return isIntentAllowed(action, args, availableActions, options)
        ? { kind: "completed" }
        : {
            kind: "rejected",
            rejection: {
              reason: readIntentReason(action, args, options),
            },
          };
    },
    whyNot: (intent) => {
      const action = readIntentAction(intent);
      const args = readIntentArgs(intent);
      if (isIntentAllowed(action, args, availableActions, options)) return [];
      return [
        {
          layer: "available when",
          description: readIntentReason(action, args, options),
        },
      ];
    },
  };
}

function isIntentAllowed(
  action: string,
  args: readonly unknown[],
  availableActions: readonly string[],
  options: { readonly admittedTools?: readonly string[] },
): boolean {
  if (!availableActions.includes(action)) return false;
  if (action !== "requestTool" || options.admittedTools === undefined) {
    return true;
  }
  const tool = args[0];
  return typeof tool === "string" && options.admittedTools.includes(tool);
}

function readIntentReason(
  action: string,
  args: readonly unknown[],
  options: { readonly reasons?: Record<string, string> },
): string {
  const tool =
    action === "requestTool" && typeof args[0] === "string" ? args[0] : null;
  const key = tool === null ? action : `${action}:${tool}`;
  return (
    options.reasons?.[key] ??
    options.reasons?.[action] ??
    `admission action "${key}" is not available`
  );
}

function readIntentAction(intent: unknown): string {
  const action = (intent as { readonly actionName?: unknown }).actionName;
  return typeof action === "string" ? action : "";
}

function readIntentArgs(intent: unknown): readonly unknown[] {
  const args = (intent as { readonly args?: unknown }).args;
  return Array.isArray(args) ? args : [];
}
