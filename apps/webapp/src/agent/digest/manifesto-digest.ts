import type { DomainModule } from "@manifesto-ai/studio-core";
import { summarizeActionInput } from "../session/action-input-summary.js";

export type AnnotationDigest = {
  readonly targetKey: string;
  readonly tags: Readonly<Record<string, readonly unknown[]>>;
  readonly grounding: readonly string[];
  readonly invariants: readonly string[];
  readonly recovery: readonly string[];
  readonly staleWhen: readonly string[];
  readonly examples: readonly string[];
};

export type SchemaTypeDigest = {
  readonly name: string;
  readonly annotations: AnnotationDigest | null;
};

export type SchemaFieldDigest = {
  readonly name: string;
  readonly type: string | null;
  readonly annotations: AnnotationDigest | null;
};

export type SchemaActionDigest = {
  readonly name: string;
  readonly params: readonly string[];
  readonly paramHints: readonly string[];
  readonly inputHint: string | null;
  readonly hasDispatchableGate: boolean;
  readonly description: string | null;
  readonly annotations: AnnotationDigest | null;
};

export type SchemaDigest = {
  readonly schemaId: string | null;
  readonly schemaHash: string;
  readonly annotations: AnnotationDigest | null;
  readonly types: readonly SchemaTypeDigest[];
  readonly stateFields: readonly string[];
  readonly computedFields: readonly string[];
  readonly state: readonly SchemaFieldDigest[];
  readonly computed: readonly SchemaFieldDigest[];
  readonly actions: readonly SchemaActionDigest[];
  readonly graph: {
    readonly nodeCount: number;
    readonly edgeCount: number;
  };
};

export type SnapshotDigest = {
  readonly data: unknown;
  readonly computed: unknown;
  readonly system?: unknown;
};

export type CompactValueOptions = {
  readonly maxDepth?: number;
  readonly maxArrayItems?: number;
  readonly maxObjectKeys?: number;
  readonly maxStringLength?: number;
  readonly leafObjectKeys?: number;
};

const DEFAULT_COMPACT_OPTIONS = {
  maxDepth: 4,
  maxArrayItems: 8,
  maxObjectKeys: 24,
  maxStringLength: 240,
  leafObjectKeys: 12,
} as const;

export function digestSchema(module: DomainModule): SchemaDigest {
  const schema = asRecord(module.schema);
  const state = asRecord(schema?.state);
  const computed = asRecord(schema?.computed);
  const actions = asRecord(schema?.actions);
  const stateFields = Object.keys(asRecord(state?.fields) ?? {}).sort();
  const computedFields = Object.keys(asRecord(computed?.fields) ?? {}).sort();

  return {
    schemaId: typeof schema?.id === "string" ? schema.id : null,
    schemaHash:
      typeof schema?.hash === "string" && schema.hash.trim() !== ""
        ? schema.hash
        : "(unknown)",
    annotations: readAnnotationDigest(module, `domain:${readDomainName(schema)}`),
    types: Object.keys(asRecord(schema?.types) ?? {})
      .sort()
      .map((name) => ({
        name,
        annotations: readAnnotationDigest(module, `type:${name}`),
      })),
    stateFields,
    computedFields,
    state: stateFields.map((name) => ({
      name,
      type: readFieldType(name, state, schema),
      annotations: readAnnotationDigest(module, `state_field:${name}`),
    })),
    computed: computedFields.map((name) => ({
      name,
      type: readFieldType(name, computed, schema),
      annotations: readAnnotationDigest(module, `computed:${name}`),
    })),
    actions: Object.entries(actions ?? {})
      .map(([name, value]) => digestAction(module, name, value, schema))
      .sort((a, b) => a.name.localeCompare(b.name)),
    graph: {
      nodeCount: module.graph?.nodes?.length ?? 0,
      edgeCount: module.graph?.edges?.length ?? 0,
    },
  };
}

export function digestSnapshot(
  snapshot: unknown,
  options?: CompactValueOptions,
): SnapshotDigest {
  const snap = asRecord(snapshot);
  const output: {
    data: unknown;
    computed: unknown;
    system?: unknown;
  } = {
    data: compactValue(snap?.data, options),
    computed: compactValue(snap?.computed, options),
  };
  if (snap !== null && "system" in snap) {
    output.system = compactValue(snap.system, options);
  }
  return output;
}

export function compactValue(
  value: unknown,
  options?: CompactValueOptions,
): unknown {
  return compactValueAt(value, 0, {
    ...DEFAULT_COMPACT_OPTIONS,
    ...options,
  });
}

export function readAnnotationDigest(
  module: DomainModule | null,
  targetKey: string,
): AnnotationDigest | null {
  const entries = readAnnotationEntries(module, targetKey);
  if (entries.length === 0) return null;

  const tags: Record<string, unknown[]> = {};
  for (const entry of entries) {
    if (typeof entry.tag !== "string" || entry.tag.trim() === "") continue;
    const tag = entry.tag;
    const value =
      "payload" in entry ? compactValue(entry.payload, { maxDepth: 2 }) : true;
    tags[tag] = [...(tags[tag] ?? []), value];
  }

  return {
    targetKey,
    tags,
    grounding: readTagText(entries, "comment:grounding"),
    invariants: readTagText(entries, "agent:invariant"),
    recovery: readTagText(entries, "agent:recovery"),
    staleWhen: readTagText(entries, "agent:stale_when"),
    examples: readTagText(entries, "agent:example"),
  };
}

export function formatSchemaDigestMarkdown(digest: SchemaDigest): string {
  const lines = [
    `schema: ${digest.schemaId ?? "(anonymous)"} (${digest.schemaHash})`,
    `graph: ${digest.graph.nodeCount} nodes, ${digest.graph.edgeCount} edges`,
  ];
  pushAnnotationLines(lines, digest.annotations, "");

  if (digest.types.length > 0) {
    lines.push("", "types:");
    for (const type of digest.types) {
      lines.push(`- ${type.name}`);
      pushAnnotationLines(lines, type.annotations, "  ");
    }
  }

  if (digest.state.length > 0) {
    lines.push("", "state:");
    for (const field of digest.state) {
      lines.push(`- ${field.name}: ${field.type ?? "unknown"}`);
      pushAnnotationLines(lines, field.annotations, "  ");
    }
  }

  if (digest.computed.length > 0) {
    lines.push("", "computed:");
    for (const field of digest.computed) {
      lines.push(`- ${field.name}: ${field.type ?? "unknown"}`);
      pushAnnotationLines(lines, field.annotations, "  ");
    }
  }

  if (digest.actions.length > 0) {
    lines.push("", "actions:");
    for (const action of digest.actions) {
      const input = action.inputHint === null ? "no input" : action.inputHint;
      const gate = action.hasDispatchableGate ? " gated" : "";
      lines.push(`- ${action.name}(${input})${gate}`);
      if (action.description !== null) {
        lines.push(`  description: ${action.description}`);
      }
      pushAnnotationLines(lines, action.annotations, "  ");
    }
  }

  return lines.join("\n");
}

function digestAction(
  module: DomainModule,
  name: string,
  value: unknown,
  schema: unknown,
): SchemaActionDigest {
  const spec = asRecord(value);
  const input = summarizeActionInput(value, schema);
  return {
    name,
    params: Array.isArray(spec?.params)
      ? spec.params.filter((param): param is string => typeof param === "string")
      : [],
    paramHints: input.paramHints,
    inputHint: input.inputHint,
    hasDispatchableGate: spec?.dispatchable !== undefined,
    description:
      typeof spec?.description === "string" && spec.description.trim() !== ""
        ? spec.description.trim()
        : null,
    annotations: readAnnotationDigest(module, `action:${name}`),
  };
}

function readFieldType(
  name: string,
  section: Record<string, unknown> | null,
  schema: unknown,
): string | null {
  const fields = asRecord(section?.fields);
  const fieldTypes = asRecord(section?.fieldTypes);
  const spec = asRecord(fields?.[name]);
  return firstTypeSummary(
    fieldTypes?.[name],
    spec?.type,
    spec?.definition,
    spec?.valueType,
    spec,
    schema,
  );
}

function firstTypeSummary(...values: readonly unknown[]): string | null {
  const schema = values[values.length - 1];
  for (const value of values.slice(0, -1)) {
    if (value === undefined || value === null) continue;
    const summary = summarizeType(value, schema);
    if (summary !== "unknown") return summary;
  }
  return null;
}

function summarizeType(
  typeDef: unknown,
  schema: unknown,
  seenRefs: ReadonlySet<string> = new Set(),
): string {
  if (typeof typeDef === "string") return typeDef;
  const def = asRecord(typeDef);
  if (def === null) return "unknown";
  switch (def.kind) {
    case "primitive":
      return typeof def.type === "string" ? def.type : "unknown";
    case "literal":
      return JSON.stringify(def.value);
    case "array":
      return `${summarizeType(def.element, schema, seenRefs)}[]`;
    case "record":
      return `Record<${summarizeType(def.key, schema, seenRefs)}, ${summarizeType(def.value, schema, seenRefs)}>`;
    case "object": {
      const fields = Object.entries(asRecord(def.fields) ?? {})
        .slice(0, 12)
        .map(([name, value]) => {
          const field = asRecord(value);
          const optional = field?.optional === true ? "?" : "";
          return `${name}${optional}: ${summarizeType(field?.type, schema, seenRefs)}`;
        });
      const suffix =
        Object.keys(asRecord(def.fields) ?? {}).length > fields.length
          ? ", ..."
          : "";
      return `{ ${fields.join(", ")}${suffix} }`;
    }
    case "union": {
      const types = Array.isArray(def.types) ? def.types : [];
      if (types.length === 0) return "unknown";
      return types
        .slice(0, 12)
        .map((entry) => summarizeType(entry, schema, seenRefs))
        .join(" | ");
    }
    case "ref": {
      if (typeof def.name !== "string") return "unknown";
      if (seenRefs.has(def.name)) return def.name;
      const typeSpec = asRecord(asRecord(schema)?.types)?.[def.name];
      const definition = asRecord(typeSpec)?.definition;
      if (definition === undefined) return def.name;
      const nextSeen = new Set(seenRefs);
      nextSeen.add(def.name);
      return summarizeType(definition, schema, nextSeen);
    }
    default:
      return "unknown";
  }
}

function compactValueAt(
  value: unknown,
  depth: number,
  options: Required<CompactValueOptions>,
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > options.maxStringLength
      ? `${value.slice(0, options.maxStringLength - 3)}...`
      : value;
  }
  if (value === undefined) return null;
  if (depth >= options.maxDepth) return summarizeLeaf(value, options);
  if (Array.isArray(value)) {
    const sample = value
      .slice(0, options.maxArrayItems)
      .map((item) => compactValueAt(item, depth + 1, options));
    return value.length > sample.length
      ? { kind: "array", length: value.length, sample, truncated: true }
      : sample;
  }
  const record = asRecord(value);
  if (record === null) return String(value);
  const entries = Object.entries(record);
  const output: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, options.maxObjectKeys)) {
    output[key] = compactValueAt(item, depth + 1, options);
  }
  if (entries.length > options.maxObjectKeys) {
    output.__truncated = `${entries.length - options.maxObjectKeys} more keys`;
  }
  return output;
}

function summarizeLeaf(
  value: unknown,
  options: Required<CompactValueOptions>,
): unknown {
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  const record = asRecord(value);
  if (record !== null) {
    return {
      kind: "object",
      keys: Object.keys(record).slice(0, options.leafObjectKeys),
    };
  }
  return String(value);
}

function readAnnotationEntries(
  module: DomainModule | null,
  targetKey: string,
): readonly AnnotationLike[] {
  const annotations = asRecord((module as { readonly annotations?: unknown } | null)
    ?.annotations);
  const entries = asRecord(annotations?.entries);
  const raw = entries?.[targetKey];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const record = asRecord(entry);
    return typeof record?.tag === "string"
      ? [{ tag: record.tag, payload: record.payload }]
      : [];
  });
}

function readTagText(
  entries: readonly AnnotationLike[],
  tag: string,
): readonly string[] {
  return entries
    .filter((entry) => entry.tag === tag)
    .flatMap((entry) => payloadToText(entry.payload))
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function payloadToText(payload: unknown): readonly string[] {
  if (payload === undefined || payload === null) return [];
  if (typeof payload === "string") return [payload];
  if (Array.isArray(payload)) return payload.flatMap(payloadToText);
  if (
    typeof payload === "number" ||
    typeof payload === "boolean" ||
    typeof payload === "bigint"
  ) {
    return [String(payload)];
  }
  try {
    return [JSON.stringify(payload)];
  } catch {
    return [String(payload)];
  }
}

function pushAnnotationLines(
  lines: string[],
  annotations: AnnotationDigest | null,
  prefix: string,
): void {
  if (annotations === null) return;
  pushTextLine(lines, prefix, "grounding", annotations.grounding);
  pushTextLine(lines, prefix, "invariant", annotations.invariants);
  pushTextLine(lines, prefix, "recovery", annotations.recovery);
  pushTextLine(lines, prefix, "stale_when", annotations.staleWhen);
  pushTextLine(lines, prefix, "example", annotations.examples);
}

function pushTextLine(
  lines: string[],
  prefix: string,
  label: string,
  values: readonly string[],
): void {
  if (values.length === 0) return;
  lines.push(`${prefix}${label}: ${values.join(" / ")}`);
}

function readDomainName(schema: Record<string, unknown> | null): string {
  return typeof schema?.id === "string" && schema.id.trim() !== ""
    ? schema.id
    : "*";
}

type AnnotationLike = {
  readonly tag: string;
  readonly payload?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
