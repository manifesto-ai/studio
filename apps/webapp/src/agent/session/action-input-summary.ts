export type ActionInputSummary = {
  readonly paramHints: readonly string[];
  readonly inputHint: string | null;
};

export function summarizeActionInput(
  actionSpec: unknown,
  schema: unknown,
): ActionInputSummary {
  const action = asRecord(actionSpec);
  const paramNames = Array.isArray(action?.params)
    ? action.params.filter((param): param is string => typeof param === "string")
    : [];
  const inputType = action?.inputType;
  if (inputType === undefined) {
    return {
      paramHints: paramNames,
      inputHint: paramNames.length === 0 ? null : paramNames.join(", "),
    };
  }

  const input = summarizeType(inputType, schema);
  const inputRecord = asRecord(inputType);
  if (inputRecord?.kind === "object") {
    const fields = asRecord(inputRecord.fields);
    const paramHints = paramNames.map((name) => {
      const field = asRecord(fields?.[name]);
      const optional = field?.optional === true ? "?" : "";
      const type = field?.type;
      return `${name}${optional}: ${summarizeType(type, schema)}`;
    });
    return {
      paramHints,
      inputHint: paramHints.length === 0 ? input : paramHints.join(", "),
    };
  }

  if (paramNames.length === 1) {
    return {
      paramHints: [`${paramNames[0]}: ${input}`],
      inputHint: `${paramNames[0]}: ${input}`,
    };
  }
  return {
    paramHints: paramNames,
    inputHint: input,
  };
}

function summarizeType(
  typeDef: unknown,
  schema: unknown,
  seenRefs: ReadonlySet<string> = new Set(),
): string {
  const def = asRecord(typeDef);
  if (def === null) return "unknown";
  const kind = def?.kind;
  switch (kind) {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
