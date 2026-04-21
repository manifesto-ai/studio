/**
 * FormDescriptor — the form-friendly projection of a compiler `FieldSpec`
 * or `TypeDefinition`. The InteractionEditor renders forms off descriptors
 * rather than the raw compiler types because (a) compiler types are more
 * permissive than we render, and (b) we want one place to decide how
 * "unsupported" shapes fall through to a raw-JSON escape hatch (P1-OQ-6).
 */
import type {
  ActionSpec,
  DomainSchema,
  FieldSpec,
  FieldType,
  TypeDefinition,
} from "@manifesto-ai/studio-core";

export type EnumOptionValue = string | number | boolean | null;

export type EnumOption = {
  readonly value: EnumOptionValue;
  readonly label: string;
};

export type FormDescriptorCommon = {
  readonly required: boolean;
  readonly description?: string;
  readonly label?: string;
  readonly defaultValue?: unknown;
};

export type PrimitiveKind = "string" | "number" | "boolean" | "null";

export type PrimitiveDescriptor = FormDescriptorCommon & {
  readonly kind: PrimitiveKind;
};

export type EnumDescriptor = FormDescriptorCommon & {
  readonly kind: "enum";
  readonly options: readonly EnumOption[];
};

export type ObjectField = {
  readonly name: string;
  readonly descriptor: FormDescriptor;
};

export type ObjectDescriptor = FormDescriptorCommon & {
  readonly kind: "object";
  readonly fields: readonly ObjectField[];
};

export type ArrayDescriptor = FormDescriptorCommon & {
  readonly kind: "array";
  readonly item: FormDescriptor;
};

export type RecordDescriptor = FormDescriptorCommon & {
  readonly kind: "record";
  /** Always `kind: "string"` for now — MEL record keys are strings. */
  readonly key: PrimitiveDescriptor;
  readonly value: FormDescriptor;
};

export type JsonDescriptor = FormDescriptorCommon & {
  readonly kind: "json";
  /** Why this field fell through to raw JSON. Surfaced to users. */
  readonly reason: string;
};

export type FormDescriptor =
  | PrimitiveDescriptor
  | EnumDescriptor
  | ObjectDescriptor
  | ArrayDescriptor
  | RecordDescriptor
  | JsonDescriptor;

/**
 * Resolve the input descriptor for a named action from a compiled
 * DomainSchema. Prefers `inputType` (v0.3.3 TypeDefinition) when present
 * because it carries richer union/literal/ref information; falls back to
 * the legacy `input: FieldSpec`. Returns `null` when the action takes no
 * input at all.
 */
export function descriptorForAction(
  schema: DomainSchema,
  actionName: string,
): FormDescriptor | null {
  const action = schema.actions[actionName];
  if (action === undefined) return null;
  return descriptorForActionSpec(action, schema);
}

export function descriptorForActionSpec(
  action: ActionSpec,
  schema: DomainSchema,
): FormDescriptor | null {
  if (action.inputType !== undefined) {
    return fromTypeDefinition(action.inputType, schema, true);
  }
  if (action.input !== undefined) {
    return fromFieldSpec(action.input);
  }
  return null;
}

/**
 * Build a descriptor tree from a legacy `FieldSpec`. Shapes not supported
 * in the generated form fall through to `kind: "json"` so the user can
 * still drive the action via raw JSON.
 */
export function fromFieldSpec(spec: FieldSpec): FormDescriptor {
  const base: FormDescriptorCommon = {
    required: spec.required,
    description: spec.description,
    defaultValue: spec.default,
  };

  return shapeFromFieldType(spec.type, spec, base);
}

function shapeFromFieldType(
  type: FieldType,
  spec: FieldSpec,
  base: FormDescriptorCommon,
): FormDescriptor {
  if (typeof type === "object" && "enum" in type) {
    const options = type.enum
      .filter(isEnumValue)
      .map<EnumOption>((v) => ({ value: v, label: stringifyEnum(v) }));
    return { ...base, kind: "enum", options };
  }

  switch (type) {
    case "string":
    case "number":
    case "boolean":
    case "null":
      return { ...base, kind: type };
    case "object": {
      const src = spec.fields ?? {};
      const fields: ObjectField[] = Object.entries(src).map(([name, child]) => ({
        name,
        descriptor: fromFieldSpec(child),
      }));
      return { ...base, kind: "object", fields };
    }
    case "array": {
      const item: FormDescriptor =
        spec.items !== undefined
          ? fromFieldSpec(spec.items)
          : {
              kind: "json",
              reason: "array items have no FieldSpec",
              required: true,
            };
      return { ...base, kind: "array", item };
    }
    default:
      return {
        ...base,
        kind: "json",
        reason: `unsupported FieldType: ${String(type)}`,
      };
  }
}

/**
 * Build a descriptor tree from a v0.3.3 `TypeDefinition`, optionally
 * resolving `ref` nodes against `schema.types`. The `required` flag is
 * threaded from the caller because `TypeDefinition` itself doesn't carry
 * nullability — it's on the containing `object.fields[name].optional`.
 */
export function fromTypeDefinition(
  def: TypeDefinition,
  schema: DomainSchema,
  required: boolean,
  seenRefs: ReadonlySet<string> = new Set(),
): FormDescriptor {
  const base: FormDescriptorCommon = { required };

  switch (def.kind) {
    case "primitive": {
      const kind = primitiveKindOf(def.type);
      if (kind === null) {
        return {
          ...base,
          kind: "json",
          reason: `unsupported primitive: ${def.type}`,
        };
      }
      return { ...base, kind };
    }
    case "literal":
      // A bare literal collapses to a single-option enum so the UI still
      // shows the fixed value rather than a free-text field.
      return {
        ...base,
        kind: "enum",
        options: [{ value: def.value, label: stringifyEnum(def.value) }],
      };
    case "union": {
      // Nullable pattern: `T | null` collapses to `T`'s descriptor so
      // users get a real input for the value type instead of a JSON
      // textarea. Null emptiness is already conveyed through the form
      // (empty string stays "", optional fields stay unset). We treat
      // both `{kind:"literal", value:null}` and `{kind:"primitive",
      // type:"null"}` as the null branch.
      const nonNull = def.types.filter((t) => !isNullTypeDef(t));
      if (nonNull.length === 1 && nonNull.length < def.types.length) {
        return fromTypeDefinition(nonNull[0], schema, required, seenRefs);
      }

      // Union of literals → enum. Mixed unions (literal + non-literal or
      // non-literal only) fall through to JSON — the form generator can't
      // present a meaningful control for "string or boolean".
      const allLiteral = def.types.every((t) => t.kind === "literal");
      if (allLiteral) {
        const options = def.types
          .flatMap((t) => (t.kind === "literal" ? [t.value] : []))
          .filter(isEnumValue)
          .map<EnumOption>((v) => ({ value: v, label: stringifyEnum(v) }));
        return { ...base, kind: "enum", options };
      }
      return {
        ...base,
        kind: "json",
        reason: "union of non-literal types — use raw JSON",
      };
    }
    case "array":
      return {
        ...base,
        kind: "array",
        item: fromTypeDefinition(def.element, schema, true, seenRefs),
      };
    case "object": {
      const fields: ObjectField[] = Object.entries(def.fields).map(
        ([name, fieldDef]) => ({
          name,
          descriptor: fromTypeDefinition(
            fieldDef.type,
            schema,
            !fieldDef.optional,
            seenRefs,
          ),
        }),
      );
      return { ...base, kind: "object", fields };
    }
    case "record": {
      const keyDescriptor = fromTypeDefinition(
        def.key,
        schema,
        true,
        seenRefs,
      );
      const valueDescriptor = fromTypeDefinition(
        def.value,
        schema,
        true,
        seenRefs,
      );
      if (keyDescriptor.kind !== "string") {
        return {
          ...base,
          kind: "json",
          reason: "record keys must be string",
        };
      }
      return {
        ...base,
        kind: "record",
        key: keyDescriptor,
        value: valueDescriptor,
      };
    }
    case "ref": {
      if (seenRefs.has(def.name)) {
        return {
          ...base,
          kind: "json",
          reason: `recursive ref: ${def.name}`,
        };
      }
      const target = schema.types[def.name];
      if (target === undefined) {
        return {
          ...base,
          kind: "json",
          reason: `unknown type: ${def.name}`,
        };
      }
      const nextSeen = new Set(seenRefs);
      nextSeen.add(def.name);
      return fromTypeDefinition(target.definition, schema, required, nextSeen);
    }
  }
}

/**
 * Build a sensible "empty" value for a descriptor, respecting
 * defaultValue. Used to seed form state when the user first selects an
 * action.
 */
export function defaultValueFor(descriptor: FormDescriptor): unknown {
  if (descriptor.defaultValue !== undefined) return descriptor.defaultValue;
  switch (descriptor.kind) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "enum":
      return descriptor.options[0]?.value;
    case "array":
      return [];
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const f of descriptor.fields) {
        obj[f.name] = defaultValueFor(f.descriptor);
      }
      return obj;
    }
    case "record":
      return {};
    case "json":
      return null;
  }
}

export function createInitialFormValue(
  descriptor: FormDescriptor,
  options: { readonly sparseOptional?: boolean } = {},
): unknown {
  const { sparseOptional = true } = options;
  if (descriptor.defaultValue !== undefined) return descriptor.defaultValue;
  switch (descriptor.kind) {
    case "string":
    case "number":
    case "boolean":
    case "null":
    case "enum":
    case "array":
    case "record":
    case "json":
      return defaultValueFor(descriptor);
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const field of descriptor.fields) {
        if (sparseOptional && !field.descriptor.required) continue;
        obj[field.name] = createInitialFormValue(field.descriptor, options);
      }
      return obj;
    }
  }
}

function isNullTypeDef(t: TypeDefinition): boolean {
  if (t.kind === "literal" && t.value === null) return true;
  if (t.kind === "primitive" && t.type === "null") return true;
  return false;
}

function primitiveKindOf(type: string): PrimitiveKind | null {
  switch (type) {
    case "string":
    case "number":
    case "boolean":
    case "null":
      return type;
    default:
      return null;
  }
}

function isEnumValue(v: unknown): v is EnumOptionValue {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    v === null
  );
}

function stringifyEnum(v: EnumOptionValue): string {
  if (v === null) return "null";
  return String(v);
}
