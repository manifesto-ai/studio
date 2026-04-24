import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { formatJson, writeJsonReport } from "./report.js";
import {
  runInteractiveSession,
  type InteractiveSessionOptions,
} from "./interactive.js";
import {
  runMelAuthorAgent,
  type MelAuthorCliStrategy,
} from "./runner.js";

export type ParsedCliCommand =
  | {
      readonly command: "help";
    }
  | {
      readonly command: "author";
      readonly sourcePath: string;
      readonly request: string;
      readonly outPath?: string;
      readonly title?: string;
      readonly maxSteps?: number;
      readonly temperature?: number;
      readonly strategy: MelAuthorCliStrategy;
      readonly allowFailure: boolean;
    }
  | {
      readonly command: "interactive";
      readonly sourcePath: string;
      readonly strategy: MelAuthorCliStrategy;
      readonly maxSteps?: number;
      readonly temperature?: number;
    };

export type CliParseResult =
  | { readonly kind: "ok"; readonly value: ParsedCliCommand }
  | { readonly kind: "error"; readonly message: string };

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n\n${helpText()}`);
    return 2;
  }

  if (parsed.value.command === "help") {
    process.stdout.write(helpText());
    return 0;
  }

  if (parsed.value.command === "interactive") {
    const source = await readFile(parsed.value.sourcePath, "utf8");
    const options: InteractiveSessionOptions = {
      source,
      sourcePath: parsed.value.sourcePath,
      strategy: parsed.value.strategy,
      maxSteps: parsed.value.maxSteps,
      temperature: parsed.value.temperature,
      stdin: process.stdin,
      stdout: process.stdout,
    };
    await runInteractiveSession(options);
    return 0;
  }

  const source = await readFile(parsed.value.sourcePath, "utf8");
  const report = await runMelAuthorAgent({
    source,
    sourcePath: parsed.value.sourcePath,
    request: parsed.value.request,
    title: parsed.value.title,
    maxSteps: parsed.value.maxSteps,
    temperature: parsed.value.temperature,
    strategy: parsed.value.strategy,
  });
  if (parsed.value.outPath !== undefined) {
    await writeJsonReport(parsed.value.outPath, report);
  }
  process.stdout.write(formatJson(report));
  return report.ok || parsed.value.allowFailure ? 0 : 1;
}

export function parseCliArgs(argv: readonly string[]): CliParseResult {
  const [command = "help", ...rest] = argv;
  if (command === "-h" || command === "--help" || command === "help") {
    return { kind: "ok", value: { command: "help" } };
  }
  if (command !== "author" && command !== "interactive") {
    return {
      kind: "error",
      message: `unknown command "${command}".`,
    };
  }

  const flags = parseFlags(rest);
  if (flags.kind === "error") return flags;
  const sourcePath = readRequiredFlag(flags.value, "source");
  if (sourcePath.kind === "error") return sourcePath;

  const strategy = readStrategy(flags.value.strategy);
  if (strategy.kind === "error") return strategy;
  const maxSteps = readOptionalInteger(flags.value, "max-steps");
  if (maxSteps.kind === "error") return maxSteps;
  const temperature = readOptionalNumber(flags.value, "temperature");
  if (temperature.kind === "error") return temperature;

  if (command === "interactive") {
    return {
      kind: "ok",
      value: {
        command,
        sourcePath: sourcePath.value,
        strategy: strategy.value,
        maxSteps: maxSteps.value,
        temperature: temperature.value,
      },
    };
  }

  const request = readRequiredFlag(flags.value, "request");
  if (request.kind === "error") return request;
  return {
    kind: "ok",
    value: {
      command,
      sourcePath: sourcePath.value,
      request: request.value,
      outPath: flags.value.out,
      title: flags.value.title,
      maxSteps: maxSteps.value,
      temperature: temperature.value,
      strategy: strategy.value,
      allowFailure: flags.value["allow-failure"] === "true",
    },
  };
}

function parseFlags(
  argv: readonly string[],
): { readonly kind: "ok"; readonly value: Record<string, string> } | {
  readonly kind: "error";
  readonly message: string;
} {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      return { kind: "error", message: `unexpected argument "${arg}".` };
    }
    const body = arg.slice(2);
    if (body === "allow-failure") {
      values[body] = "true";
      continue;
    }
    const eq = body.indexOf("=");
    if (eq >= 0) {
      values[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      return { kind: "error", message: `missing value for --${body}.` };
    }
    values[body] = next;
    index += 1;
  }
  return { kind: "ok", value: values };
}

function readRequiredFlag(
  flags: Record<string, string>,
  name: string,
): { readonly kind: "ok"; readonly value: string } | {
  readonly kind: "error";
  readonly message: string;
} {
  const value = flags[name];
  if (value === undefined || value.trim() === "") {
    return { kind: "error", message: `--${name} is required.` };
  }
  return { kind: "ok", value };
}

function readStrategy(
  value: string | undefined,
): { readonly kind: "ok"; readonly value: MelAuthorCliStrategy } | {
  readonly kind: "error";
  readonly message: string;
} {
  if (value === undefined || value === "lens") {
    return { kind: "ok", value: "lens" };
  }
  if (value === "full-source") {
    return { kind: "ok", value: "full-source" };
  }
  return {
    kind: "error",
    message: '--strategy must be "lens" or "full-source".',
  };
}

function readOptionalInteger(
  flags: Record<string, string>,
  name: string,
): { readonly kind: "ok"; readonly value?: number } | {
  readonly kind: "error";
  readonly message: string;
} {
  const value = flags[name];
  if (value === undefined) return { kind: "ok", value: undefined };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { kind: "error", message: `--${name} must be a positive integer.` };
  }
  return { kind: "ok", value: parsed };
}

function readOptionalNumber(
  flags: Record<string, string>,
  name: string,
): { readonly kind: "ok"; readonly value?: number } | {
  readonly kind: "error";
  readonly message: string;
} {
  const value = flags[name];
  if (value === undefined) return { kind: "ok", value: undefined };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { kind: "error", message: `--${name} must be a finite number.` };
  }
  return { kind: "ok", value: parsed };
}

function helpText(): string {
  const bin = basename(process.argv[1] ?? "mel-author-cli");
  return [
    `Usage: ${bin} <command> [options]`,
    "",
    "Commands:",
    "  author       Run one headless MEL Author Agent request.",
    "  interactive  Start a local REPL around one MEL source file.",
    "",
    "Headless:",
    `  ${bin} author --source apps/mel-author-cli/fixtures/taskflow.mel --request "Add clearDoneTasks" --out temp/author-run.json`,
    "",
    "Interactive:",
    `  ${bin} interactive --source apps/mel-author-cli/fixtures/taskflow.mel`,
    "",
    "Options:",
    "  --source <path>          MEL source file.",
    "  --request <text>         User request for the author command.",
    "  --out <path>             Also write the JSON report to a file.",
    "  --strategy <name>        lens (default) or full-source.",
    "  --max-steps <n>          AI SDK tool-loop step cap. Default: 8.",
    "  --temperature <n>        Model temperature. Default: 0.2.",
    "  --title <text>           Optional fallback draft title.",
    "  --allow-failure          Exit 0 even when the agent report is ok:false.",
    "",
    "Model env:",
    "  AGENT_MODEL_PROVIDER=ollama|gateway",
    "  OLLAMA_BASE_URL=http://localhost:11434/v1",
    "  OLLAMA_HOST=http://localhost:11434",
    "  OLLAMA_MODEL=gemma4:e4b",
    "  AI_GATEWAY_API_KEY=...",
    "  AI_GATEWAY_MODEL=google/gemma-4-26b-a4b-it",
    "",
  ].join("\n");
}
