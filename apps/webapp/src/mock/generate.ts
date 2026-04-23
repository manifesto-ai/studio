/**
 * Mock data generator — shared between the agent tool
 * (`agent/tools/generate-mock.ts`) and any human surface that wants
 * to seed a Manifesto runtime with plausible sample data.
 *
 * The generator walks a MEL `TypeDefinition` (the compiler IR's
 * discriminated type shape) and produces a value that matches. It
 * does NOT try to satisfy `available`/`dispatchable` guards — the
 * runtime will reject invalid dispatches, which is exactly what you
 * want during exploratory seeding ("let me see what breaks").
 *
 * Determinism: every call takes an optional `seed`. With a seed the
 * same inputs always produce the same output — makes tests stable
 * and lets humans share "seed 12345" to reproduce a dataset.
 *
 * Field-name heuristics:
 *   - `id` / `*Id` → short mock ids like `mock-a1b2c3`
 *   - `title` / `name` → short phrase from a fixed vocabulary
 *   - `description` → longer sentence
 *   - `*At` / `*Date` → ISO timestamp near now
 *   - `*Ts` / `*Timestamp` → epoch millis near now
 *   - `timezone` → "UTC"
 *   - `now`, `todayStart*`, `todayEnd*`, `weekStart*`, `weekEnd*`,
 *     `monthStart*`, `monthEnd*` → computed range values (useful
 *     for TaskFlow's ClockStamp and similar clock types)
 *
 * Anything else falls back to type-driven primitives.
 */
import type { DomainModule } from "@manifesto-ai/studio-core";

// --------------------------------------------------------------------
// Type shapes borrowed from the compiler — we don't import the runtime
// types (they'd pull in the SDK); we redeclare the narrow slice.
// --------------------------------------------------------------------

export type MockTypeDefinition =
  | { readonly kind: "primitive"; readonly type: string }
  | { readonly kind: "array"; readonly element: MockTypeDefinition }
  | {
      readonly kind: "record";
      readonly key: MockTypeDefinition;
      readonly value: MockTypeDefinition;
    }
  | {
      readonly kind: "object";
      readonly fields: Record<
        string,
        { readonly type: MockTypeDefinition; readonly optional: boolean }
      >;
    }
  | { readonly kind: "union"; readonly types: readonly MockTypeDefinition[] }
  | {
      readonly kind: "literal";
      readonly value: string | number | boolean | null;
    }
  | { readonly kind: "ref"; readonly name: string };

type TypeSpecLike = {
  readonly name: string;
  readonly definition: MockTypeDefinition;
};

// --------------------------------------------------------------------
// RNG — mulberry32, seedable. Keeps generation deterministic under
// test so snapshot tests don't flake on random values.
// --------------------------------------------------------------------

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// --------------------------------------------------------------------
// Value vocab pools. Small and domain-agnostic — enough to make
// generated data readable without looking mad-libs ridiculous.
// --------------------------------------------------------------------

const TITLES = [
  "Draft proposal",
  "Review pull request",
  "Sync with team",
  "Migrate database",
  "Polish landing page",
  "Write release notes",
  "Triage bug backlog",
  "Prep design review",
  "Record onboarding video",
  "Schedule customer call",
];

const DESCRIPTIONS = [
  "Coordinate with stakeholders before the sprint wraps.",
  "Low priority — pick up once the current release is shipped.",
  "Blocked on the platform team. Check back Thursday.",
  "Follow up on last week's discussion notes.",
  "Includes a rollback plan and a post-mortem template.",
];

const NAMES = [
  "alex",
  "sam",
  "priya",
  "taylor",
  "jordan",
  "morgan",
  "casey",
  "kai",
];

const WORDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
];

// --------------------------------------------------------------------
// Field-name heuristics. If a field's name matches one of these
// predicates we tailor the value rather than falling through to the
// type-driven default.
// --------------------------------------------------------------------

function fieldNameMatches(name: string, needle: string): boolean {
  return name.toLowerCase().includes(needle.toLowerCase());
}

function generateByFieldName(
  name: string,
  type: MockTypeDefinition,
  rng: Rng,
  clock: ClockBag,
): unknown | undefined {
  const primitive =
    type.kind === "primitive" ? type.type : undefined;

  // ── Clock-shaped keys (TaskFlow's ClockStamp etc.) ──
  if (name === "timezone") return "UTC";
  if (name === "now")
    return primitive === "number" ? clock.nowTs : clock.nowIso;
  if (name.startsWith("todayStart"))
    return primitive === "number" ? clock.todayStartTs : clock.todayStartIso;
  if (name.startsWith("todayEnd"))
    return primitive === "number" ? clock.todayEndTs : clock.todayEndIso;
  if (name.startsWith("weekStart"))
    return primitive === "number" ? clock.weekStartTs : clock.weekStartIso;
  if (name.startsWith("weekEnd"))
    return primitive === "number" ? clock.weekEndTs : clock.weekEndIso;
  if (name.startsWith("monthStart"))
    return primitive === "number" ? clock.monthStartTs : clock.monthStartIso;
  if (name.startsWith("monthEnd"))
    return primitive === "number" ? clock.monthEndTs : clock.monthEndIso;

  // ── Domain-ish fields — apply only for plain strings, let objects
  //    and unions fall through so the walker can still enter them.
  if (primitive === "string") {
    if (name === "id" || fieldNameMatches(name, "id")) {
      return `mock-${Math.floor(rng() * 0xffffff).toString(16).padStart(6, "0")}`;
    }
    if (name === "title" || name === "label") return pick(rng, TITLES);
    if (name === "name") return pick(rng, NAMES);
    if (name === "description") return pick(rng, DESCRIPTIONS);
    if (name === "assignee") return pick(rng, NAMES);
    if (fieldNameMatches(name, "date") || fieldNameMatches(name, "at")) {
      return clock.nowIso;
    }
  }

  if (primitive === "number") {
    if (
      fieldNameMatches(name, "timestamp") ||
      fieldNameMatches(name, "ts") ||
      fieldNameMatches(name, "epoch")
    ) {
      return clock.nowTs;
    }
    if (fieldNameMatches(name, "count")) return randInt(rng, 0, 10);
    if (fieldNameMatches(name, "capacity")) return randInt(rng, 5, 50);
  }

  return undefined;
}

// --------------------------------------------------------------------
// Clock bag — precomputed timestamps that cover the usual "now /
// today / week / month" split seen in MEL domains. Kept as a single
// coherent snapshot per generate() call so all samples in one batch
// reference the same "now".
// --------------------------------------------------------------------

type ClockBag = {
  readonly nowIso: string;
  readonly nowTs: number;
  readonly todayStartIso: string;
  readonly todayStartTs: number;
  readonly todayEndIso: string;
  readonly todayEndTs: number;
  readonly weekStartIso: string;
  readonly weekStartTs: number;
  readonly weekEndIso: string;
  readonly weekEndTs: number;
  readonly monthStartIso: string;
  readonly monthStartTs: number;
  readonly monthEndIso: string;
  readonly monthEndTs: number;
};

function buildClockBag(now: Date): ClockBag {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const todayStart = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  const todayEnd = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  const day = now.getUTCDay(); // 0=Sun
  const weekStart = new Date(Date.UTC(y, m, d - day, 0, 0, 0, 0));
  const weekEnd = new Date(
    Date.UTC(y, m, d + (6 - day), 23, 59, 59, 999),
  );
  const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
  return {
    nowIso: now.toISOString(),
    nowTs: now.getTime(),
    todayStartIso: todayStart.toISOString(),
    todayStartTs: todayStart.getTime(),
    todayEndIso: todayEnd.toISOString(),
    todayEndTs: todayEnd.getTime(),
    weekStartIso: weekStart.toISOString(),
    weekStartTs: weekStart.getTime(),
    weekEndIso: weekEnd.toISOString(),
    weekEndTs: weekEnd.getTime(),
    monthStartIso: monthStart.toISOString(),
    monthStartTs: monthStart.getTime(),
    monthEndIso: monthEnd.toISOString(),
    monthEndTs: monthEnd.getTime(),
  };
}

// --------------------------------------------------------------------
// Walker. Entry points: generateValue (one value of a type) and
// generateForAction (one arg array matching an action's signature).
// --------------------------------------------------------------------

export type GenerateContext = {
  readonly types: Record<string, TypeSpecLike>;
  readonly rng: Rng;
  readonly clock: ClockBag;
};

export function generateValue(
  type: MockTypeDefinition,
  ctx: GenerateContext,
  fieldName?: string,
): unknown {
  if (fieldName !== undefined) {
    const hinted = generateByFieldName(fieldName, type, ctx.rng, ctx.clock);
    if (hinted !== undefined) return hinted;
  }
  switch (type.kind) {
    case "primitive":
      return generatePrimitive(type.type, ctx);
    case "literal":
      return type.value;
    case "array": {
      const len = randInt(ctx.rng, 0, 3);
      return Array.from({ length: len }, () =>
        generateValue(type.element, ctx),
      );
    }
    case "record": {
      const size = randInt(ctx.rng, 1, 3);
      const out: Record<string, unknown> = {};
      for (let i = 0; i < size; i++) {
        const key = `k${i}`;
        out[key] = generateValue(type.value, ctx);
      }
      return out;
    }
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, spec] of Object.entries(type.fields)) {
        if (spec.optional && ctx.rng() < 0.3) continue;
        out[k] = generateValue(spec.type, ctx, k);
      }
      return out;
    }
    case "union": {
      // Bias away from null when the union contains non-null variants,
      // so generated data is mostly populated rather than mostly null.
      const nonNull = type.types.filter(
        (t) => !(t.kind === "literal" && t.value === null),
      );
      const pool = nonNull.length > 0 && ctx.rng() < 0.8 ? nonNull : type.types;
      return generateValue(pick(ctx.rng, pool), ctx, fieldName);
    }
    case "ref": {
      const spec = ctx.types[type.name];
      if (spec === undefined) {
        throw new Error(`[mock/generate] unknown type ref: ${type.name}`);
      }
      return generateValue(spec.definition, ctx, fieldName);
    }
  }
}

function generatePrimitive(type: string, ctx: GenerateContext): unknown {
  switch (type) {
    case "string":
      return pick(ctx.rng, WORDS);
    case "number":
      return randInt(ctx.rng, 0, 100);
    case "boolean":
      return ctx.rng() < 0.5;
    case "null":
      return null;
    default:
      return null;
  }
}

// --------------------------------------------------------------------
// Per-action generation. Given a compiled module and an action name,
// produce `count` sample arg arrays compatible with
// `core.createIntent(action, ...args)` positional order.
// --------------------------------------------------------------------

export type GenerateForActionOptions = {
  readonly count?: number;
  /** Seed for the RNG. Omit for non-deterministic generation. */
  readonly seed?: number;
  /** Override "now" for time-based fields. Defaults to new Date(). */
  readonly now?: Date;
};

export type GenerateForActionResult = {
  readonly action: string;
  readonly paramNames: readonly string[];
  /** Each sample is an args array to spread into `createIntent`. */
  readonly samples: readonly (readonly unknown[])[];
};

export function generateForAction(
  mod: DomainModule,
  actionName: string,
  options: GenerateForActionOptions = {},
): GenerateForActionResult {
  const count = Math.max(1, Math.min(100, options.count ?? 1));
  const seed = options.seed ?? (Date.now() & 0xffffffff);
  const rng = createRng(seed);
  const now = options.now ?? new Date();
  const clock = buildClockBag(now);

  const actionSpec = (
    mod.schema.actions as Record<string, { readonly inputType?: MockTypeDefinition; readonly params?: readonly string[] }>
  )[actionName];
  if (actionSpec === undefined) {
    throw new Error(`[mock/generate] unknown action: ${actionName}`);
  }
  const paramNames = actionSpec.params ?? [];
  const inputType = actionSpec.inputType;
  const types = mod.schema.types as unknown as Record<string, TypeSpecLike>;

  const ctx: GenerateContext = { types, rng, clock };

  const samples: (readonly unknown[])[] = [];
  for (let i = 0; i < count; i++) {
    samples.push(generateArgArray(inputType, paramNames, ctx));
  }
  return { action: actionName, paramNames, samples };
}

/**
 * The SDK's `createIntent(action, ...args)` takes positional args. The
 * compiled `inputType` for a multi-param action is typically a
 * single object type whose fields are keyed by param name. We
 * generate that object once and unwrap to an array.
 *
 * Zero-param actions → empty array.
 * Single-param actions with a non-object inputType → [value].
 */
function generateArgArray(
  inputType: MockTypeDefinition | undefined,
  paramNames: readonly string[],
  ctx: GenerateContext,
): unknown[] {
  if (paramNames.length === 0 || inputType === undefined) return [];
  if (inputType.kind === "object") {
    return paramNames.map((name) => {
      const field = inputType.fields[name];
      if (field === undefined) {
        // Schema drift between `params` and `inputType.fields`.
        // Generate null rather than throwing; the runtime will reject.
        return null;
      }
      return generateValue(field.type, ctx, name);
    });
  }
  // Single-value input. Apply the first param name as a field-hint
  // so field-name heuristics still fire ("id", "title", etc.).
  return [generateValue(inputType, ctx, paramNames[0])];
}
