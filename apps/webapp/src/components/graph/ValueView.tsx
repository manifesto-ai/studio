import { useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * ValueView — type-aware renderer for live snapshot values.  Replaces
 * a single JSON-stringified line with a compact, readable presentation
 * per kind: booleans become a filled/empty dot, numbers stand out as
 * large monospace digits, enums show the active option against the
 * inactive ones, arrays show an item count + sparkline, simple objects
 * expand their top keys.
 *
 * Tone must match the signal channel of the parent card so the value
 * reads as part of the same node, not a foreign chip.  All variants
 * stay within ~24px vertical so cards keep their standard height.
 */

export type ValueTone = "state" | "computed";

type CommonProps = {
  readonly tone: ValueTone;
  readonly compact?: boolean;
};

const TONE: Record<ValueTone, { fg: string; dim: string }> = {
  state: {
    fg: "var(--color-sig-state)",
    dim: "color-mix(in oklch, var(--color-sig-state) 38%, var(--color-ink-mute))",
  },
  computed: {
    fg: "var(--color-sig-computed)",
    dim: "color-mix(in oklch, var(--color-sig-computed) 38%, var(--color-ink-mute))",
  },
};

/** Top-level entry point — picks a renderer from value + typeDef. */
export function ValueView({
  value,
  typeDef,
  tone,
}: CommonProps & {
  readonly value: unknown;
  readonly typeDef?: unknown;
}): JSX.Element {
  // Nothing yet — haven't built or not in this snapshot.
  if (value === undefined) {
    return <MissingView tone={tone} />;
  }

  // Enum detection from typeDef wins over runtime type so e.g.
  // `"all" | "active" | "completed"` renders as a pill group even
  // when the current value is just the string "all".
  const enumOptions = extractEnumOptions(typeDef);
  if (enumOptions !== null) {
    return <EnumView tone={tone} options={enumOptions} value={value} />;
  }

  if (value === null) return <NullView tone={tone} />;
  if (typeof value === "boolean") {
    return <BoolView tone={tone} value={value} />;
  }
  if (typeof value === "number") {
    return <NumberView tone={tone} value={value} />;
  }
  if (typeof value === "string") {
    return <StringView tone={tone} value={value} />;
  }
  if (Array.isArray(value)) {
    return <ArrayView tone={tone} value={value} />;
  }
  if (typeof value === "object") {
    return <ObjectView tone={tone} value={value as Record<string, unknown>} />;
  }
  return <StringView tone={tone} value={String(value)} />;
}

// --------------------------------------------------------------------
// Individual renderers
// --------------------------------------------------------------------

function MissingView({ tone }: { readonly tone: ValueTone }): JSX.Element {
  return (
    <div
      className="font-mono text-[11px]"
      style={{ color: TONE[tone].dim, opacity: 0.6 }}
    >
      — not yet computed —
    </div>
  );
}

function NullView({ tone }: { readonly tone: ValueTone }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2 w-2 rounded-full"
        style={{
          border: `1px dashed ${TONE[tone].dim}`,
        }}
      />
      <span
        className="font-mono text-[11.5px]"
        style={{ color: TONE[tone].dim }}
      >
        null
      </span>
    </div>
  );
}

function BoolView({
  tone,
  value,
}: {
  readonly tone: ValueTone;
  readonly value: boolean;
}): JSX.Element {
  const active = value;
  const activeColor = "var(--color-sig-determ)";
  const idleColor = TONE[tone].dim;
  return (
    <div className="flex items-center gap-2">
      {/* Mini toggle indicator: filled for true, hollow outline for false */}
      <motion.span
        layout
        className="relative inline-flex h-[14px] w-[22px] rounded-full border items-center"
        style={{
          borderColor: active ? activeColor : idleColor,
          background: active
            ? "color-mix(in oklch, var(--color-sig-determ) 28%, transparent)"
            : "transparent",
        }}
      >
        <motion.span
          layout
          aria-hidden
          className="absolute h-[8px] w-[8px] rounded-full"
          style={{
            background: active ? activeColor : idleColor,
            boxShadow: active ? `0 0 6px ${activeColor}` : undefined,
            left: active ? 11 : 2,
          }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </motion.span>
      <span
        className="font-mono text-[11.5px] font-medium"
        style={{ color: active ? activeColor : idleColor }}
      >
        {active ? "true" : "false"}
      </span>
    </div>
  );
}

function NumberView({
  tone,
  value,
}: {
  readonly tone: ValueTone;
  readonly value: number;
}): JSX.Element {
  const isZero = value === 0;
  const isNeg = value < 0;
  const formatted = formatNumber(value);
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="font-mono font-medium tracking-tight"
        style={{
          fontSize: 15,
          color: isZero ? TONE[tone].dim : TONE[tone].fg,
          textShadow: isZero ? undefined : `0 0 10px ${TONE[tone].fg}22`,
        }}
      >
        {formatted}
      </span>
      {isNeg && (
        <span className="font-sans text-[9.5px] text-[var(--color-ink-mute)] uppercase tracking-wide">
          neg
        </span>
      )}
    </div>
  );
}

function StringView({
  tone,
  value,
}: {
  readonly tone: ValueTone;
  readonly value: string;
}): JSX.Element {
  const empty = value.length === 0;
  const display = empty ? "" : value.length > 28 ? value.slice(0, 26) + "…" : value;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className="font-mono text-[10px]"
        style={{ color: TONE[tone].dim }}
      >
        “
      </span>
      <span
        className="font-mono text-[12px] truncate"
        style={{
          color: empty ? TONE[tone].dim : TONE[tone].fg,
          fontStyle: empty ? "italic" : undefined,
        }}
        title={value}
      >
        {empty ? "empty" : display}
      </span>
      <span
        className="font-mono text-[10px]"
        style={{ color: TONE[tone].dim }}
      >
        ”
      </span>
    </div>
  );
}

function EnumView({
  tone,
  options,
  value,
}: {
  readonly tone: ValueTone;
  readonly options: readonly (string | number | boolean | null)[];
  readonly value: unknown;
}): JSX.Element {
  // If we have too many options, fall back to showing just the active one
  // with a count.
  if (options.length > 4) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-[11.5px] px-1.5 py-0.5 rounded"
          style={{
            color: TONE[tone].fg,
            background: `color-mix(in oklch, ${TONE[tone].fg} 12%, transparent)`,
            border: `1px solid ${TONE[tone].fg}`,
          }}
        >
          {stringifyEnum(value)}
        </span>
        <span
          className="font-sans text-[10px]"
          style={{ color: TONE[tone].dim }}
        >
          · 1/{options.length}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map((opt) => {
        const active = stringifyEnum(opt) === stringifyEnum(value);
        return (
          <span
            key={stringifyEnum(opt)}
            className="font-mono text-[10.5px] px-1.5 py-[1px] rounded-sm transition-colors"
            style={{
              color: active ? TONE[tone].fg : "var(--color-ink-mute)",
              background: active
                ? `color-mix(in oklch, ${TONE[tone].fg} 18%, transparent)`
                : "transparent",
              border: `1px solid ${
                active
                  ? TONE[tone].fg
                  : "color-mix(in oklch, var(--color-ink-mute) 30%, transparent)"
              }`,
              boxShadow: active
                ? `0 0 8px color-mix(in oklch, ${TONE[tone].fg} 40%, transparent)`
                : undefined,
            }}
          >
            {stringifyEnum(opt)}
          </span>
        );
      })}
    </div>
  );
}

function ArrayView({
  tone,
  value,
}: {
  readonly tone: ValueTone;
  readonly value: readonly unknown[];
}): JSX.Element {
  const n = value.length;
  // Tiny tile row for small arrays, count-badge for large.
  if (n === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <ItemPile empty tone={tone} />
        <span
          className="font-mono text-[11px]"
          style={{ color: TONE[tone].dim }}
        >
          empty
        </span>
      </div>
    );
  }

  const showTiles = Math.min(n, 6);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="flex items-center gap-[2px]">
        {Array.from({ length: showTiles }, (_, i) => {
          const item = value[i];
          return (
            <span
              key={i}
              className="h-[10px] rounded-sm"
              style={{
                width: tileWidth(item),
                background: TONE[tone].fg,
                opacity: 0.35 + (i * 0.08),
              }}
              title={short(item)}
            />
          );
        })}
        {n > showTiles && (
          <span
            className="font-mono text-[10px] ml-1"
            style={{ color: TONE[tone].dim }}
          >
            +{n - showTiles}
          </span>
        )}
      </div>
      <span
        className="font-mono text-[11.5px] font-medium ml-1"
        style={{ color: TONE[tone].fg }}
      >
        {n}
      </span>
      <span
        className="font-sans text-[10px]"
        style={{ color: TONE[tone].dim }}
      >
        {n === 1 ? "item" : "items"}
      </span>
    </div>
  );
}

function ItemPile({
  empty,
  tone,
}: {
  readonly empty: boolean;
  readonly tone: ValueTone;
}): JSX.Element {
  return (
    <span
      className="h-[10px] w-[26px] rounded-sm"
      style={{
        border: `1px dashed ${TONE[tone].dim}`,
        background: empty ? "transparent" : TONE[tone].fg,
      }}
    />
  );
}

function ObjectView({
  tone,
  value,
}: {
  readonly tone: ValueTone;
  readonly value: Record<string, unknown>;
}): JSX.Element {
  const keys = Object.keys(value);
  const [open, setOpen] = useState(false);
  if (keys.length === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className="font-mono text-[11px]"
          style={{ color: TONE[tone].dim }}
        >
          {"{}"}
        </span>
        <span
          className="font-sans text-[10px]"
          style={{ color: TONE[tone].dim }}
        >
          empty
        </span>
      </div>
    );
  }

  const shown = open ? keys : keys.slice(0, 2);
  const hasMore = keys.length > shown.length;

  return (
    <div className="flex flex-col gap-[2px] min-w-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center gap-0.5 text-left"
      >
        {open ? (
          <ChevronDown
            className="h-[10px] w-[10px]"
            style={{ color: TONE[tone].dim }}
          />
        ) : (
          <ChevronRight
            className="h-[10px] w-[10px]"
            style={{ color: TONE[tone].dim }}
          />
        )}
        <span
          className="font-sans text-[10px]"
          style={{ color: TONE[tone].dim }}
        >
          {keys.length} {keys.length === 1 ? "field" : "fields"}
        </span>
      </button>
      {open &&
        shown.map((k) => (
          <div
            key={k}
            className={cn("flex items-baseline gap-1.5 min-w-0 pl-[12px]")}
          >
            <span
              className="font-mono text-[10px] shrink-0"
              style={{ color: TONE[tone].dim }}
            >
              {k}:
            </span>
            <span
              className="font-mono text-[11px] truncate"
              style={{ color: TONE[tone].fg }}
              title={short(value[k])}
            >
              {short(value[k])}
            </span>
          </div>
        ))}
      {!open && hasMore && (
        <span
          className="font-mono text-[10px] pl-[12px]"
          style={{ color: TONE[tone].dim }}
        >
          …
        </span>
      )}
    </div>
  );
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) {
    if (Math.abs(n) >= 1000) return n.toLocaleString("en-US");
    return n.toString();
  }
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function short(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "—";
  if (typeof v === "string")
    return v.length > 20 ? `"${v.slice(0, 18)}…"` : `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return `{${keys.length}}`;
  }
  return String(v);
}

function tileWidth(item: unknown): number {
  // Vary tile width slightly to hint at item "size".
  if (item === null || item === undefined) return 4;
  if (typeof item === "boolean") return 5;
  if (typeof item === "number") return 5 + Math.min(6, Math.abs(item));
  if (typeof item === "string") return Math.min(14, 4 + item.length);
  if (Array.isArray(item)) return Math.min(16, 5 + item.length);
  if (typeof item === "object")
    return Math.min(16, 5 + Object.keys(item).length);
  return 6;
}

function stringifyEnum(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return String(v);
}

function extractEnumOptions(
  typeDef: unknown,
): readonly (string | number | boolean | null)[] | null {
  if (typeDef === null || typeDef === undefined) return null;
  if (typeof typeDef !== "object") return null;
  const t = typeDef as {
    readonly kind?: string;
    readonly types?: readonly unknown[];
    readonly value?: unknown;
  };
  if (t.kind === "literal" && isEnumable(t.value)) {
    return [t.value];
  }
  if (t.kind === "union" && Array.isArray(t.types)) {
    const out: (string | number | boolean | null)[] = [];
    for (const x of t.types) {
      if (
        typeof x === "object" &&
        x !== null &&
        (x as { kind?: string }).kind === "literal" &&
        isEnumable((x as { value?: unknown }).value)
      ) {
        out.push((x as { value: string | number | boolean | null }).value);
      } else {
        return null; // mixed union — not a clean enum
      }
    }
    return out.length > 0 ? out : null;
  }
  return null;
}

function isEnumable(
  v: unknown,
): v is string | number | boolean | null {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    v === null
  );
}
