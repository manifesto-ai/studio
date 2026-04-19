import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import { StudioProvider } from "@manifesto-ai/studio-react";
import { describe, expect, it } from "vitest";
import { ActionDispatchPopover } from "../ActionDispatchPopover";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..", "..");
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

const optionalSource = `domain OptionalInput {
  type Payload = { title: string, note?: string }

  state {
    title: string = ""
    note: string = ""
  }

  action save(payload: Payload) {
    onceIntent {
      patch title = payload.title
      patch note = coalesce(payload.note, "")
    }
  }
}`;

function fireInput(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    element.constructor.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function mountPopover(opts: {
  readonly source?: string;
  readonly actionName?: string;
} = {}): Promise<{
  container: HTMLDivElement;
  root: Root;
  core: ReturnType<typeof createStudioCore>;
  adapter: ReturnType<typeof createHeadlessAdapter>;
  anchor: HTMLDivElement;
  cleanup: () => void;
}> {
  const container = document.createElement("div");
  const anchor = document.createElement("div");
  document.body.appendChild(container);
  document.body.appendChild(anchor);

  const adapter = createHeadlessAdapter({
    initialSource: opts.source ?? todoSource,
  });
  const core = createStudioCore();
  const detach = core.attach(adapter);
  const buildResult = await core.build();
  detach();
  if (buildResult.kind !== "ok") throw new Error("build failed");

  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
        <ActionDispatchPopover
          actionName={opts.actionName ?? "addTodo"}
          anchor={anchor}
          open
          onOpenChange={() => {}}
        />
      </StudioProvider>,
    );
  });

  return {
    container,
    root,
    core,
    adapter,
    anchor,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      anchor.remove();
    },
  };
}

describe("ActionDispatchPopover", () => {
  it("dispatches through the shared ActionForm payload", async () => {
    const { core, cleanup } = await mountPopover();
    const input = document.body.querySelector("input[type=text]") as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      fireInput(input, "buy milk");
    });
    const dispatchBtn = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim().startsWith("Dispatch"),
    ) as HTMLButtonElement;
    await act(async () => {
      dispatchBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const snap = core.getSnapshot();
    const data = snap?.data as { todos?: Array<{ title: string }> };
    expect(data.todos?.[0]?.title).toBe("buy milk");
    cleanup();
  });

  it("unwraps single object parameters before dispatch", async () => {
    const { core, cleanup } = await mountPopover({
      source: optionalSource,
      actionName: "save",
    });
    const titleInput = document.body.querySelector("input[type=text]") as HTMLInputElement;
    expect(titleInput).not.toBeNull();
    await act(async () => {
      fireInput(titleInput, "hello");
    });
    const dispatchBtn = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim().startsWith("Dispatch"),
    ) as HTMLButtonElement;
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

  it("renders compact execution trace details after simulate", async () => {
    const { cleanup } = await mountPopover();
    const input = document.body.querySelector("input[type=text]") as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      fireInput(input, "buy milk");
    });
    const simulateBtn = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim().startsWith("Simulate"),
    ) as HTMLButtonElement;
    await act(async () => {
      simulateBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const traceSummary = document.body.querySelector(
      '[data-testid="simulation-trace-summary"]',
    ) as HTMLElement;
    expect(traceSummary?.textContent ?? "").toMatch(/Execution Trace/i);
    await act(async () => {
      traceSummary.click();
    });
    const traceRoot = document.body.querySelector(
      '[data-testid="simulation-trace-root-node"]',
    ) as HTMLElement;
    expect(traceRoot?.textContent ?? "").toMatch(/actions\.addTodo\.flow/i);
    cleanup();
  });

  it("does not break hooks when the anchor disappears", async () => {
    const { root, core, adapter, cleanup } = await mountPopover();
    let error: unknown = null;
    try {
      await act(async () => {
        root.render(
          <StudioProvider core={core} adapter={adapter} historyPollMs={0}>
            <ActionDispatchPopover
              actionName="addTodo"
              anchor={null}
              open
              onOpenChange={() => {}}
            />
          </StudioProvider>,
        );
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeNull();
    cleanup();
  });
});
