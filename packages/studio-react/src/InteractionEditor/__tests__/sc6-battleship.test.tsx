/**
 * P1-SC-6 + P1-SC-7 browser parity tests against battleship.mel.
 *
 *   SC-6: the 180+ node battleship graph builds, every action shows up
 *         in the InteractionEditor picker, and the full simulate-then-
 *         dispatch flow against `setupBoard` switches `phase → "playing"`.
 *   SC-7: dispatching `shoot` before phase is "playing" surfaces a
 *         BlockerList (action-level `available when canShoot`).
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
import { buildGraphModel } from "../../SchemaGraphView/graph-model.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const battleshipSource = readFileSync(
  join(
    repoRoot,
    "packages",
    "studio-adapter-headless",
    "src",
    "__tests__",
    "fixtures",
    "battleship.mel",
  ),
  "utf8",
);

function fireInput(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function mountBattleship() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const adapter = createHeadlessAdapter({ initialSource: battleshipSource });
  const core = createStudioCore();
  const detach = core.attach(adapter);
  const res = await core.build();
  if (res.kind !== "ok") throw new Error("battleship build failed");
  detach();
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
        <InteractionEditor />
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

describe("P1-SC-6 — battleship parity", () => {
  it("builds battleship.mel into a dense graph and populates every action in the picker", async () => {
    const { container, core, cleanup } = await mountBattleship();
    const model = buildGraphModel(core.getModule());
    expect(model).not.toBeNull();
    if (model === null) return;
    // Battleship has ~180 graph nodes and >300 edges — the graph layer
    // should surface them without silently dropping any.
    expect(model.nodes.length).toBeGreaterThan(60);
    expect(model.edges.length).toBeGreaterThan(model.nodes.length);

    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = Array.from(select.options).map((o) => o.value);
    // Anchors that must appear in the picker.
    for (const expected of [
      "initCells",
      "setupBoard",
      "shoot",
      "recordHit",
      "recordMiss",
    ]) {
      expect(options).toContain(expected);
    }
    cleanup();
  });

  it("setupBoard dispatches and flips phase to playing", async () => {
    const { container, core, cleanup } = await mountBattleship();
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    await act(async () => {
      fireInput(select, "setupBoard");
    });
    // setupBoard takes { shipCellCount: number }
    const numberInput = container.querySelector("input[type=number]") as HTMLInputElement;
    expect(numberInput).not.toBeNull();
    await act(async () => {
      fireInput(numberInput, "20");
    });
    // Rule S1 (simulate-first): Dispatch is inert until a fresh
    // simulate resolves for the current bound intent. UX philosophy §2.2.
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
      await new Promise((r) => setTimeout(r, 30));
    });
    const snap = core.getSnapshot();
    const data = snap?.data as { phase?: string; totalShipCells?: number };
    expect(data.phase).toBe("playing");
    expect(data.totalShipCells).toBe(20);
    cleanup();
  });
});

describe("P1-SC-7 — blocker UX", () => {
  it("simulate shows blocked insight instead of a runtime error", async () => {
    const { container, cleanup } = await mountBattleship();
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    await act(async () => {
      fireInput(select, "shoot");
    });
    const textInput = container.querySelector("input[type=text]") as HTMLInputElement;
    expect(textInput).not.toBeNull();
    await act(async () => {
      fireInput(textInput, "cell-0-0");
    });
    const simulateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().startsWith("Simulate"),
    ) as HTMLButtonElement;
    await act(async () => {
      simulateBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(container.querySelector('[data-testid="intent-insight"]')?.textContent ?? "").toMatch(/simulate blocked/i);
    expect(container.querySelector('[data-testid="simulation-trace"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="simulation-playback-probe"]')
        ?.textContent ?? "",
    ).toBe("");
    cleanup();
  });

  it("shoot before initCells: clicking Dispatch stops at simulate and surfaces the available-layer blocker (Rule S1 + L2)", async () => {
    const { container, core, cleanup } = await mountBattleship();
    const select = container.querySelector("#ie-action-select") as HTMLSelectElement;
    await act(async () => {
      fireInput(select, "shoot");
    });
    // shoot takes { cellId: string }. Fill any value — availability
    // (`available when canShoot`) will fail because phase is "idle".
    const textInput = container.querySelector("input[type=text]") as HTMLInputElement;
    expect(textInput).not.toBeNull();
    await act(async () => {
      fireInput(textInput, "cell-0-0");
    });

    const beforePhase = (core.getSnapshot()?.data as { readonly phase?: string } | undefined)?.phase;
    const dispatchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().startsWith("Dispatch"),
    ) as HTMLButtonElement;
    expect(dispatchBtn.disabled).toBe(false);

    // Clicking Dispatch runs the simulate-first chain internally; when
    // the intent is blocked at the availability layer, the chain stops
    // before the actual write — state must not change and the ladder
    // must surface the blocker for the user.
    await act(async () => {
      dispatchBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    const step1 = container.querySelector('[data-testid="ladder-step-available"]') as HTMLElement;
    expect(step1?.dataset.status).toBe("blocked-here");
    for (const id of ["input-valid", "dispatchable", "simulated", "admitted"]) {
      const el = container.querySelector(`[data-testid="ladder-step-${id}"]`) as HTMLElement;
      expect(el?.dataset.status).toBe("not-yet-evaluated");
    }
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).toMatch(/blocked/);
    expect(text).toMatch(/available/);

    // Real dispatch never happened — phase is still whatever it was
    // before the click.
    const afterPhase = (core.getSnapshot()?.data as { readonly phase?: string } | undefined)?.phase;
    expect(afterPhase).toBe(beforePhase);
    cleanup();
  });
});
