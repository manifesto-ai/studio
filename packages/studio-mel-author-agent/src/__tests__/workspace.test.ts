import { describe, expect, it } from "vitest";
import {
  classifyMelAuthorDraftFailure,
  buildMelAuthorSystemPrompt,
  createMelAuthorFailureReport,
  createMelAuthorLifecycle,
  createMelAuthorTools,
  createMelAuthorWorkspace,
  MEL_AUTHOR_AGENT_MEL,
} from "../index.js";
import {
  createMelAuthorGuideIndex,
  searchMelAuthorGuide,
} from "../guide.js";

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
    expect(byName.has("inspectSourceOutline")).toBe(true);
    expect(byName.has("readDeclaration")).toBe(true);
    expect(byName.has("patchDeclaration")).toBe(true);
    expect(byName.has("finalize")).toBe(true);

    const source = await byName.get("readSource")?.run({});
    expect(source?.ok).toBe(true);
    if (source?.ok) {
      expect(source.output).toMatchObject({ source: TASKFLOW_SOURCE });
    }
  });

  it("exposes source lens outline, scoped reads, search, and declaration patching", async () => {
    const workspace = createMelAuthorWorkspace({ source: TASKFLOW_SOURCE });
    await workspace.build();

    const outline = workspace.inspectSourceOutline();
    const declaration = workspace.readDeclaration({
      target: "action:addTask",
    });
    const found = workspace.findSource({
      query: "done tasks",
      kind: "computed",
    });
    const patched = workspace.patchDeclaration({
      target: "computed:doneCount",
      replacement: "  computed completedCount = len(doneTasks)",
    });
    const rebuilt = await workspace.build();

    expect(outline.ok).toBe(true);
    if (outline.ok) {
      expect(outline.output.actions.map((entry) => entry.target)).toContain(
        "action:addTask",
      );
      expect(outline.output.stateFields.map((entry) => entry.target)).toContain(
        "state:tasks",
      );
      expect(outline.output.types.map((entry) => entry.target)).toContain(
        "type:Task",
      );
    }
    expect(declaration.ok).toBe(true);
    if (declaration.ok) {
      expect(declaration.output.source).toContain("action addTask");
      expect(declaration.output.lineCount).toBeLessThan(
        TASKFLOW_SOURCE.split(/\r?\n/).length,
      );
    }
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.output.hits[0]?.target).toBe("computed:doneTasks");
    }
    expect(patched.ok).toBe(true);
    expect(rebuilt.status).toBe("ok");
    expect(rebuilt.computedNames).toContain("completedCount");
  });

  it("caps source range reads and rejects out-of-range source reads", () => {
    const source = Array.from(
      { length: 120 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const workspace = createMelAuthorWorkspace({ source });

    const capped = workspace.readSourceRange({ startLine: 1, endLine: 120 });
    const invalid = workspace.readSourceRange({ startLine: 999, endLine: 1000 });

    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect(capped.output.lineCount).toBe(80);
      expect(capped.output.truncated).toBe(true);
    }
    expect(invalid.ok).toBe(false);
  });

  it("searches bundled guide chunks by error code and source", () => {
    const index = createMelAuthorGuideIndex();
    const result = searchMelAuthorGuide(index, {
      query: "E053",
      source: "error",
    });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.source).toBe("error");
    expect(result.hits[0]?.headingPath.join(" ")).toContain("E053");
    expect(result.hits[0]?.excerpt).toContain("@meta");
  });

  it("searches bundled guide chunks for MEL constructs", () => {
    const index = createMelAuthorGuideIndex();
    const itemResult = searchMelAuthorGuide(index, {
      query: "$item outside collection",
    });
    const onceIntentResult = searchMelAuthorGuide(index, {
      query: "onceIntent",
      limit: 2,
    });

    expect(itemResult.hits[0]?.excerpt).toContain("$item");
    expect(onceIntentResult.hits).toHaveLength(2);
    expect(
      onceIntentResult.hits.some((hit) =>
        hit.headingPath.join(" ").includes("onceIntent"),
      ),
    ).toBe(true);
    expect(onceIntentResult.hits[0]?.excerpt.length).toBeLessThanOrEqual(1_006);
  });

  it("exposes searchAuthorGuide when a guide index is provided", async () => {
    const workspace = createMelAuthorWorkspace({ source: TASKFLOW_SOURCE });
    const tools = createMelAuthorTools(workspace, {
      guideIndex: createMelAuthorGuideIndex(),
    });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.has("searchAuthorGuide")).toBe(true);
    const result = await byName.get("searchAuthorGuide")?.run({
      query: "patch operations",
      source: "reference",
      limit: 1,
    });

    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const output = result.output as {
        readonly hits: readonly { readonly source: string }[];
      };
      expect(output.hits).toHaveLength(1);
      expect(output.hits[0]?.source).toBe("reference");
    }
  });

  it("records Author tool lifecycle into lineage", async () => {
    const lifecycle = await createMelAuthorLifecycle({
      request: "Rename the done count computed field",
    });
    const workspace = createMelAuthorWorkspace({ source: TASKFLOW_SOURCE });
    const tools = createMelAuthorTools(workspace, { lifecycle });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    await byName.get("readSource")?.run({});
    await byName.get("replaceSource")?.run({
      source: TASKFLOW_SOURCE.replace("doneCount", "completedCount"),
    });
    await byName.get("build")?.run({});
    const final = await byName.get("finalize")?.run({
      title: "Rename done count",
    });

    expect(final?.ok).toBe(true);
    const lineage = lifecycle.getLineage();
    const intentTypes = lineage.lineage.worlds
      .map((world) => world.origin.intentType)
      .filter(Boolean);
    expect(intentTypes).toEqual(
      expect.arrayContaining([
        "start",
        "recordReadSource",
        "recordMutationAttempt",
        "recordBuild",
        "finalize",
      ]),
    );
    expect(JSON.stringify(lineage.snapshot)).toContain("finalized");
  });

  it("rejects lifecycle finalize when no source mutation occurred", async () => {
    const lifecycle = await createMelAuthorLifecycle({
      request: "Return the same source",
    });
    const workspace = createMelAuthorWorkspace({ source: TASKFLOW_SOURCE });
    const tools = createMelAuthorTools(workspace, { lifecycle });
    const final = await new Map(tools.map((tool) => [tool.name, tool]))
      .get("finalize")
      ?.run({ title: "No-op" });

    expect(final?.ok).toBe(false);
    if (final?.ok === false) {
      expect(final.message).toContain("at least one source mutation");
    }
    const lineage = lifecycle.getLineage();
    const intentTypes = lineage.lineage.worlds
      .map((world) => world.origin.intentType)
      .filter(Boolean);
    expect(intentTypes).toContain("recordBuild");
    expect(intentTypes).not.toContain("finalize");
  });

  it("records stalled, retry, and giveUp lifecycle states", async () => {
    const lifecycle = await createMelAuthorLifecycle({
      request: "Stalled author test",
    });

    const stalled = await lifecycle.markStalled("read_source_only_stop");
    const retry1 = await lifecycle.retry();
    const retry2 = await lifecycle.retry();
    const retry3 = await lifecycle.retry();
    const retry4 = await lifecycle.retry();
    const gaveUp = await lifecycle.giveUp("max_retries");

    expect(stalled.ok).toBe(true);
    expect(retry1.ok).toBe(true);
    expect(retry2.ok).toBe(true);
    expect(retry3.ok).toBe(true);
    expect(retry4.ok).toBe(false);
    expect(gaveUp.ok).toBe(true);
    expect(JSON.stringify(lifecycle.getLineage().snapshot)).toContain(
      "max_retries",
    );
  });

  it("instructs the author to use guide search for uncertainty and diagnostics", () => {
    const prompt = buildMelAuthorSystemPrompt({ request: "Add a task action" });

    expect(prompt).toContain("searchAuthorGuide");
    expect(prompt).toContain("source:\"error\"");
  });

  it("classifies invalid drafts as compile_error failure reports", () => {
    const report = classifyMelAuthorDraftFailure({
      originalSource: TASKFLOW_SOURCE,
      draft: {
        title: "Broken",
        rationale: "",
        proposedSource: "domain Bad {",
        status: "invalid",
        diagnostics: [
          {
            severity: "error",
            message: "Expected closing brace",
            line: 1,
            column: 12,
          },
        ],
        schemaHash: null,
        summary: "workspace source failed to build with 1 error",
      },
      toolTrace: [
        {
          toolName: "build",
          ok: false,
          summary: "workspace source failed to build with 1 error",
        },
      ],
    });

    expect(report?.failureKind).toBe("compile_error");
    expect(report?.diagnostics).toHaveLength(1);
    expect(report?.toolTrace[0]?.toolName).toBe("build");
    expect(report?.lastSourceExcerpt).toContain("domain Bad");
  });

  it("classifies unchanged drafts and caps tool traces", () => {
    const report = createMelAuthorFailureReport({
      failureKind: "unchanged_source",
      summary: "MEL Author Agent returned unchanged source.",
      source: TASKFLOW_SOURCE,
      toolTrace: Array.from({ length: 20 }, (_, index) => ({
        toolName: `tool${index}`,
        ok: true,
        summary: "ok",
      })),
    });

    expect(report.failureKind).toBe("unchanged_source");
    expect(report.toolTrace).toHaveLength(16);
    expect(report.toolTrace[0]?.toolName).toBe("tool4");
  });
});
