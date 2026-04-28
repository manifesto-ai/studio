import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  readStudioAgentContext,
} from "../agent-context.js";

const studioSource = [
  "domain Studio {",
  "  state {",
  "    focusedNodeId: string | null = null",
  "  }",
  "  action focusNode(id: string) {",
  "    onceIntent {",
  "      patch focusedNodeId = id",
  "    }",
  "  }",
  "}",
].join("\n");

describe("readStudioAgentContext", () => {
  it("keeps Studio MEL source out of the model prompt while retaining digest context", () => {
    const ctx = readStudioAgentContext({
      studioMelDigest: "schema: Studio (hash)",
      recentTurns: [
        {
          turnId: "t1",
          userPrompt: "what is this?",
          assistantExcerpt: "Use inspectFocus.",
          toolCount: 1,
        },
      ],
      runtimeSignals: {
        selectedNodeChanged: true,
        currentFocusedNodeId: "state:todos",
        currentFocusedNodeKind: "state",
      },
      turnStartSnapshot: {
        worldId: "w1",
        schemaHash: "schema1",
        focus: { nodeId: "state:todos", kind: "state" },
        viewMode: "live",
        data: { todos: [] },
        computed: { todoCount: 0 },
      },
    });

    expect(ctx).toEqual({
      studioMelDigest: "schema: Studio (hash)",
      recentTurns: [
        {
          turnId: "t1",
          userPrompt: "what is this?",
          assistantExcerpt: "Use inspectFocus.",
          toolCount: 1,
        },
      ],
      runtimeSignals: {
        selectedNodeChanged: true,
        currentFocusedNodeId: "state:todos",
        currentFocusedNodeKind: "state",
      },
      turnStartSnapshot: {
        worldId: "w1",
        schemaHash: "schema1",
        focus: { nodeId: "state:todos", kind: "state" },
        viewMode: "live",
        data: { todos: [] },
        computed: { todoCount: 0 },
      },
    });
    expect(ctx).not.toHaveProperty("domainSummary");
    expect(ctx).not.toHaveProperty("diagnostics");
  });
});

describe("buildAgentSystemPrompt", () => {
  it("uses fine MEL instead of embedding full studio.mel", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext({
        studioMelDigest: "schema: Studio (hash)",
      }),
    );

    expect(prompt).toContain("You are Manifest Studio Agent.");
    expect(prompt).toContain("# How To Read Fine MEL");
    expect(prompt).toContain("use the host tool name exposed to you");
    expect(prompt).toContain("Domain actions are inputs to `dispatch`, not tool names");
    expect(prompt).toContain("# Manifesto Routing");
    expect(prompt).toContain("then call `explainLegality` for that action");
    expect(prompt).toContain("Use `inspectToolAffordances` for agent-tool catalog failures only");
    expect(prompt).toContain("# Fine MEL");
    expect(prompt).toContain("schema: Studio (hash)");
    expect(prompt).not.toContain("# Studio MEL Source");
    expect(prompt).not.toContain(`\`\`\`mel\n${studioSource}\n\`\`\``);
    expect(prompt).not.toContain("domain Studio {");
    expect(prompt).not.toContain("# Tools");
    expect(prompt).not.toContain("# Grounding Rules");
    expect(prompt).not.toContain("# Domain Summary");
    expect(prompt).not.toContain("compact schema summary plus live tools");
  });

  it("emits an optional fine MEL digest", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext({
        studioMelDigest: "schema: Studio (hash)\nstate:\n- focusedNodeId",
      }),
    );

    expect(prompt).toContain("# Fine MEL");
    expect(prompt).toContain("schema: Studio (hash)");
  });

  it("emits a focused-node change signal without focus values", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext({
        runtimeSignals: {
          selectedNodeChanged: true,
          currentFocusedNodeId: "state:todos",
          currentFocusedNodeKind: "state",
        },
      }),
    );

    expect(prompt).toContain("# Runtime Signals");
    expect(prompt).toContain("selected_node_changed: true");
    expect(prompt).toContain("inspectFocus before using the current selection");
    expect(prompt).not.toContain("current_focused_node_id");
    expect(prompt).not.toContain("state:todos");
  });

  it("emits a turn-start snapshot when provided", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext({
        turnStartSnapshot: {
          worldId: "w1",
          schemaHash: "schema1",
          focus: { nodeId: "state:todos", kind: "state" },
          viewMode: "live",
          data: { todos: [{ title: "Buy milk" }] },
          computed: { todoCount: 1 },
        },
      }),
    );

    expect(prompt).toContain("# Turn Start Snapshot");
    expect(prompt).toContain("Captured before the first model step");
    expect(prompt).toContain('"worldId": "w1"');
    expect(prompt).toContain('"schemaHash": "schema1"');
    expect(prompt).toContain('"todoCount": 1');
  });

  it("emits a single-turn continuity hint and points at inspectConversation for older context", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext({
        recentTurns: [
          {
            turnId: "t3",
            userPrompt: "why is this blocked?",
            assistantExcerpt: "clearDone is guarded.",
            toolCount: 2,
          },
        ],
      }),
    );

    expect(prompt).toContain("# Conversation continuity");
    expect(prompt).toContain("id=t3");
    expect(prompt).toContain("user: why is this blocked?");
    expect(prompt).toContain("you: clearDone is guarded.");
    // Active-retrieval guidance — agent must know it can search.
    expect(prompt).toContain("inspectConversation");
    expect(prompt).toContain("query");
    expect(prompt).toContain("beforeTurnId");
  });

  it("emits the tool-only marker when assistant excerpt is empty", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext({
        recentTurns: [
          {
            turnId: "t2",
            userPrompt: "what is focused?",
            assistantExcerpt: "",
            toolCount: 1,
          },
        ],
      }),
    );

    expect(prompt).toContain("you: (tool-only turn)");
  });

  it("does not embed snapshot prose or user-domain MEL", () => {
    const prompt = buildAgentSystemPrompt(
      readStudioAgentContext({}),
    );

    expect(prompt).not.toMatch(/^focus = /m);
    expect(prompt).not.toMatch(/^ui = /m);
    expect(prompt).not.toContain("Your current state (snapshot)");
    expect(prompt).not.toContain("domain Todo");
    expect(prompt).not.toContain("state { count: number = 0 }");
  });
});
