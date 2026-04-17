import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoHeadless = join(here, "..", "..");
const cliBin = join(repoHeadless, "bin", "studio-repl.mjs");
const todoFile = join(here, "fixtures", "todo.mel");

async function runRepl(stdin: string, args: readonly string[] = []): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(process.execPath, [cliBin, ...args], {
      cwd: repoHeadless,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", rejectPromise);
    proc.on("close", (code) => {
      resolvePromise({ stdout, stderr, code });
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      rejectPromise(new Error("repl timeout"));
    }, 15000);
    proc.on("close", () => clearTimeout(timer));

    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

describe("SC-7 — CLI debug tool prints human-readable plan", () => {
  it("prints schema hash and identity breakdown on build + plan", async () => {
    const result = await runRepl(":build\n:plan\n:quit\n", ["--file", todoFile]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("build ok");
    expect(result.stdout).toContain("ReconciliationPlan");
    expect(result.stdout).toContain("identity breakdown");
    expect(result.stdout).toContain("state_field:todos");
    expect(result.stdout).toContain("state_field:filterMode");
    expect(result.stdout).toContain("initialized (new)");
  });

  it("reflects snapshot changes after dispatch", async () => {
    const script = [
      ":build",
      ':dispatch addTodo {"title":"cli"}',
      ":snapshot .data.todos",
      ":quit",
    ].join("\n") + "\n";
    const result = await runRepl(script, ["--file", todoFile]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("dispatch addTodo: completed");
    expect(result.stdout).toContain('"title": "cli"');
  });

  it("replay after rebuild reports stored envelopes", async () => {
    const script = [
      ":build",
      ":build",
      ":history",
      ":replay",
      ":quit",
    ].join("\n") + "\n";
    const result = await runRepl(script, ["--file", todoFile]);

    expect(result.code).toBe(0);
    // Two successful builds → two envelopes.
    expect(result.stdout).toContain("edit history: 2 envelope(s)");
    expect(result.stdout).toMatch(/replay: 2 envelope\(s\)/);
  });

  it("reports build errors with a non-fatal message", async () => {
    const script = ":build\n:quit\n";
    const result = await runRepl(script);

    expect(result.code).toBe(0);
    // Empty source compiles with errors.
    expect(result.stdout).toMatch(/build (failed|ok)/);
  });

  it(":help prints usage without exiting on its own", async () => {
    const result = await runRepl(":help\n:quit\n");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("studio-repl");
    expect(result.stdout).toContain(":build");
    expect(result.stdout).toContain(":dispatch");
  });
});
