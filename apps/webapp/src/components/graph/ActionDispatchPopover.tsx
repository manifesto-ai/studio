import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Command,
  CornerDownLeft,
  Minus,
  Play,
  PlayCircle,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import {
  defaultValueFor,
  descriptorForAction,
  useStudio,
  type FormDescriptor,
} from "@manifesto-ai/studio-react";
import type {
  DispatchBlocker,
  StudioSimulateResult,
} from "@manifesto-ai/studio-core";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/Popover";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * Floating popover for dispatching an action directly from its graph
 * card. Anchors to the card element, renders a form with type-aware
 * controls (pills for enums, toggles for booleans, steppers for
 * numbers, autocomplete for id-like strings), live-evaluates whyNot,
 * and ships Simulate + Dispatch buttons. Keyboard:
 *   · Enter          → Dispatch (if not blocked)
 *   · Cmd/Ctrl+Enter → Simulate
 *   · Escape         → Close
 */
export function ActionDispatchPopover({
  actionName,
  anchor,
  open,
  onOpenChange,
}: {
  readonly actionName: string;
  readonly anchor: HTMLElement | null;
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): JSX.Element | null {
  const { module, snapshot, createIntent, dispatch, simulate, whyNot } =
    useStudio();

  const descriptor: FormDescriptor | null = useMemo(() => {
    if (module === null) return null;
    return descriptorForAction(module.schema, actionName);
  }, [module, actionName]);

  const [value, setValue] = useState<unknown>(() =>
    descriptor === null ? undefined : defaultValueFor(descriptor),
  );
  const [pending, setPending] = useState<"idle" | "simulate" | "dispatch">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [liveSim, setLiveSim] = useState<StudioSimulateResult | null>(null);

  useEffect(() => {
    if (descriptor === null) {
      setValue(undefined);
      return;
    }
    setValue(defaultValueFor(descriptor));
    setError(null);
    setLiveSim(null);
  }, [descriptor, actionName]);

  const blockers: readonly DispatchBlocker[] | null = useMemo(() => {
    if (module === null) return null;
    try {
      const intent = createIntent(actionName, value);
      return whyNot(intent);
    } catch {
      return null;
    }
  }, [module, actionName, value, createIntent, whyNot]);

  const isBlocked = blockers !== null && blockers.length > 0;

  // Live simulate — preview the next snapshot shape without committing.
  // Rerun on value change, but debounce slightly so typing doesn't
  // thrash the simulator.
  useEffect(() => {
    if (module === null || isBlocked) {
      setLiveSim(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const intent = createIntent(actionName, value);
        const result = simulate(intent);
        setLiveSim(result);
      } catch {
        setLiveSim(null);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [module, actionName, value, createIntent, simulate, isBlocked]);

  const runDispatch = async (): Promise<void> => {
    if (isBlocked) return;
    setError(null);
    setPending("dispatch");
    try {
      const intent = createIntent(actionName, value);
      await dispatch(intent);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending("idle");
    }
  };

  const runSimulate = (): void => {
    setError(null);
    setPending("simulate");
    try {
      const intent = createIntent(actionName, value);
      const result = simulate(intent);
      setLiveSim(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending("idle");
    }
  };

  // Keyboard routing — attached on the PopoverContent so fields
  // inside still get default Tab / typing behaviour.
  const onPopoverKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Enter") {
      const target = e.target as HTMLElement;
      const inTextarea = target.tagName === "TEXTAREA";
      if (inTextarea && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) {
        runSimulate();
      } else {
        void runDispatch();
      }
    }
  };

  if (anchor === null) return null;

  const stateArrays = useMemo(
    () => collectStateArrays(snapshot),
    [snapshot],
  );
  const blockerPaths = useMemo(() => collectBlockerPaths(blockers), [blockers]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={{ current: anchor }} />
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={10}
        className="w-[340px] flex flex-col gap-2.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onKeyDown={onPopoverKeyDown}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-[6px] w-[6px] rounded-full"
            style={{
              background: "var(--color-sig-action)",
              boxShadow: "0 0 8px var(--color-sig-action)",
            }}
          />
          <span className="font-mono text-[12px] text-[var(--color-ink)]">
            {actionName}()
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-5 w-5"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>

        {descriptor === null ? (
          <p className="font-sans text-[11px] text-[var(--color-ink-mute)]">
            No input required — press Enter to dispatch.
          </p>
        ) : (
          <FieldRenderer
            descriptor={descriptor}
            value={value}
            onChange={setValue}
            stateArrays={stateArrays}
            blockerPaths={blockerPaths}
            path={[]}
          />
        )}

        {blockers !== null && blockers.length > 0 && (
          <BlockerRow blockers={blockers} />
        )}

        {liveSim !== null && !isBlocked && (
          <SimulatePreview
            result={liveSim}
            currentSnapshot={snapshot}
          />
        )}

        {error !== null && (
          <div className="rounded-md border border-[var(--color-err)] bg-[color-mix(in_oklch,var(--color-err)_12%,transparent)] p-2 flex gap-1.5">
            <CircleAlert className="h-3.5 w-3.5 text-[var(--color-err)] shrink-0 mt-0.5" />
            <span className="font-mono text-[10.5px] text-[var(--color-err)]">
              {error}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-0.5">
          <Button
            variant="glass"
            size="sm"
            onClick={runSimulate}
            disabled={pending !== "idle"}
            className="flex-1 gap-1.5"
          >
            <PlayCircle className="h-3 w-3" />
            Simulate
            <KbdHint mod="⌘" k="↵" />
          </Button>
          <Button
            variant="solid"
            size="sm"
            onClick={() => void runDispatch()}
            disabled={pending !== "idle" || isBlocked}
            className="flex-1 gap-1.5"
          >
            <Play className="h-3 w-3 fill-current" />
            Dispatch
            <KbdHint k="↵" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --------------------------------------------------------------------
// Type-aware field rendering
// --------------------------------------------------------------------

function FieldRenderer({
  descriptor,
  value,
  onChange,
  stateArrays,
  blockerPaths,
  path,
  fieldName,
}: {
  readonly descriptor: FormDescriptor;
  readonly value: unknown;
  readonly onChange: (next: unknown) => void;
  readonly stateArrays: StateArrayMap;
  readonly blockerPaths: ReadonlySet<string>;
  readonly path: readonly string[];
  readonly fieldName?: string;
}): JSX.Element {
  const pathKey = path.join(".");
  const isBlockerField = blockerPaths.has(pathKey);

  switch (descriptor.kind) {
    case "string": {
      // Heuristic: if field name smells like an identity reference,
      // offer a datalist from current state arrays.
      const idSuggestions = fieldName
        ? suggestIds(fieldName, stateArrays)
        : [];
      return (
        <Field label={fieldName ?? "input"} blocker={isBlockerField}>
          <input
            type="text"
            value={(value as string | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            list={idSuggestions.length > 0 ? `dl-${pathKey}` : undefined}
            className={inputStyle(isBlockerField)}
            autoFocus={path.length <= 1}
            placeholder={
              descriptor.defaultValue !== undefined
                ? String(descriptor.defaultValue)
                : undefined
            }
          />
          {idSuggestions.length > 0 && (
            <datalist id={`dl-${pathKey}`}>
              {idSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </Field>
      );
    }
    case "number":
      return (
        <Field label={fieldName ?? "input"} blocker={isBlockerField}>
          <NumberStepper
            value={
              typeof value === "number" ? value : Number(value ?? 0) || 0
            }
            onChange={onChange}
            blocker={isBlockerField}
          />
        </Field>
      );
    case "boolean":
      return (
        <Field label={fieldName ?? "input"} blocker={isBlockerField}>
          <Toggle
            value={Boolean(value)}
            onChange={onChange}
          />
        </Field>
      );
    case "enum":
      return (
        <Field label={fieldName ?? "input"} blocker={isBlockerField}>
          <PillGroup
            options={descriptor.options.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            value={value}
            onChange={onChange}
          />
        </Field>
      );
    case "object": {
      const obj = (value as Record<string, unknown>) ?? {};
      return (
        <div className="flex flex-col gap-2">
          {descriptor.fields.map((field) => (
            <FieldRenderer
              key={field.name}
              descriptor={field.descriptor}
              value={obj[field.name]}
              onChange={(next) => onChange({ ...obj, [field.name]: next })}
              stateArrays={stateArrays}
              blockerPaths={blockerPaths}
              path={[...path, field.name]}
              fieldName={field.name}
            />
          ))}
        </div>
      );
    }
    default:
      return (
        <Field
          label={`${fieldName ?? "input"} · raw json (${descriptor.kind})`}
          blocker={isBlockerField}
        >
          <textarea
            value={safeStringify(value)}
            onChange={(e) => {
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                // keep parsing; user still typing
              }
            }}
            rows={3}
            className={cn(inputStyle(isBlockerField), "h-auto py-1.5")}
          />
        </Field>
      );
  }
}

function Field({
  label,
  blocker,
  children,
}: {
  readonly label: string;
  readonly blocker: boolean;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          "font-sans text-[9.5px] font-medium uppercase tracking-[0.06em]",
          blocker ? "text-[var(--color-err)]" : "text-[var(--color-ink-mute)]",
        )}
      >
        {label}
        {blocker && <span aria-hidden> · blocks</span>}
      </span>
      {children}
    </div>
  );
}

// --------------------------------------------------------------------
// Controls
// --------------------------------------------------------------------

function PillGroup({
  options,
  value,
  onChange,
}: {
  readonly options: readonly {
    readonly value: unknown;
    readonly label: string;
  }[];
  readonly value: unknown;
  readonly onChange: (next: unknown) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = isEqualPrimitive(opt.value, value);
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-7 px-2.5 rounded-md font-mono text-[11px]",
              "border transition-[background,color,border-color,box-shadow] duration-150",
              active
                ? "text-[var(--color-sig-action)] border-[var(--color-sig-action)] bg-[color-mix(in_oklch,var(--color-sig-action)_16%,transparent)] shadow-[0_0_12px_-2px_color-mix(in_oklch,var(--color-sig-action)_50%,transparent)]"
                : "text-[var(--color-ink-dim)] border-[var(--color-glass-edge)] bg-transparent hover:border-[var(--color-glass-edge-hot)] hover:text-[var(--color-ink)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  value,
  onChange,
}: {
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "relative h-7 w-[58px] rounded-md border",
        "transition-[background,border-color] duration-150",
        value
          ? "bg-[color-mix(in_oklch,var(--color-sig-determ)_22%,transparent)] border-[var(--color-sig-determ)]"
          : "bg-[var(--color-glass)] border-[var(--color-glass-edge)]",
      )}
    >
      <motion.span
        layout
        className="absolute top-[3px] h-5 w-5 rounded"
        style={{
          left: value ? 32 : 3,
          background: value
            ? "var(--color-sig-determ)"
            : "var(--color-ink-mute)",
          boxShadow: value ? "0 0 8px var(--color-sig-determ)" : undefined,
        }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
      />
      <span
        className={cn(
          "absolute top-1 font-sans text-[10px] font-medium uppercase tracking-[0.04em]",
          value
            ? "right-[30px] text-[var(--color-sig-determ)]"
            : "left-[28px] text-[var(--color-ink-mute)]",
        )}
      >
        {value ? "on" : "off"}
      </span>
    </button>
  );
}

function NumberStepper({
  value,
  onChange,
  blocker,
}: {
  readonly value: number;
  readonly onChange: (next: number) => void;
  readonly blocker: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center h-7 rounded-md border",
        blocker
          ? "border-[var(--color-err)]"
          : "border-[var(--color-glass-edge)]",
        "bg-[var(--color-void-hi)] overflow-hidden",
        "focus-within:border-[var(--color-violet-hot)]",
      )}
    >
      <button
        type="button"
        className="h-full w-7 flex items-center justify-center text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[var(--color-glass)]"
        onClick={() => onChange(value - 1)}
        aria-label="Decrement"
      >
        <Minus className="h-3 w-3" />
      </button>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="flex-1 h-full bg-transparent text-center font-mono text-[12px] text-[var(--color-ink)] outline-none"
      />
      <button
        type="button"
        className="h-full w-7 flex items-center justify-center text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[var(--color-glass)]"
        onClick={() => onChange(value + 1)}
        aria-label="Increment"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

function KbdHint({
  mod,
  k,
}: {
  readonly mod?: string;
  readonly k: string;
}): JSX.Element {
  return (
    <span className="ml-auto flex items-center gap-0.5 font-mono text-[9.5px] opacity-70">
      {mod !== undefined && <span>{mod}</span>}
      <span>{k}</span>
    </span>
  );
}

// --------------------------------------------------------------------
// Blockers + Simulate preview
// --------------------------------------------------------------------

function BlockerRow({
  blockers,
}: {
  readonly blockers: readonly DispatchBlocker[];
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-md border border-[var(--color-err)] bg-[color-mix(in_oklch,var(--color-err)_10%,transparent)] p-2 flex flex-col gap-1"
    >
      <div className="flex items-center gap-1.5">
        <CircleAlert className="h-3 w-3 text-[var(--color-err)]" />
        <span className="font-sans text-[9.5px] font-medium uppercase tracking-[0.06em] text-[var(--color-err)]">
          {blockers.length === 1 ? "blocked" : `${blockers.length} blockers`}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {blockers.map((b, i) => (
          <li
            key={i}
            className="font-mono text-[10.5px] text-[var(--color-ink)] leading-snug"
          >
            {b.message ?? b.code ?? "blocker"}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function SimulatePreview({
  result,
  currentSnapshot,
}: {
  readonly result: StudioSimulateResult;
  readonly currentSnapshot: { readonly data?: unknown; readonly computed?: Record<string, unknown> } | null;
}): JSX.Element {
  const diffs = useMemo(() => {
    // Prefer the simulator's own `changedPaths` when available — it
    // covers array/object mutations that a shallow diff misses.
    const r = result as unknown as {
      readonly changedPaths?: readonly string[];
      readonly snapshot?: { readonly data?: unknown; readonly computed?: Record<string, unknown> };
    };
    const nextSnap = extractSnapshot(result);
    if (Array.isArray(r.changedPaths) && r.changedPaths.length > 0) {
      return r.changedPaths.map<Diff>((path) => ({
        path,
        before: readPath(currentSnapshot, path),
        after: readPath(nextSnap, path),
      }));
    }
    return diffSnapshots(currentSnapshot, nextSnap);
  }, [currentSnapshot, result]);

  if (diffs.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-glass-edge)] bg-[var(--color-glass)] px-2 py-1.5">
        <Sparkles className="h-3 w-3 text-[var(--color-ink-mute)]" />
        <span className="font-sans text-[10.5px] text-[var(--color-ink-mute)]">
          no observable change
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[var(--color-glass-edge)] bg-[var(--color-glass)] p-2 flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Sparkles className="h-3 w-3 text-[var(--color-violet-hot)]" />
        <span className="font-sans text-[9.5px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink-mute)]">
          will change {diffs.length}
        </span>
      </div>
      {diffs.slice(0, 4).map((d) => (
        <div
          key={d.path}
          className="flex items-center gap-1.5 font-mono text-[10.5px] min-w-0"
        >
          <span className="text-[var(--color-ink-dim)] truncate">{d.path}</span>
          <span className="text-[var(--color-ink-mute)]">
            {truncate(d.before)}
          </span>
          <span className="text-[var(--color-ink-mute)]">→</span>
          <span className="text-[var(--color-violet-hot)] truncate">
            {truncate(d.after)}
          </span>
        </div>
      ))}
      {diffs.length > 4 && (
        <span className="font-mono text-[10px] text-[var(--color-ink-mute)]">
          +{diffs.length - 4} more
        </span>
      )}
    </div>
  );
}

function readPath(
  snap: { readonly data?: unknown; readonly computed?: Record<string, unknown> } | null,
  path: string,
): unknown {
  if (snap === null) return undefined;
  // Split on "." or "[N]" — bracket segments produce numeric indices
  // so the same walker handles `data.todos[0].title`.
  const segments = tokenizePath(path);
  if (segments.length === 0) return undefined;
  let cur: unknown =
    segments[0] === "computed"
      ? snap.computed
      : segments[0] === "data"
        ? snap.data
        : undefined;
  for (let i = 1; i < segments.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    const seg = segments[i];
    if (Array.isArray(cur) && typeof seg === "number") {
      cur = cur[seg];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[String(seg)];
    } else {
      return undefined;
    }
  }
  return cur;
}

function tokenizePath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  let buf = "";
  const flushBuf = (): void => {
    if (buf.length > 0) {
      out.push(buf);
      buf = "";
    }
  };
  while (i < path.length) {
    const c = path[i];
    if (c === ".") {
      flushBuf();
      i++;
    } else if (c === "[") {
      flushBuf();
      const end = path.indexOf("]", i);
      if (end < 0) break;
      const idx = path.slice(i + 1, end);
      const n = Number(idx);
      out.push(Number.isFinite(n) ? n : idx);
      i = end + 1;
    } else {
      buf += c;
      i++;
    }
  }
  flushBuf();
  return out;
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

type StateArrayMap = ReadonlyMap<string, readonly unknown[]>;

function collectStateArrays(
  snapshot: { readonly data?: unknown } | null,
): StateArrayMap {
  const map = new Map<string, readonly unknown[]>();
  const data = snapshot?.data;
  if (data === null || data === undefined || typeof data !== "object") return map;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (Array.isArray(v)) map.set(k, v);
  }
  return map;
}

function suggestIds(fieldName: string, arrays: StateArrayMap): string[] {
  const lower = fieldName.toLowerCase();
  if (!lower.endsWith("id") && !lower.includes("ref")) return [];
  const out: string[] = [];
  for (const items of arrays.values()) {
    for (const item of items) {
      if (item === null || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        if (
          k.toLowerCase() === "id" ||
          k.toLowerCase() === fieldName.toLowerCase()
        ) {
          if (typeof v === "string") out.push(v);
        }
      }
    }
  }
  return Array.from(new Set(out)).slice(0, 20);
}

function collectBlockerPaths(
  blockers: readonly DispatchBlocker[] | null,
): ReadonlySet<string> {
  if (blockers === null) return new Set();
  const out = new Set<string>();
  for (const b of blockers) {
    const bb = b as { readonly field?: unknown; readonly path?: unknown };
    const field = typeof bb.field === "string" ? bb.field : null;
    const path = typeof bb.path === "string" ? bb.path : null;
    if (field !== null) out.add(field);
    if (path !== null) out.add(path);
  }
  return out;
}

function isEqualPrimitive(a: unknown, b: unknown): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function inputStyle(blocker: boolean): string {
  return cn(
    "h-7 w-full px-2 rounded-md",
    "bg-[var(--color-void-hi)] text-[var(--color-ink)]",
    "border",
    blocker
      ? "border-[var(--color-err)]"
      : "border-[var(--color-glass-edge)]",
    "font-mono text-[11.5px]",
    "focus:outline-none focus:border-[var(--color-violet-hot)]",
    "placeholder:text-[var(--color-ink-mute)]",
  );
}

function extractSnapshot(
  result: StudioSimulateResult,
): { data?: unknown; computed?: Record<string, unknown> } | null {
  // StudioSimulateResult shape isn't stable across versions; probe for
  // a `.snapshot` field or treat the result itself as the snapshot.
  const r = result as unknown as {
    readonly snapshot?: { readonly data?: unknown; readonly computed?: Record<string, unknown> };
    readonly data?: unknown;
    readonly computed?: Record<string, unknown>;
  };
  if (r.snapshot !== undefined) return r.snapshot;
  if (r.data !== undefined || r.computed !== undefined) {
    return { data: r.data, computed: r.computed };
  }
  return null;
}

type Diff = {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
};

function diffSnapshots(
  before: { readonly data?: unknown; readonly computed?: Record<string, unknown> } | null,
  after: { readonly data?: unknown; readonly computed?: Record<string, unknown> } | null,
): readonly Diff[] {
  const diffs: Diff[] = [];
  if (before === null || after === null) return diffs;

  const beforeData = (before.data ?? {}) as Record<string, unknown>;
  const afterData = (after.data ?? {}) as Record<string, unknown>;
  const dataKeys = new Set([
    ...Object.keys(beforeData),
    ...Object.keys(afterData),
  ]);
  for (const k of dataKeys) {
    const b = beforeData[k];
    const a = afterData[k];
    if (!deepEqual(b, a)) diffs.push({ path: `data.${k}`, before: b, after: a });
  }

  const beforeComp = before.computed ?? {};
  const afterComp = after.computed ?? {};
  const compKeys = new Set([
    ...Object.keys(beforeComp),
    ...Object.keys(afterComp),
  ]);
  for (const k of compKeys) {
    const b = beforeComp[k];
    const a = afterComp[k];
    if (!deepEqual(b, a))
      diffs.push({ path: `computed.${k}`, before: b, after: a });
  }

  return diffs;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(ao[k], bo[k]));
}

function truncate(v: unknown): string {
  const s =
    v === null
      ? "null"
      : v === undefined
        ? "—"
        : typeof v === "string"
          ? `"${v}"`
          : Array.isArray(v)
            ? `[${v.length}]`
            : typeof v === "object"
              ? `{${Object.keys(v as Record<string, unknown>).length}}`
              : String(v);
  return s.length > 16 ? s.slice(0, 14) + "…" : s;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
