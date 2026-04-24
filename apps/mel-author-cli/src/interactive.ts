import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { createMelAuthorWorkspace } from "@manifesto-ai/studio-mel-author-agent";
import { formatJson, writeJsonReport } from "./report.js";
import {
  runMelAuthorAgent,
  type MelAuthorCliRunReport,
  type MelAuthorCliStrategy,
} from "./runner.js";

export type InteractiveSessionOptions = {
  readonly source: string;
  readonly sourcePath: string;
  readonly strategy: MelAuthorCliStrategy;
  readonly maxSteps?: number;
  readonly temperature?: number;
  readonly stdin: Readable;
  readonly stdout: Writable;
};

export async function runInteractiveSession(
  options: InteractiveSessionOptions,
): Promise<void> {
  const rl = createInterface({
    input: options.stdin,
    output: options.stdout,
    terminal: true,
  });
  let strategy = options.strategy;
  let lastReport: MelAuthorCliRunReport | null = null;

  write(
    options.stdout,
    [
      `MEL Author CLI interactive session`,
      `source: ${options.sourcePath}`,
      `strategy: ${strategy}`,
      `type :help for commands`,
      "",
    ].join("\n"),
  );

  try {
    for (;;) {
      const line = (await rl.question("mel-author> ")).trim();
      if (line === "") continue;
      if (line === ":quit" || line === ":q" || line === "exit") break;
      if (line === ":help") {
        write(options.stdout, interactiveHelp());
        continue;
      }
      if (line === ":source") {
        write(options.stdout, `${options.source}\n`);
        continue;
      }
      if (line === ":outline") {
        await printOutline(options.stdout, options.source);
        continue;
      }
      if (line === ":last") {
        write(options.stdout, formatJson(lastReport ?? { ok: false }));
        continue;
      }
      if (line === ":trace") {
        write(options.stdout, formatJson(lastReport?.toolTrace ?? []));
        continue;
      }
      if (line === ":lineage") {
        write(options.stdout, formatJson(lastReport?.authorLineage ?? null));
        continue;
      }
      if (line.startsWith(":save ")) {
        if (lastReport === null) {
          write(options.stdout, "no report to save\n");
          continue;
        }
        const path = line.slice(":save ".length).trim();
        await writeJsonReport(path, lastReport);
        write(options.stdout, `saved ${path}\n`);
        continue;
      }
      if (line.startsWith(":strategy ")) {
        const next = line.slice(":strategy ".length).trim();
        if (next !== "lens" && next !== "full-source") {
          write(options.stdout, 'strategy must be "lens" or "full-source"\n');
          continue;
        }
        strategy = next;
        write(options.stdout, `strategy: ${strategy}\n`);
        continue;
      }

      const request = line.startsWith(":request ")
        ? line.slice(":request ".length).trim()
        : line;
      if (request === "") {
        write(options.stdout, "request is empty\n");
        continue;
      }
      lastReport = await runMelAuthorAgent({
        source: options.source,
        sourcePath: options.sourcePath,
        request,
        strategy,
        maxSteps: options.maxSteps,
        temperature: options.temperature,
      });
      printRunSummary(options.stdout, lastReport);
    }
  } finally {
    rl.close();
  }
}

function interactiveHelp(): string {
  return [
    "Commands:",
    "  :request <text>          Run the author agent. Plain text also works.",
    "  :source                  Print the loaded source.",
    "  :outline                 Build and print source outline.",
    "  :last                    Print the last full JSON report.",
    "  :trace                   Print the last tool trace.",
    "  :lineage                 Print the last author lineage.",
    "  :save <path>             Save the last JSON report.",
    "  :strategy lens|full-source",
    "  :quit",
    "",
  ].join("\n");
}

async function printOutline(stdout: Writable, source: string): Promise<void> {
  const workspace = createMelAuthorWorkspace({ source });
  const build = await workspace.build();
  if (build.status !== "ok") {
    write(stdout, formatJson(build));
    return;
  }
  const outline = workspace.inspectSourceOutline();
  write(stdout, formatJson(outline));
}

function printRunSummary(
  stdout: Writable,
  report: MelAuthorCliRunReport,
): void {
  if (report.ok) {
    write(
      stdout,
      [
        `ok: true`,
        `status: ${report.output?.status ?? "(unknown)"}`,
        `toolCalls: ${report.toolCallCount}`,
        `finishReason: ${report.finishReason ?? "(unknown)"}`,
        `title: ${report.output?.title ?? "(untitled)"}`,
        "",
      ].join("\n"),
    );
    return;
  }
  write(
    stdout,
    [
      `ok: false`,
      `kind: ${report.failureReport?.failureKind ?? report.kind ?? "unknown"}`,
      `message: ${report.message ?? "(none)"}`,
      `toolCalls: ${report.toolCallCount}`,
      `finishReason: ${report.finishReason ?? "(unknown)"}`,
      "",
    ].join("\n"),
  );
}

function write(stdout: Writable, text: string): void {
  stdout.write(text);
}
