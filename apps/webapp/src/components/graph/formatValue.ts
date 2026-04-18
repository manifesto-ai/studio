/**
 * Short, glance-readable rendering of snapshot values for node cards.
 * Keep it dense — cards are 196×82, there isn't room for full JSON.
 */
export function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") {
    if (value.length === 0) return '""';
    const trimmed = value.length > 24 ? value.slice(0, 22) + "…" : value;
    return `"${trimmed}"`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const n = value.length;
    if (n === 0) return "[]";
    if (n === 1) return `[${formatValue(value[0])}]`;
    return `[${n} items]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    if (keys.length <= 2) {
      const parts = keys.map(
        (k) => `${k}: ${formatValue((value as Record<string, unknown>)[k])}`,
      );
      return `{ ${parts.join(", ")} }`;
    }
    return `{${keys.length} fields}`;
  }
  return String(value);
}

/**
 * Readable type projection for the node's declared type. Falls back to
 * a short signature when the raw type def is structural.
 */
export function formatType(typeDef: unknown): string {
  if (typeDef === null || typeDef === undefined) return "";
  if (typeof typeDef === "string") return typeDef;
  if (typeof typeDef === "object") {
    const t = typeDef as {
      readonly kind?: string;
      readonly type?: string;
      readonly element?: unknown;
      readonly value?: unknown;
      readonly name?: string;
      readonly types?: readonly unknown[];
    };
    switch (t.kind) {
      case "primitive":
        return t.type ?? "primitive";
      case "literal":
        return JSON.stringify(t.value);
      case "array":
        return `Array<${formatType(t.element)}>`;
      case "record":
        return "Record";
      case "ref":
        return t.name ?? "ref";
      case "object":
        return "object";
      case "union":
        if (t.types !== undefined && t.types.every(isLiteral)) {
          return t.types
            .map((x) => JSON.stringify((x as { value: unknown }).value))
            .join(" | ");
        }
        return "union";
    }
  }
  return "";
}

function isLiteral(t: unknown): boolean {
  return (
    typeof t === "object" &&
    t !== null &&
    (t as { kind?: string }).kind === "literal"
  );
}
