import { describe, expect, it } from "vitest";
import type { Marker } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "../headless-adapter.js";

describe("SE-ADP adapter contract", () => {
  it("SE-ADP-1 — exchanges source strings only", () => {
    const adapter = createHeadlessAdapter({ initialSource: "hello" });
    expect(adapter.getSource()).toBe("hello");
    expect(adapter.getPendingSource()).toBe("hello");

    adapter.setSource("world");
    expect(adapter.getSource()).toBe("world");
    expect(adapter.getPendingSource()).toBe("world");
  });

  it("SE-ADP-2 — build trigger is adapter-driven via requestBuild()", () => {
    const adapter = createHeadlessAdapter();
    let fired = 0;
    adapter.onBuildRequest(() => {
      fired++;
    });
    expect(fired).toBe(0);
    adapter.requestBuild();
    expect(fired).toBe(1);
    adapter.requestBuild();
    expect(fired).toBe(2);
  });

  it("SE-ADP-4 — setMarkers is a pure sink; markers observable for tests", () => {
    const adapter = createHeadlessAdapter();
    const markers: readonly Marker[] = [
      {
        severity: "error",
        message: "boom",
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 5, offset: 4 },
        },
        code: "E_TEST",
      },
    ];
    adapter.setMarkers(markers);
    expect(adapter.getMarkersEmitted()).toEqual(markers);
  });

  it("onBuildRequest returns a working Unsubscribe", () => {
    const adapter = createHeadlessAdapter();
    let fired = 0;
    const off = adapter.onBuildRequest(() => {
      fired++;
    });
    adapter.requestBuild();
    off();
    adapter.requestBuild();
    expect(fired).toBe(1);
  });

  it("multiple build listeners all fire on requestBuild", () => {
    const adapter = createHeadlessAdapter();
    const received: string[] = [];
    adapter.onBuildRequest(() => received.push("A"));
    adapter.onBuildRequest(() => received.push("B"));
    adapter.requestBuild();
    expect(received).toEqual(["A", "B"]);
  });
});
