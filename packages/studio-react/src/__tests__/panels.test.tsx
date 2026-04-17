import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import { StudioProvider } from "../StudioProvider.js";
import { SourceEditor } from "../SourceEditor.js";
import { DiagnosticsPanel } from "../DiagnosticsPanel.js";
import { PlanPanel } from "../PlanPanel.js";
import { SnapshotTree } from "../SnapshotTree.js";
import { HistoryTimeline } from "../HistoryTimeline.js";
import { StudioHotkeys } from "../StudioHotkeys.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
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

async function mountWithCore(
  children: React.ReactNode,
  opts?: { build?: boolean; dispatchAddTodo?: string },
): Promise<{ container: HTMLDivElement; root: Root; cleanup: () => void }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const adapter = createHeadlessAdapter({ initialSource: todoSource });
  const core = createStudioCore();

  if (opts?.build === true) {
    core.attach(adapter);
    await core.build();
    if (opts.dispatchAddTodo !== undefined) {
      await core.dispatchAsync(
        core.createIntent("addTodo", { title: opts.dispatchAddTodo }),
      );
    }
    // detach so StudioProvider can re-attach
    // HeadlessAdapter doesn't expose explicit detach from our side, but
    // the provider mounts a detach via the returned closure — since core
    // tracks a single attached adapter, re-attaching would throw.
    // Workaround: use a fresh core + adapter for each render and do the
    // pre-build through that same pair.
  }

  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
        {children}
      </StudioProvider>,
    );
  });
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("studio-react panels — jsdom smoke", () => {
  it("SourceEditor renders header, accepts children, and shows 0/0 on fresh build", async () => {
    const { container, cleanup } = await mountWithCore(
      <SourceEditor filename="todo.mel">
        <div data-testid="editor-host" />
      </SourceEditor>,
    );
    expect(container.textContent).toContain("todo.mel");
    expect(container.querySelector("[data-testid=editor-host]")).not.toBeNull();
    expect(container.textContent).toContain("0 errors");
    cleanup();
  });

  it("DiagnosticsPanel shows the empty-state string before any build", async () => {
    const { container, cleanup } = await mountWithCore(<DiagnosticsPanel />);
    expect(container.textContent).toMatch(/No diagnostics/);
    cleanup();
  });

  it("PlanPanel shows empty state until a build populates a plan", async () => {
    const { container, cleanup } = await mountWithCore(<PlanPanel />);
    expect(container.textContent).toMatch(/No plan yet/);
    cleanup();
  });

  it("SnapshotTree shows empty state before build", async () => {
    const { container, cleanup } = await mountWithCore(<SnapshotTree />);
    expect(container.textContent).toMatch(/No snapshot yet/);
    cleanup();
  });

  it("HistoryTimeline shows empty state before build", async () => {
    const { container, cleanup } = await mountWithCore(<HistoryTimeline />);
    expect(container.textContent).toMatch(/No edit history/);
    cleanup();
  });

  it("Panels reflect live module / snapshot / plan / history after a build + dispatch", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const adapter = createHeadlessAdapter({ initialSource: todoSource });
    const core = createStudioCore();

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
          <PlanPanel />
          <SnapshotTree />
          <HistoryTimeline />
          <DiagnosticsPanel />
        </StudioProvider>,
      );
    });

    // Kick build + dispatch via adapter / core directly (provider re-renders
    // via onBuildRequest chain or history poll; here we force by calling
    // requestBuild through the adapter pathway).
    await act(async () => {
      adapter.requestBuild();
      // microtask yield for async build
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      const intent = core.createIntent("addTodo", { title: "from-test" });
      await core.dispatchAsync(intent);
    });
    // Nudge re-render via a follow-up build (same source) to bump version.
    await act(async () => {
      adapter.requestBuild();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain("preserved");
    expect(container.textContent).toContain("todos");
    expect(container.textContent).toContain("from-test");
    expect(container.textContent).toMatch(/envelope/);

    act(() => root.unmount());
    container.remove();
  });

  it("StudioHotkeys fires requestBuild on Ctrl-S", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const adapter = createHeadlessAdapter({ initialSource: todoSource });
    const core = createStudioCore();
    const spy = vi.fn();
    adapter.onBuildRequest(spy);

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
          <StudioHotkeys />
        </StudioProvider>,
      );
    });

    await act(async () => {
      const event = new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(spy).toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it("DiagnosticsPanel onSelect fires with the clicked marker when diagnostics exist", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    // Bad MEL to force diagnostics.
    const adapter = createHeadlessAdapter({ initialSource: "domain Bad { oops" });
    const core = createStudioCore();
    const select = vi.fn();

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
          <DiagnosticsPanel onSelect={select} />
        </StudioProvider>,
      );
    });
    await act(async () => {
      adapter.requestBuild();
      await new Promise((r) => setTimeout(r, 0));
    });

    const rows = container.querySelectorAll("[data-testid=diagnostic-row]");
    expect(rows.length).toBeGreaterThan(0);
    await act(async () => {
      (rows[0] as HTMLElement).click();
    });
    expect(select).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
