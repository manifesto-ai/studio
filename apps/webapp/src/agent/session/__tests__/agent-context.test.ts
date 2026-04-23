/**
 * agent-context tests — post introspection pivot.
 *
 * StudioAgentContext now carries only the static pieces the system
 * prompt needs (hasModule + melSource + diagnostics). All dynamic
 * values (focus, snapshot, availability, graph neighbors) flow through
 * inspect-* tools and are not tested here.
 *
 * Coverage:
 *   1. Reader — hasModule reflects compile state, diagnostics counted.
 *   2. Builder — identity anchor present, tool catalog present, MEL
 *      source block emitted, and — crucially — no dynamic snapshot /
 *      focus / availability content leaks into the prompt (that's the
 *      whole point of the pivot).
 */
import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  readStudioAgentContext,
  type AgentContextCore,
} from "../agent-context.js";

function makeCore(overrides: Partial<AgentContextCore> = {}): AgentContextCore {
  const defaults: AgentContextCore = {
    getModule: () =>
      ({
        schema: {
          actions: {
            toggleTodo: { params: ["id"] },
            addTodo: { params: ["text"] },
          },
        },
      }) as unknown as ReturnType<AgentContextCore["getModule"]>,
    getDiagnostics: () => [],
  };
  return { ...defaults, ...overrides };
}

describe("readStudioAgentContext", () => {
  it("returns hasModule:true when the user module compiles", () => {
    const ctx = readStudioAgentContext(makeCore(), "/* mel */");
    expect(ctx.hasModule).toBe(true);
    expect(ctx.melSource).toBe("/* mel */");
    expect(ctx.diagnostics).toEqual({ errors: 0, warnings: 0 });
  });

  it("returns hasModule:false with diagnostics when the module didn't compile", () => {
    const ctx = readStudioAgentContext(
      makeCore({
        getModule: () => null,
        getDiagnostics: () =>
          [
            { severity: "error" } as never,
            { severity: "error" } as never,
            { severity: "warning" } as never,
          ],
      }),
      "state { bad }",
    );
    expect(ctx.hasModule).toBe(false);
    expect(ctx.diagnostics).toEqual({ errors: 2, warnings: 1 });
    expect(ctx.melSource).toBe("state { bad }");
  });
});

describe("buildAgentSystemPrompt — identity + tool catalog", () => {
  it("leads with the identity anchor (MEL as soul source)", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}");
    const prompt = buildAgentSystemPrompt(ctx);
    // Identity framing is what stops the model from treating MEL as
    // external reference material. These phrases are load-bearing.
    expect(prompt).toContain("You know this Manifesto runtime from the inside");
    expect(prompt).toContain("soul source code");
    expect(prompt).toMatch(/introspect via tools/);
  });

  it("advertises every inspect tool by name in the catalog", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}");
    const prompt = buildAgentSystemPrompt(ctx);
    expect(prompt).toContain("inspectFocus()");
    expect(prompt).toContain("inspectSnapshot()");
    expect(prompt).toContain("inspectAvailability()");
    expect(prompt).toContain("inspectNeighbors(nodeId)");
    expect(prompt).toContain("explainLegality");
    expect(prompt).toContain("dispatch(action, args)");
    expect(prompt).toContain("studioDispatch(action, args)");
    // seedMock is the one-call write path — must be listed so the
    // agent doesn't stop at the generate-only step.
    expect(prompt).toContain("seedMock");
    expect(prompt).toContain("generateMock");
  });

  it("gives a grounding recipe so the model knows to inspect first", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}");
    const prompt = buildAgentSystemPrompt(ctx);
    expect(prompt).toContain("How to ground yourself");
    // Deictic cue explicitly listed so gemma4 picks it up.
    expect(prompt).toContain("'이거'");
    // Each inspect tool has an "when to call it" hint.
    expect(prompt).toMatch(/inspectFocus\(\) first/);
    expect(prompt).toMatch(/inspectSnapshot\(\)/);
  });
});

describe("buildAgentSystemPrompt — MEL body", () => {
  it("emits the MEL source under '# Your soul (MEL)'", () => {
    const ctx = readStudioAgentContext(makeCore(), "domain Foo { state {} }");
    const prompt = buildAgentSystemPrompt(ctx);
    expect(prompt).toContain("# Your soul (MEL)");
    expect(prompt).toContain("```mel");
    expect(prompt).toContain("domain Foo { state {} }");
  });

  it("falls back to a 'no compiled MEL' header with diagnostics when the module failed", () => {
    const ctx = readStudioAgentContext(
      makeCore({
        getModule: () => null,
        getDiagnostics: () =>
          [
            { severity: "error" } as never,
            { severity: "warning" } as never,
            { severity: "error" } as never,
          ],
      }),
      "state { bad }",
    );
    const prompt = buildAgentSystemPrompt(ctx);
    expect(prompt).toContain("No compiled MEL");
    expect(prompt).toContain("errors=2");
    expect(prompt).toContain("warnings=1");
    // Even when the module didn't compile we still ship the source so
    // the agent can answer "why doesn't it compile" follow-ups.
    expect(prompt).toContain("state { bad }");
  });
});

describe("buildAgentSystemPrompt — dynamic state is NOT in the prompt", () => {
  // The whole pivot is: dynamic state flows through tools, never the
  // prompt. These assertions guard against regression — a future
  // tempted dev must not add focus/snapshot/availability blocks back
  // into buildAgentSystemPrompt.

  it("does not embed a focus summary line", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}");
    const prompt = buildAgentSystemPrompt(ctx);
    expect(prompt).not.toMatch(/^focus = /m);
  });

  it("does not embed a ui state line", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}");
    const prompt = buildAgentSystemPrompt(ctx);
    expect(prompt).not.toMatch(/^ui = /m);
  });

  it("does not embed an availability listing section", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}");
    const prompt = buildAgentSystemPrompt(ctx);
    // The old prompt had "✓ toggleTodo" / "✗ clearDone" lines. The
    // new prompt must not enumerate actions — inspectAvailability()
    // does that.
    expect(prompt).not.toMatch(/^- [✓✗] \w+/m);
  });

  it("does not embed a snapshot JSON block", () => {
    const ctx = readStudioAgentContext(makeCore(), "state {}");
    const prompt = buildAgentSystemPrompt(ctx);
    expect(prompt).not.toContain("```json");
    expect(prompt).not.toContain("Your current state (snapshot)");
  });
});
