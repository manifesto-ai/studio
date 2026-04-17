import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActionForm } from "../ActionForm.js";
import type { FormDescriptor } from "../field-descriptor.js";

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

function fireInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ActionForm — primitives", () => {
  it("renders a text input for string and emits string changes", () => {
    const { container, root, cleanup } = mount();
    const onChange = vi.fn();
    act(() => {
      root.render(
        <ActionForm
          descriptor={{ kind: "string", required: true }}
          value=""
          onChange={onChange}
          label="title"
        />,
      );
    });
    const input = container.querySelector("input[type=text]") as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      fireInput(input, "Hello");
    });
    expect(onChange).toHaveBeenLastCalledWith("Hello");
    cleanup();
  });

  it("renders a number input that emits number values", () => {
    const { container, root, cleanup } = mount();
    const onChange = vi.fn();
    act(() => {
      root.render(
        <ActionForm
          descriptor={{ kind: "number", required: false }}
          value={0}
          onChange={onChange}
        />,
      );
    });
    const input = container.querySelector("input[type=number]") as HTMLInputElement;
    act(() => {
      fireInput(input, "42");
    });
    expect(onChange).toHaveBeenLastCalledWith(42);
    cleanup();
  });

  it("renders a checkbox for boolean and emits boolean values", () => {
    const { container, root, cleanup } = mount();
    const onChange = vi.fn();
    act(() => {
      root.render(
        <ActionForm
          descriptor={{ kind: "boolean", required: true }}
          value={false}
          onChange={onChange}
        />,
      );
    });
    const checkbox = container.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    act(() => {
      checkbox.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(true);
    cleanup();
  });
});

describe("ActionForm — enum", () => {
  it("renders a select with the descriptor options", () => {
    const { container, root, cleanup } = mount();
    const onChange = vi.fn();
    const desc: FormDescriptor = {
      kind: "enum",
      required: true,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    act(() => {
      root.render(
        <ActionForm descriptor={desc} value="a" onChange={onChange} label="pick" />,
      );
    });
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    act(() => {
      select.value = "b";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("b");
    cleanup();
  });
});

describe("ActionForm — object", () => {
  it("renders nested fields by name and routes onChange to the right key", () => {
    const { container, root, cleanup } = mount();
    const onChange = vi.fn();
    const desc: FormDescriptor = {
      kind: "object",
      required: true,
      fields: [
        { name: "title", descriptor: { kind: "string", required: true } },
        { name: "done", descriptor: { kind: "boolean", required: false } },
      ],
    };
    act(() => {
      root.render(
        <ActionForm
          descriptor={desc}
          value={{ title: "", done: false }}
          onChange={onChange}
          label="todo"
        />,
      );
    });
    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBe(2);
    const titleInput = container.querySelector("input[type=text]") as HTMLInputElement;
    act(() => {
      fireInput(titleInput, "buy milk");
    });
    expect(onChange).toHaveBeenLastCalledWith({ title: "buy milk", done: false });
    cleanup();
  });
});

describe("ActionForm — array", () => {
  it("renders an add button that grows the list with default items", () => {
    const { container, root, cleanup } = mount();
    const onChange = vi.fn();
    const desc: FormDescriptor = {
      kind: "array",
      required: true,
      item: { kind: "string", required: true },
    };
    act(() => {
      root.render(
        <ActionForm descriptor={desc} value={[]} onChange={onChange} label="tags" />,
      );
    });
    const addBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("add"),
    ) as HTMLButtonElement;
    expect(addBtn).toBeDefined();
    act(() => {
      addBtn.click();
    });
    expect(onChange).toHaveBeenLastCalledWith([""]);
    cleanup();
  });

  it("renders a remove button per row", () => {
    const { container, root, cleanup } = mount();
    const onChange = vi.fn();
    const desc: FormDescriptor = {
      kind: "array",
      required: true,
      item: { kind: "string", required: true },
    };
    act(() => {
      root.render(
        <ActionForm descriptor={desc} value={["a", "b"]} onChange={onChange} />,
      );
    });
    const removeBtns = Array.from(container.querySelectorAll("button")).filter((b) =>
      b.getAttribute("aria-label")?.startsWith("Remove"),
    );
    expect(removeBtns.length).toBe(2);
    act(() => {
      (removeBtns[0] as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenLastCalledWith(["b"]);
    cleanup();
  });
});

describe("ActionForm — json fallback", () => {
  it("emits parsed values and surfaces parse errors without losing focus", () => {
    const { container, root, cleanup } = mount();
    const onChange = vi.fn();
    const desc: FormDescriptor = {
      kind: "json",
      required: true,
      reason: "union test",
    };
    act(() => {
      root.render(
        <ActionForm descriptor={desc} value={null} onChange={onChange} label="raw" />,
      );
    });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    act(() => {
      fireInput(textarea, '{"a":1}');
    });
    expect(onChange).toHaveBeenLastCalledWith({ a: 1 });
    act(() => {
      fireInput(textarea, "{invalid");
    });
    // Invalid → don't clobber value; show error text.
    expect(container.textContent ?? "").toMatch(/Expected|Unexpected|JSON/i);
    cleanup();
  });
});

describe("ActionForm — disabled", () => {
  it("disables every input recursively when disabled=true", () => {
    const { container, root, cleanup } = mount();
    const desc: FormDescriptor = {
      kind: "object",
      required: true,
      fields: [
        { name: "title", descriptor: { kind: "string", required: true } },
        { name: "done", descriptor: { kind: "boolean", required: false } },
      ],
    };
    act(() => {
      root.render(
        <ActionForm
          descriptor={desc}
          value={{ title: "x", done: false }}
          onChange={() => {}}
          disabled
          label="todo"
        />,
      );
    });
    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs.length).toBeGreaterThan(0);
    for (const i of inputs) expect(i.disabled).toBe(true);
    cleanup();
  });
});
