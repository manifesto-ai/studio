#!/usr/bin/env node
// @ts-check
import { createInterface } from "node:readline";
import { readFileSync, watch } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createStudioCore,
  createInMemoryEditHistoryStore,
  formatPlan,
  replayHistory,
} from "@manifesto-ai/studio-core";
import {
  createSqliteEditHistoryStore,
  defaultEditHistoryDbPath,
} from "@manifesto-ai/studio-core/sqlite";
import { createHeadlessAdapter } from "../dist/index.js";

const USAGE = `studio-repl — interactive Studio Editor debug REPL

Usage:
  studio-repl [--file <path.mel>] [--history <sqlite-path>] [--prompt <str>]

Commands (inside the REPL, prefixed with ':'):
  :help                show this help
  :build               compile current source and apply reconciliation
  :reload              re-read source from --file (if provided)
  :source              print current source buffer
  :actions             list actions available on the active runtime
  :dispatch <name> [jsonInput]
                       create + dispatch an intent (jsonInput is optional)
  :plan                print the last ReconciliationPlan
  :snapshot [.path]    print full snapshot or a dotted subpath
  :history             print edit-history summary
  :replay              replay the edit-history and print the final schema hash
  :quit                exit (alias: :exit, Ctrl-D)
`;

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    history: { type: "string" },
    prompt: { type: "string", default: "studio> " },
    help: { type: "boolean", default: false },
  },
  strict: false,
});

if (values.help === true) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const filePath =
  typeof values.file === "string" && values.file.length > 0
    ? resolve(values.file)
    : null;

const historyStore =
  typeof values.history === "string" && values.history.length > 0
    ? createSqliteEditHistoryStore({
        path: resolve(values.history === "default" ? defaultEditHistoryDbPath(process.cwd()) : values.history),
      })
    : createInMemoryEditHistoryStore();

function loadSource() {
  if (filePath === null) return "";
  try {
    return readFileSync(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[studio-repl] cannot read ${filePath}: ${message}\n`);
    return "";
  }
}

const adapter = createHeadlessAdapter({ initialSource: loadSource() });
const core = createStudioCore({ editHistoryStore: historyStore });
core.attach(adapter);

/**
 * @param {string} path
 * @param {unknown} value
 * @returns {unknown}
 */
function pluckPath(path, value) {
  if (path === "") return value;
  const segments = path.replace(/^\./, "").split(".").filter((s) => s.length > 0);
  let current = value;
  for (const seg of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = /** @type {Record<string, unknown>} */ (current)[seg];
  }
  return current;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function runBuild() {
  const result = await core.build();
  if (result.kind === "ok") {
    process.stdout.write(`build ok  schemaHash=${result.schemaHash}\n`);
    process.stdout.write(`warnings: ${result.warnings.length}\n`);
  } else {
    process.stdout.write(`build failed (${result.errors.length} errors)\n`);
    for (const err of result.errors) {
      process.stdout.write(`  error: ${err.message}\n`);
    }
  }
}

async function dispatchCommand(rawArgs) {
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0) {
    process.stdout.write("usage: :dispatch <actionName> [jsonInput]\n");
    return;
  }
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  if (match === null) {
    process.stdout.write("usage: :dispatch <actionName> [jsonInput]\n");
    return;
  }
  const [, name, inputRaw] = match;
  let input = undefined;
  if (typeof inputRaw === "string") {
    try {
      input = JSON.parse(inputRaw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  invalid JSON input: ${message}\n`);
      return;
    }
  }
  try {
    const intent =
      input === undefined ? core.createIntent(name) : core.createIntent(name, input);
    const report = await core.dispatchAsync(intent);
    process.stdout.write(`dispatch ${name}: ${report.kind}\n`);
    if (report.traceIds.length > 0) {
      process.stdout.write(`  traceIds: ${report.traceIds.join(", ")}\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`  error: ${message}\n`);
  }
}

async function handleCommand(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (!trimmed.startsWith(":")) {
    process.stdout.write(`unknown input (commands must start with ':'). Try :help\n`);
    return true;
  }
  const spaceIdx = trimmed.indexOf(" ");
  const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  switch (cmd) {
    case ":help":
      process.stdout.write(`${USAGE}\n`);
      return true;
    case ":quit":
    case ":exit":
      return false;
    case ":source":
      process.stdout.write(`${adapter.getSource()}\n`);
      return true;
    case ":reload": {
      if (filePath === null) {
        process.stdout.write("no --file provided; nothing to reload\n");
        return true;
      }
      adapter.setSource(loadSource());
      process.stdout.write(`reloaded from ${filePath}\n`);
      return true;
    }
    case ":build":
      await runBuild();
      return true;
    case ":actions": {
      const mod = core.getModule();
      if (mod === null) {
        process.stdout.write("no module yet (run :build)\n");
        return true;
      }
      const names = Object.keys(mod.schema.actions).sort();
      process.stdout.write(`actions (${names.length}):\n`);
      for (const n of names) process.stdout.write(`  • ${n}\n`);
      return true;
    }
    case ":dispatch":
      await dispatchCommand(rest);
      return true;
    case ":plan": {
      const plan = core.getLastReconciliationPlan();
      if (plan === null) {
        process.stdout.write("no plan yet (run :build)\n");
      } else {
        process.stdout.write(`${formatPlan(plan)}\n`);
      }
      return true;
    }
    case ":snapshot": {
      const snap = core.getSnapshot();
      if (snap === null) {
        process.stdout.write("no snapshot yet (run :build)\n");
      } else if (rest.length === 0) {
        printJson(snap);
      } else {
        printJson(pluckPath(rest.trim(), snap));
      }
      return true;
    }
    case ":history": {
      const history = await core.getEditHistory();
      process.stdout.write(`edit history: ${history.length} envelope(s)\n`);
      for (const env of history) {
        process.stdout.write(
          `  ${env.id}  ${env.payloadKind}  ${env.prevSchemaHash ?? "∅"} → ${env.nextSchemaHash}\n`,
        );
      }
      return true;
    }
    case ":replay": {
      const result = await replayHistory(historyStore);
      process.stdout.write(
        `replay: ${result.envelopes.length} envelope(s), final hash=${
          result.module?.schema.hash ?? "∅"
        }, plans=${result.plans.length}\n`,
      );
      return true;
    }
    default:
      process.stdout.write(`unknown command: ${cmd}. Try :help\n`);
      return true;
  }
}

async function main() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
    prompt: typeof values.prompt === "string" ? values.prompt : "studio> ",
  });

  let watcher = null;
  if (filePath !== null) {
    try {
      watcher = watch(filePath, { persistent: false }, () => {
        // Intentionally silent — :reload is explicit to keep determinism
      });
    } catch {
      watcher = null;
    }
  }

  process.stdout.write(`studio-repl ready. Try :help\n`);
  rl.prompt();

  for await (const line of rl) {
    const continueLoop = await handleCommand(line);
    if (!continueLoop) break;
    rl.prompt();
  }

  rl.close();
  watcher?.close();
  await historyStore.close?.();
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[studio-repl] fatal: ${message}\n`);
  process.exit(1);
});
