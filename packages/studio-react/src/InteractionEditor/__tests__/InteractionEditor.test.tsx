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
import { useStudio } from "../../useStudio.js";
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
  return mountWithSource(todoSource, opts);
}

async function mountWithSource(
  source: string,
  opts?: { build?: boolean; enforceSimulateFirst?: boolean },
): Promise<{
  container: HTMLDivElement;
  root: Root;
  core: ReturnType<typeof createStudioCore>;
  cleanup: () => void;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const adapter = createHeadlessAdapter({ initialSource: source });
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
        <InteractionEditor
          enforceSimulateFirst={opts?.enforceSimulateFirst ?? true}
        />
        <SimulationPlaybackProbe />
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

const optionalSource = `domain OptionalInput {
  type Payload = { title: string, note?: string }

  state {
    title: string = ""
    note: string = ""
  }

  action reset() {
    onceIntent {
      patch title = ""
      patch note = ""
    }
  }

  action save(payload: Payload) {
    onceIntent {
      patch title = payload.title
      patch note = coalesce(payload.note, "")
    }
  }
}`;

function SimulationPlaybackProbe(): JSX.Element {
  const { simulationPlayback } = useStudio();
  return (
    <output hidden data-testid="simulation-playback-probe">
      {simulationPlayback === null
        ? ""
        : `${simulationPlayback.generation}:${simulationPlayback.source}:${simulationPlayback.mode}:${simulationPlayback.actionName}:${simulationPlayback.traceNodeId ?? ""}`}
    </output>
  );
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
    const insight = container.querySelector('[data-testid="intent-insight"]');
    expect(insight).not.toBeNull();
    const text = insight?.textContent ?? "";
    expect(text).toMatch(/simulate preview/i);
    expect(text).toMatch(/data\.todos\[0\]/i);
    expect(text).toMatch(/computed\.todoCount/i);
    expect(text).toMatch(/Execution Trace/i);
    const traceSummary = container.querySelector(
      '[data-testid="simulation-trace-summary"]',
    ) as HTMLElement;
    expect(traceSummary).not.toBeNull();
    await act(async () => {
      traceSummary.click();
    });
    const traceRoot = container.querySelector(
      '[data-testid="simulation-trace-root-node"]',
    ) as HTMLElement;
    expect(traceRoot?.textContent ?? "").toMatch(/actions\.addTodo\.flow/i);
    const playbackProbe = container.querySelector(
      '[data-testid="simulation-playback-probe"]',
    ) as HTMLElement;
    expect(playbackProbe?.textContent ?? "").toMatch(
      /interaction-editor:sequence:addTodo/i,
    );
    const replayRoot = container.querySelector(
      '[data-testid="simulation-trace-replay-trace-3"]',
    ) as HTMLButtonElement;
    expect(replayRoot).not.toBeNull();
    await act(async () => {
      replayRoot.click();
    });
    expect(playbackProbe?.textContent ?? "").toMatch(
      /interaction-editor:step:addTodo:trace-3/i,
    );
    cleanup();
  });

  it("dispatch completes and snapshot reflects the change", async () => {
    const { container, core, cleanup } = await mountWithCoreBuilt();
    const titleInput = container.querySelector("input[type=text]") as HTMLInputElement;
    await act(async () => {
      fireInput(titleInput, "buy milk");
    });
    // Rule S1 (simulate-first, UX philosophy §2.2): Dispatch is inert
    // until a fresh simulate resolves for the current bound intent.
    const simBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim().startsWith("Simulate"),
    ) as HTMLButtonElement;
    await act(async () => {
      simBtn.click();
    });
    const dispatchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().startsWith("Dispatch"),
    ) as HTMLButtonElement;
    expect(dispatchBtn.disabled).toBe(false);
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
    const insight = container.querySelector('[data-testid="intent-insight"]');
    expect(insight?.textContent ?? "").toMatch(/dispatch completed/i);
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
    // Rule S1: simulate must resolve first. clearCompleted takes no
    // input, so the bound intent is stable from mount.
    const simBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim().startsWith("Simulate"),
    ) as HTMLButtonElement;
    await act(async () => {
      simBtn.click();
    });
    const dispatchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().startsWith("Dispatch"),
    ) as HTMLButtonElement;
    expect(dispatchBtn.disabled).toBe(false);
    await act(async () => {
      dispatchBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    const snap = core.getSnapshot();
    const data = snap?.data as { todos?: unknown[] };
    expect(data.todos).toEqual([]);
    const insight = container.querySelector('[data-testid="intent-insight"]');
    expect(insight?.textContent ?? "").toMatch(/noop dispatch/i);
    cleanup();
  });

  it("restores the last payload and insight when switching away and back to an action", async () => {
    const { container, cleanup } = await mountWithCoreBuilt();
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    const titleInput = container.querySelector("input[type=text]") as HTMLInputElement;
    await act(async () => {
      fireInput(titleInput, "buy milk");
    });
    const simBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim().startsWith("Simulate"),
    ) as HTMLButtonElement;
    await act(async () => {
      simBtn.click();
    });
    await act(async () => {
      fireInput(select, "clearCompleted");
    });
    await act(async () => {
      fireInput(select, "addTodo");
    });
    const restoredInput = container.querySelector("input[type=text]") as HTMLInputElement;
    expect(restoredInput.value).toBe("buy milk");
    const insight = container.querySelector('[data-testid="intent-insight"]');
    expect(insight?.textContent ?? "").toMatch(/computed\.todoCount/i);
    cleanup();
  });

  it("marks cached results stale after the payload changes", async () => {
    const { container, cleanup } = await mountWithCoreBuilt();
    const titleInput = container.querySelector("input[type=text]") as HTMLInputElement;
    await act(async () => {
      fireInput(titleInput, "buy milk");
    });
    const simBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.trim().startsWith("Simulate"),
    ) as HTMLButtonElement;
    await act(async () => {
      simBtn.click();
    });
    await act(async () => {
      fireInput(titleInput, "buy bread");
    });
    expect(container.querySelector('[data-testid="interaction-stale"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="intent-insight"]')).toBeNull();
    cleanup();
  });

  it("restores optional field presence when switching away and back", async () => {
    const { container, cleanup } = await mountWithSource(optionalSource);
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    expect(select.value).toBe("reset");
    await act(async () => {
      fireInput(select, "save");
    });
    expect(container.querySelectorAll("input[type=text]").length).toBe(1);
    const addNoteBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("+ note"),
    ) as HTMLButtonElement;
    await act(async () => {
      addNoteBtn.click();
    });
    const inputsAfterAdd = container.querySelectorAll("input[type=text]");
    expect(inputsAfterAdd.length).toBe(2);
    await act(async () => {
      fireInput(inputsAfterAdd[1] as HTMLInputElement, "memo");
    });
    await act(async () => {
      fireInput(select, "reset");
    });
    await act(async () => {
      fireInput(select, "save");
    });
    const restoredInputs = container.querySelectorAll("input[type=text]");
    expect(restoredInputs.length).toBe(2);
    expect((restoredInputs[1] as HTMLInputElement).value).toBe("memo");
    cleanup();
  });

  it("dispatches sparse optional payloads via Simulate-first (Rule S1)", async () => {
    // Sparse-optional regression: `save({ title: "hello" })` with the
    // `note?` field omitted used to throw "Unknown field: payload" on
    // the simulate() path because studio-core didn't unwrap
    // intent.input by parameter name. Fixed in create-studio-core.ts;
    // this test now exercises the full Rule S1 flow (Simulate unlocks
    // Dispatch) to guard the regression.
    const { container, core, cleanup } = await mountWithSource(optionalSource);
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    await act(async () => {
      fireInput(select, "save");
    });
    const titleInput = container.querySelector("input[type=text]") as HTMLInputElement;
    await act(async () => {
      fireInput(titleInput, "hello");
    });
    const simulateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().startsWith("Simulate"),
    ) as HTMLButtonElement;
    await act(async () => {
      simulateBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const dispatchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().startsWith("Dispatch"),
    ) as HTMLButtonElement;
    expect(dispatchBtn.disabled).toBe(false);
    await act(async () => {
      dispatchBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const snap = core.getSnapshot();
    const data = snap?.data as { title?: string; note?: string };
    expect(data.title).toBe("hello");
    expect(data.note).toBe("");
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
