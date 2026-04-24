import { describe, expect, it } from "vitest";
import {
  createMelAuthorTools,
  createMelAuthorWorkspace,
  MEL_AUTHOR_AGENT_MEL,
} from "../index.js";

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

describe("MEL Author Agent package", () => {
  it("ships an author lifecycle MEL that builds", async () => {
    const workspace = createMelAuthorWorkspace({
      source: MEL_AUTHOR_AGENT_MEL,
    });

    const result = await workspace.build();

    expect(result.status).toBe("ok");
    expect(result.actionNames).toContain("finalize");
  });

  it("builds an ephemeral workspace and exposes compact structure", async () => {
    const workspace = createMelAuthorWorkspace({ source: TASKFLOW_SOURCE });

    const build = await workspace.build();
    const graph = workspace.inspectGraph();
    const located = workspace.locateDeclaration("action:addTask");

    expect(build.status).toBe("ok");
    expect(build.actionNames).toEqual(["addTask"]);
    expect(build.stateFieldNames).toContain("tasks");
    expect(build.computedNames).toContain("doneCount");
    expect(graph.ok).toBe(true);
    if (graph.ok) expect(graph.output.nodeCount).toBeGreaterThan(0);
    expect(located.ok).toBe(true);
    if (located.ok) expect(located.output.preview).toContain("action addTask");
  });

  it("prevents runtime inspection after a source mutation until rebuild", async () => {
    const workspace = createMelAuthorWorkspace({ source: TASKFLOW_SOURCE });
    await workspace.build();

    const mutation = workspace.replaceSource(
      TASKFLOW_SOURCE.replace("doneCount", "completedCount"),
    );
    const graph = workspace.inspectGraph();

    expect(mutation.ok).toBe(true);
    expect(graph.ok).toBe(false);
    if (!graph.ok) expect(graph.message).toContain("successful build");
  });

  it("finalizes with diagnostics instead of throwing on invalid MEL", async () => {
    const workspace = createMelAuthorWorkspace({ source: "domain Bad {" });

    const final = await workspace.finalize({ title: "Broken draft" });

    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(final.output.status).toBe("invalid");
    expect(final.output.diagnostics.length).toBeGreaterThan(0);
    expect(final.output.title).toBe("Broken draft");
  });

  it("exposes author tools as JSON-schema-backed tool definitions", async () => {
    const workspace = createMelAuthorWorkspace({ source: TASKFLOW_SOURCE });
    const tools = createMelAuthorTools(workspace);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.has("readSource")).toBe(true);
    expect(byName.has("replaceSource")).toBe(true);
    expect(byName.has("build")).toBe(true);
    expect(byName.has("finalize")).toBe(true);

    const source = await byName.get("readSource")?.run({});
    expect(source?.ok).toBe(true);
    if (source?.ok) {
      expect(source.output).toMatchObject({ source: TASKFLOW_SOURCE });
    }
  });
});
