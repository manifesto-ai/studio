import { describe, expect, it, vi } from "vitest";
import type { Marker } from "@manifesto-ai/studio-core";
import {
  createMonacoAdapter,
  type MonacoEditorLike,
  type MonacoLike,
  type MonacoMarkerData,
} from "../monaco-adapter.js";

type ChangeListener = () => void;

function makeFakeEditor(initial: string) {
  let value = initial;
  const model = { __kind: "fake-model" };
  const listeners = new Set<ChangeListener>();

  const editor: MonacoEditorLike = {
    getValue: () => value,
    setValue: (next: string) => {
      value = next;
      for (const l of listeners) l();
    },
    getModel: () => model,
    onDidChangeModelContent: (listener: ChangeListener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
  };
  return {
    editor,
    model,
    dispatchChange: () => {
      for (const l of listeners) l();
    },
  };
}

function makeFakeMonaco() {
  const setModelMarkers = vi.fn<
    [unknown, string, MonacoMarkerData[]],
    void
  >();
  const monaco: MonacoLike = { editor: { setModelMarkers } };
  return { monaco, setModelMarkers };
}

const SPAN_OK: Marker["span"] = {
  start: { line: 4, column: 9 },
  end: { line: 4, column: 19 },
};

describe("Monaco adapter — EditorAdapter contract (SE-ADP + headless parity)", () => {
  it("SE-ADP-1: getSource / setSource round-trip the editor value", () => {
    const { editor } = makeFakeEditor("v1");
    const { monaco } = makeFakeMonaco();
    const adapter = createMonacoAdapter({ editor, monaco });

    expect(adapter.getSource()).toBe("v1");
    adapter.setSource("v2");
    expect(adapter.getSource()).toBe("v2");
    adapter.dispose();
  });

  it("SE-ADP-2 / SE-BUILD-1: requestBuild fans out to onBuildRequest listeners only when called explicitly", () => {
    const { editor } = makeFakeEditor("src");
    const { monaco } = makeFakeMonaco();
    const adapter = createMonacoAdapter({ editor, monaco });

    const spy = vi.fn();
    const unsub = adapter.onBuildRequest(spy);

    // No implicit trigger on setSource.
    adapter.setSource("edited");
    expect(spy).not.toHaveBeenCalled();

    adapter.requestBuild();
    expect(spy).toHaveBeenCalledTimes(1);

    adapter.requestBuild();
    expect(spy).toHaveBeenCalledTimes(2);

    unsub();
    adapter.requestBuild();
    expect(spy).toHaveBeenCalledTimes(2);

    adapter.dispose();
  });

  it("SE-ADP-4: setMarkers forwards to monaco.editor.setModelMarkers with the configured owner", () => {
    const { editor, model } = makeFakeEditor("src");
    const { monaco, setModelMarkers } = makeFakeMonaco();
    const adapter = createMonacoAdapter({
      editor,
      monaco,
      markerOwner: "studio-test",
    });

    const markers: readonly Marker[] = [
      { severity: "error", message: "bad", span: SPAN_OK, code: "E001" },
      { severity: "warning", message: "huh", span: SPAN_OK },
    ];
    adapter.setMarkers(markers);

    expect(setModelMarkers).toHaveBeenCalledTimes(1);
    const call = setModelMarkers.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) return;
    const [passedModel, owner, forwarded] = call;
    expect(passedModel).toBe(model);
    expect(owner).toBe("studio-test");
    expect(forwarded).toHaveLength(2);
    expect(forwarded[0]).toMatchObject({
      severity: 8,
      message: "bad",
      startLineNumber: 4,
      startColumn: 9,
      endLineNumber: 4,
      endColumn: 19,
      code: "E001",
    });
    expect(forwarded[1]).toMatchObject({ severity: 4, message: "huh" });
    adapter.dispose();
  });

  it("setMarkers with no model available is a no-op (detached editor)", () => {
    const { editor } = makeFakeEditor("src");
    // @ts-expect-error — intentional override to simulate disposed model
    editor.getModel = () => null;
    const { monaco, setModelMarkers } = makeFakeMonaco();
    const adapter = createMonacoAdapter({ editor, monaco });

    adapter.setMarkers([
      { severity: "info", message: "hi", span: SPAN_OK },
    ]);
    expect(setModelMarkers).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("setSource suppresses the content-change loop (sketch §4 guarantee)", () => {
    const { editor, dispatchChange } = makeFakeEditor("init");
    const { monaco } = makeFakeMonaco();
    const adapter = createMonacoAdapter({ editor, monaco });

    // Manual external change still fires listeners inside the adapter, but
    // the adapter does not spuriously trigger builds. We assert the inverse:
    // a setSource() call that internally fires onDidChangeModelContent does
    // NOT invoke any build listeners.
    const buildSpy = vi.fn();
    adapter.onBuildRequest(buildSpy);

    adapter.setSource("next"); // setValue → fires change listeners → must be suppressed
    dispatchChange(); // external change event — also must not auto-build
    expect(buildSpy).not.toHaveBeenCalled();

    adapter.dispose();
  });

  it("dispose clears markers and detaches the change listener", () => {
    const { editor, model, dispatchChange } = makeFakeEditor("src");
    const { monaco, setModelMarkers } = makeFakeMonaco();
    const adapter = createMonacoAdapter({ editor, monaco });

    // Fill some markers first so we can observe the clear on dispose.
    adapter.setMarkers([
      { severity: "warning", message: "w", span: SPAN_OK },
    ]);
    expect(setModelMarkers).toHaveBeenCalledTimes(1);

    adapter.dispose();

    // Dispose should have issued an empty-marker flush to the same owner.
    expect(setModelMarkers).toHaveBeenCalledTimes(2);
    const lastCall = setModelMarkers.mock.calls[1];
    expect(lastCall).toBeDefined();
    if (lastCall === undefined) return;
    const [, , flushed] = lastCall;
    expect(flushed).toEqual([]);

    // Further events are no-ops (listener removed).
    dispatchChange();
    // Idempotent dispose — no throw, no extra calls.
    adapter.dispose();
    expect(setModelMarkers).toHaveBeenCalledTimes(2);
    // model unused in assertion, silence linter
    void model;
  });
});
