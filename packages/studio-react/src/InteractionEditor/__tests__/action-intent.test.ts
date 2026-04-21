import { describe, expect, it } from "vitest";
import { createIntentArgsForValue, toCreateIntentArg } from "../action-intent.js";
import type { FormDescriptor } from "../field-descriptor.js";

describe("action-intent helpers", () => {
  it("omits args for no-input actions", () => {
    expect(createIntentArgsForValue(null, {})).toEqual([]);
  });

  it("unwraps single-field action objects before createIntent", () => {
    const descriptor: FormDescriptor = {
      kind: "object",
      required: true,
      fields: [
        {
          name: "payload",
          descriptor: {
            kind: "object",
            required: true,
            fields: [
              {
                name: "title",
                descriptor: { kind: "string", required: true },
              },
            ],
          },
        },
      ],
    };

    expect(toCreateIntentArg(descriptor, { payload: { title: "hello" } })).toEqual({
      title: "hello",
    });
    expect(createIntentArgsForValue(descriptor, { payload: { title: "hello" } })).toEqual(
      [{ title: "hello" }],
    );
  });

  it("keeps multi-field action objects intact", () => {
    const descriptor: FormDescriptor = {
      kind: "object",
      required: true,
      fields: [
        {
          name: "id",
          descriptor: { kind: "string", required: true },
        },
        {
          name: "enabled",
          descriptor: { kind: "boolean", required: true },
        },
      ],
    };

    expect(
      toCreateIntentArg(descriptor, { id: "todo-1", enabled: true }),
    ).toEqual({ id: "todo-1", enabled: true });
  });
});
