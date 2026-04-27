import { describe, expect, it } from "vitest";
import type { DomainModule } from "@manifesto-ai/studio-core";
import {
  compactValue,
  digestSchema,
  digestSnapshot,
  formatSchemaDigestMarkdown,
  readAnnotationDigest,
} from "../manifesto-digest.js";

const MODULE = {
  schema: {
    id: "Counter",
    hash: "schema-counter",
    state: {
      fields: { count: {}, label: {} },
      fieldTypes: {
        count: { kind: "primitive", type: "number" },
        label: { kind: "primitive", type: "string" },
      },
    },
    computed: {
      fields: { doubled: {} },
      fieldTypes: {
        doubled: { kind: "primitive", type: "number" },
      },
    },
    actions: {
      increment: {
        params: [],
        dispatchable: {},
      },
      rename: {
        params: ["label"],
        inputType: { kind: "primitive", type: "string" },
      },
    },
    types: {},
  },
  graph: {
    nodes: [{ id: "state:count" }, { id: "action:increment" }],
    edges: [{ from: "action:increment", to: "state:count" }],
  },
  annotations: {
    entries: {
      "domain:Counter": [
        {
          tag: "comment:grounding",
          payload: "Counter domain used for digest tests.",
        },
      ],
      "state_field:count": [
        {
          tag: "comment:grounding",
          payload: "Primary counter value.",
        },
        {
          tag: "agent:stale_when",
          payload: "increment dispatch succeeds.",
        },
      ],
      "action:increment": [
        {
          tag: "agent:recovery",
          payload: "If blocked, inspect availability first.",
        },
      ],
    },
  },
} as unknown as DomainModule;

describe("manifesto digest", () => {
  it("projects schema, signatures, and @meta annotations", () => {
    const digest = digestSchema(MODULE);

    expect(digest.schemaId).toBe("Counter");
    expect(digest.stateFields).toEqual(["count", "label"]);
    expect(digest.state[0]).toMatchObject({
      name: "count",
      type: "number",
      annotations: {
        grounding: ["Primary counter value."],
        staleWhen: ["increment dispatch succeeds."],
      },
    });
    expect(digest.actions.find((action) => action.name === "rename")).toMatchObject(
      {
        inputHint: "label: string",
      },
    );
    expect(
      digest.actions.find((action) => action.name === "increment")?.annotations
        ?.recovery,
    ).toEqual(["If blocked, inspect availability first."]);

    const markdown = formatSchemaDigestMarkdown(digest);
    expect(markdown).toContain("schema: Counter (schema-counter)");
    expect(markdown).toContain("grounding: Primary counter value.");
    expect(markdown).toContain("recovery: If blocked, inspect availability first.");
  });

  it("reads annotation payloads by local target key", () => {
    const annotation = readAnnotationDigest(MODULE, "state_field:count");

    expect(annotation).toMatchObject({
      targetKey: "state_field:count",
      grounding: ["Primary counter value."],
      staleWhen: ["increment dispatch succeeds."],
    });
  });

  it("compacts snapshots for model-facing tool results", () => {
    const output = digestSnapshot({
      data: {
        todos: Array.from({ length: 10 }, (_, index) => ({
          id: index,
          title: "x".repeat(300),
        })),
      },
      computed: { count: 10 },
    });

    expect(output.computed).toEqual({ count: 10 });
    expect(output.data).toMatchObject({
      todos: {
        kind: "array",
        length: 10,
        truncated: true,
      },
    });
  });

  it("summarizes deep leaves without dropping their shape", () => {
    expect(
      compactValue({ a: { b: { c: { d: { e: 1 } } } } }, { maxDepth: 3 }),
    ).toMatchObject({
      a: {
        b: {
          c: {
            kind: "object",
            keys: ["d"],
          },
        },
      },
    });
  });
});
