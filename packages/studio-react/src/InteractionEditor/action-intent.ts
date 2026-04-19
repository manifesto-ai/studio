import type { FormDescriptor } from "./field-descriptor.js";

export function toCreateIntentArg(
  descriptor: FormDescriptor | null,
  value: unknown,
): unknown {
  if (descriptor === null) return undefined;
  if (descriptor.kind !== "object" || descriptor.fields.length !== 1) {
    return value;
  }
  if (!isRecord(value)) return value;
  const [field] = descriptor.fields;
  return Object.hasOwn(value, field.name) ? value[field.name] : value;
}

export function createIntentArgsForValue(
  descriptor: FormDescriptor | null,
  value: unknown,
): readonly unknown[] {
  if (descriptor === null) return [];
  return [toCreateIntentArg(descriptor, value)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
