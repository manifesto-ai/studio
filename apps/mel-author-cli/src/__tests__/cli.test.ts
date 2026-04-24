import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../cli.js";

describe("MEL Author CLI argument parsing", () => {
  it("parses a headless author command", () => {
    const parsed = parseCliArgs([
      "author",
      "--source",
      "fixtures/taskflow.mel",
      "--request",
      "Add clearDoneTasks",
      "--strategy",
      "lens",
      "--max-steps",
      "9",
      "--allow-failure",
    ]);

    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok" || parsed.value.command !== "author") return;
    expect(parsed.value.sourcePath).toBe("fixtures/taskflow.mel");
    expect(parsed.value.request).toBe("Add clearDoneTasks");
    expect(parsed.value.strategy).toBe("lens");
    expect(parsed.value.maxSteps).toBe(9);
    expect(parsed.value.allowFailure).toBe(true);
  });

  it("rejects invalid strategies", () => {
    const parsed = parseCliArgs([
      "author",
      "--source",
      "fixtures/taskflow.mel",
      "--request",
      "Add clearDoneTasks",
      "--strategy",
      "unknown",
    ]);

    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("--strategy");
    }
  });
});
