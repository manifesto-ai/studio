import type { FormDescriptor, ObjectDescriptor, ObjectField, PrimitiveDescriptor } from "../field-descriptor.js";

/**
 * Smart-fill heuristics — "stop making users type derivable junk".
 *
 * For fields whose value can be produced deterministically from the
 * current moment or from a sibling field (uuid, ISO timestamps,
 * `fooTimestamp` alongside `fooDate`, entire `ClockStamp` snapshots),
 * the form renders a small `+ ...` hint button that fills in the
 * right value with one click. No typed-annotation required on the
 * MEL side; we read the field label.
 *
 * Kept conservative — only fires on very obvious naming patterns.
 * Users can still type freely, so a false negative just looks like
 * a missing convenience, not a bug.
 */

export type FillHint = {
  /** Short noun shown on the button: "+ uuid", "+ now", "+ from dueDate". */
  readonly label: string;
  /** Produces the value to write into the field. Pass the full form
   *  value so sibling-field hints can read their source. */
  readonly compute: (formValue: unknown) => unknown;
};

/**
 * Primitive-leaf hints. `labelPath` is the chain of labels / keys
 * leading to this field from the form root; the head is the deepest
 * (i.e. `[..., "dueDate"]`). `formValue` is the whole form so sibling
 * references like dueDate → dueDateTimestamp work.
 */
export function hintForPrimitive(
  descriptor: PrimitiveDescriptor,
  labelPath: readonly (string | number)[],
  formValue: unknown,
): FillHint | null {
  const tail = labelPath[labelPath.length - 1];
  const name = typeof tail === "string" ? tail : String(tail ?? "");
  const lower = name.toLowerCase();

  if (descriptor.kind === "string") {
    // id / ID fields that aren't *ref* style (those use the suggestion
    // dropdown). Only fire for plain `id` / `*Id` when no existing
    // dropdown source would return suggestions anyway.
    if (lower === "id" || lower.endsWith("id")) {
      return {
        label: "+ uuid",
        compute: () => generateUuid(),
      };
    }
    // ISO timestamp-looking string fields (createdAt, updatedAt, now).
    if (
      lower === "now" ||
      lower.endsWith("at") ||
      lower.endsWith("date")
    ) {
      return {
        label: "+ now",
        compute: () => new Date().toISOString(),
      };
    }
    // Timezone names — fill with the user's current tz.
    if (lower === "timezone" || lower === "tz") {
      return {
        label: "+ local",
        compute: () =>
          Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      };
    }
  }

  if (descriptor.kind === "number") {
    // Timestamp milliseconds — try a sibling `*Date` / `*At` field first;
    // fall back to Date.now().
    if (
      lower.endsWith("timestamp") ||
      lower.endsWith("ts") ||
      lower.endsWith("ms")
    ) {
      const siblingIsoLabel = guessSiblingDateLabel(name);
      return {
        label: siblingIsoLabel ? `+ from ${siblingIsoLabel}` : "+ now ms",
        compute: (form) => {
          if (siblingIsoLabel !== null) {
            const sibling = readSibling(form, labelPath, siblingIsoLabel);
            if (typeof sibling === "string" && sibling.length > 0) {
              const parsed = Date.parse(sibling);
              if (Number.isFinite(parsed)) return parsed;
            }
          }
          return Date.now();
        },
      };
    }
  }

  return null;
}

/**
 * Whole-object fill. Invoked from `ObjectField` when the user clicks
 * `+ fill all now` on an object header whose children look like a
 * time-snapshot (≥ 3 fields match the primitive hint heuristic).
 * Generates a fresh value for every recognisable child field in one
 * click. ClockStamp-shaped structs are the canonical target.
 */
export function objectFillAll(
  descriptor: ObjectDescriptor,
  labelPath: readonly (string | number)[],
  formValue: unknown,
): Record<string, unknown> | null {
  const matched: { readonly field: ObjectField; readonly hint: FillHint }[] = [];
  for (const field of descriptor.fields) {
    const child = field.descriptor;
    if (!isPrimitive(child)) continue;
    const hint = hintForPrimitive(child, [...labelPath, field.name], formValue);
    if (hint !== null) matched.push({ field, hint });
  }
  // "Looks like a time snapshot": heuristic says at least 3 of the
  // fields are fillable. Prevents random objects from getting a
  // fill-all button that would blitz through unrelated data.
  if (matched.length < 3) return null;
  const out: Record<string, unknown> = {};
  for (const { field, hint } of matched) {
    out[field.name] = hint.compute(formValue);
  }
  return out;
}

function isPrimitive(d: FormDescriptor): d is PrimitiveDescriptor {
  return (
    d.kind === "string" ||
    d.kind === "number" ||
    d.kind === "boolean" ||
    d.kind === "null"
  );
}

/**
 * Pair guesser — if this field is `fooTimestamp` or `fooTs`, return
 * the sibling date-looking label `fooDate` / `fooAt` / `foo`.
 */
function guessSiblingDateLabel(name: string): string | null {
  const stripped = name.replace(/(Timestamp|Ts|Ms)$/i, "");
  if (stripped === "" || stripped === name) return null;
  // Prefer `*Date` / `*At` variants; caller does the actual lookup.
  return `${stripped}Date`;
}

function readSibling(
  formValue: unknown,
  labelPath: readonly (string | number)[],
  siblingLabel: string,
): unknown {
  // Walk to the parent object; the sibling lives next to the last
  // label in the path.
  if (labelPath.length === 0) return undefined;
  const parentPath = labelPath.slice(0, -1);
  let cursor: unknown = formValue;
  for (const seg of parentPath) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  if (cursor === null || typeof cursor !== "object") return undefined;
  const obj = cursor as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, siblingLabel)) {
    return obj[siblingLabel];
  }
  // Case-insensitive fallback
  const lower = siblingLabel.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) return obj[key];
  }
  // Try `*At` / bare `*`
  const alternatives = [
    siblingLabel.replace(/Date$/, "At"),
    siblingLabel.replace(/Date$/, ""),
  ];
  for (const alt of alternatives) {
    if (Object.prototype.hasOwnProperty.call(obj, alt)) {
      return obj[alt];
    }
  }
  return undefined;
}

function generateUuid(): string {
  // Prefer the native API when available (secure + RFC-compliant).
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID !== undefined) return g.crypto.randomUUID();
  // Fallback — not cryptographically random, but good enough for dev
  // fixtures where the id just needs to be unique within a session.
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
