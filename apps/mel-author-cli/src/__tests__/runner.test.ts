import { describe, expect, it } from "vitest";
import { runMelAuthorAgent, type GenerateAuthorText } from "../runner.js";

const TASKFLOW_SOURCE = `domain TaskFlow {
  type TaskStatus = "todo" | "done"
  type ClockStamp = {
    now: string
  }
  type Task = {
    id: string,
    title: string,
    status: TaskStatus
  }

  state {
    tasks: Array<Task> = []
    clock: ClockStamp | null = null
  }

  computed doneTasks = filter(tasks, eq($item.status, "done"))
  computed doneCount = len(doneTasks)

  action addTask(task: Task, stamp: ClockStamp) {
    onceIntent {
      patch tasks = append(tasks, task)
      patch clock = stamp
    }
  }
}`;

describe("MEL Author CLI runner", () => {
  it("runs a scripted headless author flow without a network model", async () => {
    const report = await runMelAuthorAgent({
      source: TASKFLOW_SOURCE,
      request: "Rename doneCount to completedCount",
      strategy: "lens",
      generate: scriptedLensGenerate,
      env: {
        AGENT_MODEL_PROVIDER: "ollama",
        OLLAMA_MODEL: "gemma4:e4b",
      },
    });

    expect(report.ok).toBe(true);
    expect(report.strategy).toBe("lens");
    expect(report.model.label).toBe("ollama/gemma4:e4b");
    expect(report.toolTrace.map((entry) => entry.toolName)).toEqual([
      "build",
      "inspectSourceOutline",
      "patchDeclaration",
      "build",
      "finalize",
    ]);
    expect(report.output?.proposedSource).toContain("completedCount");
    expect(JSON.stringify(report.authorLineage?.snapshot)).toContain(
      "finalized",
    );
  });

  it("classifies readSource-only stops as stalled", async () => {
    const report = await runMelAuthorAgent({
      source: TASKFLOW_SOURCE,
      request: "Add clearDoneTasks",
      strategy: "full-source",
      generate: scriptedReadSourceOnlyStop,
      env: {
        AGENT_MODEL_PROVIDER: "ollama",
        OLLAMA_MODEL: "gemma4:e4b",
      },
    });

    expect(report.ok).toBe(false);
    expect(report.failureReport?.failureKind).toBe("stalled");
    expect(JSON.stringify(report.authorLineage?.snapshot)).toContain(
      "read_source_only_stop",
    );
  });
});

const scriptedLensGenerate: GenerateAuthorText = async (options) => {
  const toolResults: unknown[] = [];
  const call = async (toolName: string, input: unknown) => {
    const toolOutput = await callTool(options.tools, toolName, input);
    toolResults.push({ toolName, input, output: toolOutput });
    return toolOutput;
  };

  await call("build", {});
  await call("inspectSourceOutline", {});
  await call("patchDeclaration", {
    target: "computed:doneCount",
    replacement: "  computed completedCount = len(doneTasks)",
  });
  await call("build", {});
  await call("finalize", {
    title: "Rename done count",
    rationale: "Renames the computed declaration requested by the test.",
  });

  return scriptedResult(toolResults);
};

const scriptedReadSourceOnlyStop: GenerateAuthorText = async (options) => {
  const output = await callTool(options.tools, "readSource", {});
  return scriptedResult([{ toolName: "readSource", input: {}, output }]);
};

async function callTool(
  tools: unknown,
  toolName: string,
  input: unknown,
): Promise<unknown> {
  const toolSet = tools as Record<
    string,
    { readonly execute?: (input: unknown) => Promise<unknown> }
  >;
  const execute = toolSet[toolName]?.execute;
  if (execute === undefined) throw new Error(`missing tool ${toolName}`);
  return execute(input);
}

function scriptedResult(toolResults: readonly unknown[]): unknown {
  return {
    text: "",
    finishReason: "stop",
    steps: [
      {
        toolCalls: toolResults.map((toolResult) => ({
          toolName: (toolResult as { readonly toolName: string }).toolName,
        })),
        toolResults,
      },
    ],
  };
}
