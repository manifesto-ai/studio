import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import { buildGraphModel } from "../graph-model.js";
import { SchemaGraphView } from "../SchemaGraphView.js";
import { buildGraphFocusLens } from "../focus-lens.js";

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

async function buildTodoModel() {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: todoSource });
  core.attach(adapter);
  const res = await core.build();
  if (res.kind !== "ok") throw new Error("build failed");
  const model = buildGraphModel(core.getModule());
  if (model === null) throw new Error("model null");
  return model;
}

function mount(children: React.ReactNode): {
  container: HTMLDivElement;
  root: Root;
  cleanup: () => void;
} {
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

describe("SchemaGraphView", () => {
  it("renders an empty-state when model is null", async () => {
    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(<SchemaGraphView model={null} width={400} height={300} />);
    });
    expect(container.textContent).toMatch(/Build the module/i);
    cleanup();
  });

  it("renders one group per node with aria-label matching node name", async () => {
    const model = await buildTodoModel();
    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView model={model} width={800} height={600} />,
      );
    });
    const nodeGroups = container.querySelectorAll("[data-node-id]");
    expect(nodeGroups.length).toBe(model.nodes.length);
    for (const n of model.nodes) {
      const el = container.querySelector(`[data-node-id="${n.id}"]`);
      expect(el).not.toBeNull();
      expect(el?.getAttribute("aria-label")).toContain(n.name);
    }
    cleanup();
  });

  it("renders one path per edge", async () => {
    const model = await buildTodoModel();
    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView model={model} width={800} height={600} />,
      );
    });
    // Path count: grid dots are circles, edges are paths. So count paths.
    const paths = container.querySelectorAll("svg path");
    // Each edge is one path (arrow marker paths live inside <defs>, but
    // jsdom counts those too — account for the 3 marker shapes).
    expect(paths.length).toBeGreaterThanOrEqual(model.edges.length);
    cleanup();
  });

  it("fires onNodeClick with the clicked node", async () => {
    const model = await buildTodoModel();
    const onClick = vi.fn();
    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView
          model={model}
          width={800}
          height={600}
          onNodeClick={onClick}
        />,
      );
    });
    const first = model.nodes[0];
    const el = container.querySelector(`[data-node-id="${first.id}"]`);
    expect(el).not.toBeNull();
    await act(async () => {
      (el as SVGGElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].id).toBe(first.id);
    cleanup();
  });

  it("renders the legend and exposes node and edge sections when expanded", async () => {
    const model = await buildTodoModel();
    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView model={model} width={800} height={600} />,
      );
    });
    const legend = container.querySelector('[data-testid="graph-legend"]');
    expect(legend).not.toBeNull();
    // Collapsed by default — only the toggle button is rendered.
    const toggle = legend?.querySelector("button");
    expect(toggle).not.toBeNull();
    await act(async () => {
      (toggle as HTMLButtonElement).click();
    });
    expect(legend?.textContent ?? "").toMatch(/state/i);
    expect(legend?.textContent ?? "").toMatch(/computed/i);
    expect(legend?.textContent ?? "").toMatch(/action/i);
    expect(legend?.textContent ?? "").toMatch(/reads dependency/i);
    expect(legend?.textContent ?? "").toMatch(/patch write/i);
    expect(legend?.textContent ?? "").toMatch(/availability gate/i);
    expect(legend?.textContent ?? "").toMatch(/1-hop/i);
    expect(legend?.textContent ?? "").toMatch(/2-hop/i);
    expect(legend?.textContent ?? "").toMatch(/initialized/i);
    cleanup();
  });

  it("exposes tabIndex=0 on nodes for keyboard focus", async () => {
    const model = await buildTodoModel();
    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView model={model} width={800} height={600} />,
      );
    });
    const first = container.querySelector("[data-node-id]");
    expect(first?.getAttribute("tabindex")).toBe("0");
    cleanup();
  });

  it("renders identity-fate badges when a plan marks a node as initialized", async () => {
    // Simulate by mutating the model's first node to have identityFate.
    const model = await buildTodoModel();
    const first = model.nodes[0];
    const withFate = {
      ...model,
      nodes: [
        {
          ...first,
          identityFate: { kind: "initialized" as const, reason: "new" as const },
        },
        ...model.nodes.slice(1),
      ],
    };
    withFate.nodesById = new Map(withFate.nodes.map((n) => [n.id, n]));

    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView model={withFate} width={800} height={600} />,
      );
    });
    const node = container.querySelector(`[data-node-id="${first.id}"]`);
    expect(node).not.toBeNull();
    const title = node?.querySelector("title");
    expect(title?.textContent).toMatch(/initialized/);
    cleanup();
  });

  it("renders discarded and renamed fates distinctly", async () => {
    const model = await buildTodoModel();
    if (model.nodes.length < 2) throw new Error("need >=2 nodes");
    const [a, b] = model.nodes;
    const withFates = {
      ...model,
      nodes: [
        {
          ...a,
          identityFate: {
            kind: "discarded" as const,
            reason: "removed" as const,
          },
        },
        {
          ...b,
          identityFate: {
            kind: "renamed" as const,
            from: "state_field:oldName" as const,
          },
        },
        ...model.nodes.slice(2),
      ],
    };
    withFates.nodesById = new Map(withFates.nodes.map((n) => [n.id, n]));

    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView model={withFates} width={800} height={600} />,
      );
    });
    const titles = Array.from(container.querySelectorAll("title")).map(
      (t) => t.textContent ?? "",
    );
    expect(titles.some((t) => /discarded/.test(t))).toBe(true);
    expect(titles.some((t) => /renamed/.test(t))).toBe(true);
    cleanup();
  });

  it("dims unrelated nodes and renders a focus summary card", async () => {
    const model = await buildTodoModel();
    const lens = buildGraphFocusLens(model, ["action:addTodo"], "graph");
    if (lens === null) throw new Error("lens null");
    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView
          model={model}
          width={800}
          height={600}
          focusLens={lens}
        />,
      );
    });
    const summary = container.querySelector('[data-testid="focus-summary"]');
    expect(summary?.textContent ?? "").toMatch(/focus/i);
    expect(summary?.textContent ?? "").toMatch(/mutates/i);
    expect(summary?.textContent ?? "").toMatch(/todos/i);
    expect(summary?.textContent ?? "").toMatch(/1-hop/i);
    expect(summary?.textContent ?? "").toMatch(/2-hop/i);

    const focused = container.querySelector('[data-node-id="action:addTodo"]');
    const hop1 = container.querySelector('[data-node-id="state:todos"]');
    const hop2 = container.querySelector('[data-node-id="computed:todoCount"]');
    const dimmed = container.querySelector('[data-node-id="computed:activeCount"]');
    expect(focused?.getAttribute("data-focus-root")).toBe("true");
    expect(focused?.getAttribute("data-hop-depth")).toBe("0");
    expect(hop1?.getAttribute("data-hop-depth")).toBe("1");
    expect(hop1?.getAttribute("data-blast-depth")).toBe("1");
    expect(hop2?.getAttribute("data-hop-depth")).toBe("2");
    expect(hop2?.getAttribute("data-blast-depth")).toBe("2");
    expect(dimmed?.getAttribute("data-focus-dimmed")).toBe("true");
    expect(dimmed?.getAttribute("style")).toContain("opacity: 0.14");

    const hop1Edge = container.querySelector('[data-edge-id="action:addTodo->state:todos:mutates"]');
    const hop2Edge = container.querySelector('[data-edge-id="state:todos->computed:todoCount:feeds"]');
    const dimmedEdge = container.querySelector('[data-edge-id="computed:todoCount->computed:activeCount:feeds"]');
    expect(hop1Edge?.getAttribute("data-hop-depth")).toBe("1");
    expect(hop1Edge?.getAttribute("data-blast-depth")).toBe("1");
    expect(hop2Edge?.getAttribute("data-hop-depth")).toBe("2");
    expect(hop2Edge?.getAttribute("data-blast-depth")).toBe("2");
    expect(dimmedEdge?.getAttribute("data-focus-dimmed")).toBe("true");
    expect(dimmedEdge?.getAttribute("opacity")).toBe("0.12");
    cleanup();
  });

  it("uses smart focus to fit when needed and preserve 100% when already visible", async () => {
    const model = await buildTodoModel();
    const lens = buildGraphFocusLens(model, ["action:addTodo"], "graph");
    if (lens === null) throw new Error("lens null");
    const tightMount = mount(null);

    await act(async () => {
      tightMount.root.render(
        <SchemaGraphView
          model={model}
          width={260}
          height={180}
          focusLens={lens}
        />,
      );
    });
    const zoomAfterTight = Array.from(tightMount.container.querySelectorAll("button"))
      .map((button) => button.textContent ?? "")
      .find((text) => text.endsWith("%"));
    expect(zoomAfterTight).not.toBe("100%");
    tightMount.cleanup();

    const wideMount = mount(null);
    await act(async () => {
      wideMount.root.render(
        <SchemaGraphView
          model={model}
          width={1400}
          height={1000}
          focusLens={lens}
        />,
      );
    });
    const zoomAfterWide = Array.from(wideMount.container.querySelectorAll("button"))
      .map((button) => button.textContent ?? "")
      .find((text) => text.endsWith("%"));
    expect(zoomAfterWide).toBe("100%");
    wideMount.cleanup();
  });

  it("renders orthogonal edge paths instead of quadratic curves", async () => {
    const model = await buildTodoModel();
    const lens = buildGraphFocusLens(model, ["action:addTodo"], "graph");
    if (lens === null) throw new Error("lens null");
    const { container, root, cleanup } = mount(null);

    await act(async () => {
      root.render(
        <SchemaGraphView
          model={model}
          width={800}
          height={600}
          focusLens={lens}
        />,
      );
    });

    const path = container.querySelector('[data-edge-id="action:addTodo->state:todos:mutates"]');
    expect(path?.getAttribute("d")).toContain(" L ");
    expect(path?.getAttribute("d")).not.toContain("Q");
    cleanup();
  });

  it("calls onBackgroundClick when the empty canvas is clicked", async () => {
    const model = await buildTodoModel();
    const onBackgroundClick = vi.fn();
    const { container, root, cleanup } = mount(null);
    await act(async () => {
      root.render(
        <SchemaGraphView
          model={model}
          width={800}
          height={600}
          onBackgroundClick={onBackgroundClick}
        />,
      );
    });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const PointerEvt = window.PointerEvent ?? window.MouseEvent;
    await act(async () => {
      (svg as SVGSVGElement).dispatchEvent(
        new PointerEvt("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 40,
          clientY: 40,
        }),
      );
      (svg as SVGSVGElement).dispatchEvent(
        new PointerEvt("pointerup", {
          bubbles: true,
          button: 0,
          clientX: 40,
          clientY: 40,
        }),
      );
    });
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
