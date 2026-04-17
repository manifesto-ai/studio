/**
 * Integration test for the InteractionEditor shell + ActionForm +
 * SimulatePreview + BlockerList. Exercises the full loop that P1-SC-5
 * cares about: build → pick action → fill form → simulate → dispatch →
 * snapshot reflects the dispatch.
 */
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import { StudioProvider } from "../../StudioProvider.js";
import { InteractionEditor } from "../InteractionEditor.js";

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

function fireInput(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function mountWithCoreBuilt(opts?: { build?: boolean }): Promise<{
  container: HTMLDivElement;
  root: Root;
  core: ReturnType<typeof createStudioCore>;
  cleanup: () => void;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const adapter = createHeadlessAdapter({ initialSource: todoSource });
  const core = createStudioCore();
  if (opts?.build !== false) {
    // Attach, build, detach so StudioProvider can re-attach cleanly.
    const detach = core.attach(adapter);
    const res = await core.build();
    if (res.kind !== "ok") throw new Error("build failed");
    detach();
  }
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
        <InteractionEditor />
      </StudioProvider>,
    );
  });
  return {
    container,
    root,
    core,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("InteractionEditor — todo.mel end-to-end", () => {
  it("renders the action picker with every action sorted", async () => {
    const { container, cleanup } = await mountWithCoreBuilt();
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual([
      "addTodo",
      "clearCompleted",
      "removeTodo",
      "setFilter",
      "toggleTodo",
    ]);
    cleanup();
  });

  it("shows `no input` for clearCompleted (no input action)", async () => {
    const { container, cleanup } = await mountWithCoreBuilt();
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    await act(async () => {
      fireInput(select, "clearCompleted");
    });
    expect(container.textContent ?? "").toMatch(/no input/i);
    cleanup();
  });

  it("surfaces a form for addTodo with a title text input", async () => {
    const { container, cleanup } = await mountWithCoreBuilt();
    // addTodo is first in sorted order — preselected.
    const titleInput = container.querySelector("input[type=text]") as HTMLInputElement;
    expect(titleInput).not.toBeNull();
    cleanup();
  });

  it("simulate populates the SimulatePreview with changed paths", async () => {
    const { container, cleanup } = await mountWithCoreBuilt();
    const titleInput = container.querySelector("input[type=text]") as HTMLInputElement;
    await act(async () => {
      fireInput(titleInput, "buy milk");
    });
    const simBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim().startsWith("Simulate"),
    ) as HTMLButtonElement;
    expect(simBtn).toBeDefined();
    await act(async () => {
      simBtn.click();
    });
    // Preview should surface the "simulate" header + "changed paths".
    const text = container.textContent ?? "";
    expect(text).toMatch(/simulate/i);
    expect(text.toLowerCase()).toMatch(/changed paths/);
    cleanup();
  });

  it("dispatch completes and snapshot reflects the change", async () => {
    const { container, core, cleanup } = await mountWithCoreBuilt();
    const titleInput = container.querySelector("input[type=text]") as HTMLInputElement;
    await act(async () => {
      fireInput(titleInput, "buy milk");
    });
    const dispatchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().startsWith("Dispatch"),
    ) as HTMLButtonElement;
    await act(async () => {
      dispatchBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    // The core's live snapshot now includes the new todo.
    const snap = core.getSnapshot();
    expect(snap).not.toBeNull();
    const data = snap?.data as { todos?: Array<{ title: string }> };
    expect(data.todos?.length).toBe(1);
    expect(data.todos?.[0].title).toBe("buy milk");
    // UI also shows the success banner.
    const text = container.textContent ?? "";
    expect(text).toMatch(/dispatched/i);
    cleanup();
  });

  it("dispatching clearCompleted on empty todos produces a no-op completion", async () => {
    // todo.mel's `when hasCompleted` is a flow-level conditional — not
    // an admission gate — so dispatch completes without rejection. The
    // action-level blocker path is exercised against battleship.mel
    // where `dispatchable when` turns false dispatch attempts into
    // rejected admissions.
    const { container, core, cleanup } = await mountWithCoreBuilt();
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    await act(async () => {
      fireInput(select, "clearCompleted");
    });
    const dispatchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().startsWith("Dispatch"),
    ) as HTMLButtonElement;
    await act(async () => {
      dispatchBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    const snap = core.getSnapshot();
    const data = snap?.data as { todos?: unknown[] };
    expect(data.todos).toEqual([]);
    cleanup();
  });

  it("respects module=null with an empty state", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const adapter = createHeadlessAdapter({ initialSource: todoSource });
    const core = createStudioCore();
    // Don't pre-build — module stays null. Provider will attach inside.
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
          <InteractionEditor />
        </StudioProvider>,
      );
    });
    expect(container.textContent ?? "").toMatch(/Build the module/i);
    act(() => root.unmount());
    container.remove();
  });
});
