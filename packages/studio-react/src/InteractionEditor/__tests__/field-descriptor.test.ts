import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import type { DomainSchema, FieldSpec, TypeDefinition } from "@manifesto-ai/studio-core";
import {
  createInitialFormValue,
  defaultValueFor,
  descriptorForAction,
  fromFieldSpec,
  fromTypeDefinition,
  type FormDescriptor,
} from "../field-descriptor.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const todoSource = readFileSync(
  join(
    repoRoot,
    "packages",
    "studio-adapter-headless",
    "src",
    "__tests__",
    "fixtures",
    "todo.mel",
  ),
  "utf8",
);

async function buildTodoSchema(): Promise<DomainSchema> {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: todoSource });
  core.attach(adapter);
  const res = await core.build();
  if (res.kind !== "ok") throw new Error("build failed");
  const module = core.getModule();
  if (module === null) throw new Error("module null");
  return module.schema;
}

const EMPTY_SCHEMA = {
  id: "t",
  version: "0.0.0",
  hash: "h",
  types: {},
  state: { fields: {} },
  computed: { fields: {} },
  actions: {},
} as const satisfies DomainSchema;

describe("fromFieldSpec", () => {
  it("maps primitive string with required flag", () => {
    const d = fromFieldSpec({ type: "string", required: true });
    expect(d.kind).toBe("string");
    expect(d.required).toBe(true);
  });

  it("maps enum FieldType to enum descriptor options", () => {
    const d = fromFieldSpec({
      type: { enum: ["all", "active", "completed"] },
      required: true,
    });
    expect(d.kind).toBe("enum");
    if (d.kind === "enum") {
      expect(d.options.map((o) => o.value)).toEqual([
        "all",
        "active",
        "completed",
      ]);
    }
  });

  it("maps object with nested fields", () => {
    const spec: FieldSpec = {
      type: "object",
      required: true,
      fields: {
        title: { type: "string", required: true },
        done: { type: "boolean", required: false },
      },
    };
    const d = fromFieldSpec(spec);
    expect(d.kind).toBe("object");
    if (d.kind === "object") {
      expect(d.fields.map((f) => f.name).sort()).toEqual(["done", "title"]);
      const title = d.fields.find((f) => f.name === "title")!;
      expect(title.descriptor.kind).toBe("string");
    }
  });

  it("maps array with item spec", () => {
    const d = fromFieldSpec({
      type: "array",
      required: false,
      items: { type: "number", required: true },
    });
    expect(d.kind).toBe("array");
    if (d.kind === "array") expect(d.item.kind).toBe("number");
  });

  it("falls through to json for array without items", () => {
    const d = fromFieldSpec({ type: "array", required: true });
    if (d.kind !== "array") throw new Error("expected array");
    expect(d.item.kind).toBe("json");
  });
});

describe("fromTypeDefinition", () => {
  it("maps primitive types", () => {
    const d = fromTypeDefinition(
      { kind: "primitive", type: "string" },
      EMPTY_SCHEMA,
      true,
    );
    expect(d.kind).toBe("string");
  });

  it("maps union of literals to enum", () => {
    const def: TypeDefinition = {
      kind: "union",
      types: [
        { kind: "literal", value: "all" },
        { kind: "literal", value: "active" },
        { kind: "literal", value: "completed" },
      ],
    };
    const d = fromTypeDefinition(def, EMPTY_SCHEMA, true);
    expect(d.kind).toBe("enum");
    if (d.kind === "enum") {
      expect(d.options.map((o) => o.value)).toEqual([
        "all",
        "active",
        "completed",
      ]);
    }
  });

  it("falls through for mixed unions", () => {
    const def: TypeDefinition = {
      kind: "union",
      types: [
        { kind: "primitive", type: "string" },
        { kind: "primitive", type: "number" },
      ],
    };
    const d = fromTypeDefinition(def, EMPTY_SCHEMA, true);
    expect(d.kind).toBe("json");
  });

  it("resolves ref via schema.types", () => {
    const schema: DomainSchema = {
      ...EMPTY_SCHEMA,
      types: {
        Name: {
          name: "Name",
          definition: { kind: "primitive", type: "string" },
        },
      },
    };
    const d = fromTypeDefinition({ kind: "ref", name: "Name" }, schema, true);
    expect(d.kind).toBe("string");
  });

  it("guards against recursive refs", () => {
    const schema: DomainSchema = {
      ...EMPTY_SCHEMA,
      types: {
        Self: {
          name: "Self",
          definition: { kind: "ref", name: "Self" },
        },
      },
    };
    const d = fromTypeDefinition({ kind: "ref", name: "Self" }, schema, true);
    expect(d.kind).toBe("json");
  });

  it("respects optional flag on object fields", () => {
    const def: TypeDefinition = {
      kind: "object",
      fields: {
        a: { type: { kind: "primitive", type: "string" }, optional: false },
        b: { type: { kind: "primitive", type: "string" }, optional: true },
      },
    };
    const d = fromTypeDefinition(def, EMPTY_SCHEMA, true);
    if (d.kind !== "object") throw new Error("expected object");
    const a = d.fields.find((f) => f.name === "a")!;
    const b = d.fields.find((f) => f.name === "b")!;
    expect(a.descriptor.required).toBe(true);
    expect(b.descriptor.required).toBe(false);
  });
});

describe("descriptorForAction (todo.mel)", () => {
  it("returns a descriptor for each action that takes input", async () => {
    const schema = await buildTodoSchema();
    const actionNames = Object.keys(schema.actions);
    expect(actionNames).toEqual(
      expect.arrayContaining([
        "addTodo",
        "toggleTodo",
        "removeTodo",
        "setFilter",
      ]),
    );
    for (const name of actionNames) {
      const desc = descriptorForAction(schema, name);
      // clearCompleted takes no input -> null is allowed.
      if (name === "clearCompleted") {
        expect(desc).toBeNull();
        continue;
      }
      expect(desc).not.toBeNull();
    }
  });

  it("addTodo input has a `title: string` primitive", async () => {
    const schema = await buildTodoSchema();
    const d = descriptorForAction(schema, "addTodo");
    expect(d).not.toBeNull();
    if (d === null) return;
    expect(d.kind).toBe("object");
    if (d.kind !== "object") return;
    const title = d.fields.find((f) => f.name === "title");
    expect(title).toBeDefined();
    expect(title?.descriptor.kind).toBe("string");
  });

  it("setFilter input has an enum of the three filter modes", async () => {
    const schema = await buildTodoSchema();
    const d = descriptorForAction(schema, "setFilter");
    expect(d).not.toBeNull();
    if (d === null || d.kind !== "object") return;
    const filter = d.fields.find((f) => f.name === "newFilter");
    expect(filter).toBeDefined();
    if (filter === undefined) return;
    expect(filter.descriptor.kind).toBe("enum");
    if (filter.descriptor.kind === "enum") {
      const values = filter.descriptor.options.map((o) => o.value).sort();
      expect(values).toEqual(["active", "all", "completed"]);
    }
  });
});

describe("defaultValueFor", () => {
  it("seeds primitives by kind", () => {
    expect(defaultValueFor({ kind: "string", required: true })).toBe("");
    expect(defaultValueFor({ kind: "number", required: true })).toBe(0);
    expect(defaultValueFor({ kind: "boolean", required: true })).toBe(false);
    expect(defaultValueFor({ kind: "null", required: true })).toBe(null);
  });

  it("seeds enum with first option", () => {
    const d: FormDescriptor = {
      kind: "enum",
      required: true,
      options: [
        { value: "a", label: "a" },
        { value: "b", label: "b" },
      ],
    };
    expect(defaultValueFor(d)).toBe("a");
  });

  it("seeds object recursively", () => {
    const d: FormDescriptor = {
      kind: "object",
      required: true,
      fields: [
        { name: "title", descriptor: { kind: "string", required: true } },
        { name: "done", descriptor: { kind: "boolean", required: false } },
      ],
    };
    expect(defaultValueFor(d)).toEqual({ title: "", done: false });
  });

  it("prefers explicit defaultValue when present", () => {
    const d: FormDescriptor = {
      kind: "string",
      required: true,
      defaultValue: "hello",
    };
    expect(defaultValueFor(d)).toBe("hello");
  });
});

describe("createInitialFormValue", () => {
  it("omits optional object fields by default", () => {
    const d: FormDescriptor = {
      kind: "object",
      required: true,
      fields: [
        { name: "title", descriptor: { kind: "string", required: true } },
        { name: "note", descriptor: { kind: "string", required: false } },
      ],
    };
    expect(createInitialFormValue(d)).toEqual({ title: "" });
  });

  it("keeps nested required fields while omitting nested optional fields", () => {
    const d: FormDescriptor = {
      kind: "object",
      required: true,
      fields: [
        {
          name: "payload",
          descriptor: {
            kind: "object",
            required: true,
            fields: [
              { name: "title", descriptor: { kind: "string", required: true } },
              { name: "note", descriptor: { kind: "string", required: false } },
            ],
          },
        },
      ],
    };
    expect(createInitialFormValue(d)).toEqual({ payload: { title: "" } });
  });
});
