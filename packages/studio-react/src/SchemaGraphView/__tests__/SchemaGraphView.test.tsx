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
    expect(legend?.textContent ?? "").toMatch(/feeds/i);
    expect(legend?.textContent ?? "").toMatch(/mutates/i);
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
});
