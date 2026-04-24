import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { runMelAuthorAgent } from "../runner.js";

describe("MEL Author CLI Ollama integration", () => {
  it.skipIf(process.env.MEL_AUTHOR_CLI_INTEGRATION !== "1")(
    "runs against a real configured model",
    async () => {
      const source = await readFile(
        new URL("../../../fixtures/taskflow.mel", import.meta.url),
        "utf8",
      );
      const report = await runMelAuthorAgent({
        source,
        sourcePath: "apps/mel-author-cli/fixtures/taskflow.mel",
        request:
          "Add clearDoneTasks(stamp: ClockStamp) to permanently remove tasks with status done.",
        strategy: "lens",
        maxSteps: 8,
        temperature: 0.2,
      });

      expect(report.model.provider).toBeDefined();
      expect(report.toolCallCount).toBeGreaterThan(0);
      expect(report.toolTrace.length).toBeGreaterThan(0);
      if (report.ok) {
        expect(report.output?.proposedSource).toContain("clearDoneTasks");
      } else {
        expect(report.failureReport?.summary).toEqual(expect.any(String));
      }
    },
    120_000,
  );
});
