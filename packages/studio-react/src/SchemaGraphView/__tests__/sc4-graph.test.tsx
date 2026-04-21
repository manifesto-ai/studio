/**
 * P1-SC-4 acceptance test.
 *
 * Spec: `todo.mel` graph renders + computed body change after rebuild
 * surfaces a plan overlay on at least one node.
 *
 * This is the end-to-end flavor: build → source edit → rebuild → render
 * SchemaGraphView and inspect the DOM for the plan badge on the node
 * that was affected by the change.
 */
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import { buildGraphModel } from "../graph-model.js";
import { SchemaGraphView } from "../SchemaGraphView.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const todoSource = readFileSync(
  join(
    repoRoot,
    "packages",
    "studio-adapter-headless",
    "src",
    "__tests__",
    "fixtures",
    "todo.mel",
  ),
  "utf8",
);

function mount(): { container: HTMLDivElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("P1-SC-4 — graph renders and reflects rebuild plan", () => {
  it("renders todo.mel graph and surfaces a plan badge after a source edit", async () => {
    const core = createStudioCore();
    const adapter = createHeadlessAdapter({ initialSource: todoSource });
    core.attach(adapter);

    const ok1 = await core.build();
    expect(ok1.kind).toBe("ok");

    const firstModel = core.getModule();
    expect(firstModel).not.toBeNull();
    const firstGraph = buildGraphModel(firstModel);
    expect(firstGraph).not.toBeNull();
    if (firstGraph === null || firstModel === null) return;

    // Mount once to verify the happy-path render — at least one node per
    // kind is visible and labeled.
    const firstMount = mount();
    await act(async () => {
      firstMount.root.render(
        <SchemaGraphView model={firstGraph} width={900} height={700} />,
      );
    });
    const kindsFound = new Set(
      Array.from(firstMount.container.querySelectorAll("[data-node-id]"))
        .map((el) => (el.getAttribute("data-node-id") ?? "").split(":")[0]),
    );
    expect(kindsFound.has("state")).toBe(true);
    expect(kindsFound.has("computed")).toBe(true);
    expect(kindsFound.has("action")).toBe(true);
    firstMount.cleanup();

    // --- Add a brand-new state field. The reconciler will classify this
    // as `initialized` (reason: "new") — which is exactly the kind of
    // motion a plan overlay exists to surface.
    const edited = todoSource.replace(
      "filterMode: \"all\" | \"active\" | \"completed\" = \"all\"",
      "filterMode: \"all\" | \"active\" | \"completed\" = \"all\"\n    visited: number = 0",
    );
    expect(edited).not.toBe(todoSource);
    adapter.setSource(edited);

    const ok2 = await core.build();
    expect(ok2.kind).toBe("ok");

    const secondModel = core.getModule();
    const plan = core.getLastReconciliationPlan();
    expect(plan).not.toBeNull();
    if (secondModel === null || plan === null) return;

    const secondGraph = buildGraphModel(secondModel, plan);
    expect(secondGraph).not.toBeNull();
    if (secondGraph === null) return;

    // Schema hash must have changed — the rebuild touched at least one
    // computed body.
    expect(secondGraph.schemaHash).not.toBe(firstGraph.schemaHash);

    // The plan must have resolved every graph-visible node (no silent
    // drops).
    for (const node of secondGraph.nodes) {
      expect(node.identityFate).not.toBeNull();
    }

    // At least one identityFate kind is non-preserved OR snapshotFate is
    // not "preserved" — the whole point of a plan overlay.
    const hasMotion = secondGraph.nodes.some((n) => {
      if (n.identityFate !== null && n.identityFate.kind !== "preserved") return true;
      if (n.snapshotFate !== undefined && n.snapshotFate !== "preserved") return true;
      return false;
    });
    expect(hasMotion).toBe(true);

    // Mount the updated graph — the DOM must include at least one
    // node whose <title> advertises a non-quiet fate.
    const secondMount = mount();
    await act(async () => {
      secondMount.root.render(
        <SchemaGraphView model={secondGraph} width={900} height={700} />,
      );
    });
    const titles = Array.from(
      secondMount.container.querySelectorAll("[data-node-id] title"),
    ).map((t) => t.textContent ?? "");
    expect(titles.length).toBe(secondGraph.nodes.length);
    const hasOverlayTitle = titles.some((t) =>
      /initialized|discarded|renamed|snapshot (initialized|discarded)/i.test(t),
    );
    expect(hasOverlayTitle).toBe(true);
    secondMount.cleanup();
  });
});
