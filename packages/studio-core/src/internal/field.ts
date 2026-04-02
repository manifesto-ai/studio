import type { FieldSpec } from "@manifesto-ai/core";

export type FlattenedField = {
  path: string;
  field: FieldSpec;
  isLeaf: boolean;
};

export function flattenFieldSpec(
  fields: Record<string, FieldSpec>,
  prefix = ""
): FlattenedField[] {
  const entries: FlattenedField[] = [];

  for (const [name, spec] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const hasNestedFields = Boolean(spec.fields && Object.keys(spec.fields).length > 0);
    entries.push({ path, field: spec, isLeaf: !hasNestedFields });

    if (spec.fields) {
      entries.push(...flattenFieldSpec(spec.fields, path));
    }
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

