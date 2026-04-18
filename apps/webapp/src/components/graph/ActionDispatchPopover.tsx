import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Play, PlayCircle, X } from "lucide-react";
import { motion } from "motion/react";
import {
  defaultValueFor,
  descriptorForAction,
  useStudio,
  type FormDescriptor,
} from "@manifesto-ai/studio-react";
import type { DispatchBlocker } from "@manifesto-ai/studio-core";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/Popover";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * Floating popover for dispatching an action directly from its graph
 * card. Anchors to the card element, renders a minimal form for the
 * action's input, live-evaluates `whyNot`, and ships Simulate +
 * Dispatch buttons. Closes on success or Escape.
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
  const { module, createIntent, dispatch, simulate, whyNot } = useStudio();

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
  const [simulatedOutput, setSimulatedOutput] = useState<unknown | null>(null);

  useEffect(() => {
    if (descriptor === null) {
      setValue(undefined);
      return;
    }
    setValue(defaultValueFor(descriptor));
    setSimulatedOutput(null);
    setError(null);
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

  const onDispatch = async (): Promise<void> => {
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

  const onSimulate = (): void => {
    setError(null);
    setSimulatedOutput(null);
    setPending("simulate");
    try {
      const intent = createIntent(actionName, value);
      const result = simulate(intent);
      setSimulatedOutput(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending("idle");
    }
  };

  if (anchor === null) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={{ current: anchor }} />
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={10}
        className="w-[320px] flex flex-col gap-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
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
            No input required.
          </p>
        ) : (
          <FieldRenderer
            descriptor={descriptor}
            value={value}
            onChange={setValue}
          />
        )}

        {blockers !== null && blockers.length > 0 && (
          <BlockerRow blockers={blockers} />
        )}

        {simulatedOutput !== null && (
          <div className="rounded-md border border-[var(--color-glass-edge)] bg-[var(--color-glass)] p-2 max-h-[120px] overflow-auto">
            <div className="font-sans text-[9.5px] uppercase tracking-[0.04em] text-[var(--color-ink-mute)] mb-1">
              Simulated snapshot
            </div>
            <pre className="font-mono text-[10px] text-[var(--color-ink)] whitespace-pre-wrap">
              {safeStringify(simulatedOutput)}
            </pre>
          </div>
        )}

        {error !== null && (
          <div className="rounded-md border border-[var(--color-err)] bg-[color-mix(in_oklch,var(--color-err)_12%,transparent)] p-2 flex gap-1.5">
            <CircleAlert className="h-3.5 w-3.5 text-[var(--color-err)] shrink-0 mt-0.5" />
            <span className="font-mono text-[10.5px] text-[var(--color-err)]">
              {error}
            </span>
          </div>
        )}

        <div className="flex gap-2 mt-1">
          <Button
            variant="glass"
            size="sm"
            onClick={onSimulate}
            disabled={pending !== "idle"}
            className="flex-1 gap-1.5"
          >
            <PlayCircle className="h-3 w-3" />
            Simulate
          </Button>
          <Button
            variant="solid"
            size="sm"
            onClick={() => void onDispatch()}
            disabled={pending !== "idle" || isBlocked}
            className="flex-1 gap-1.5"
          >
            <Play className="h-3 w-3 fill-current" />
            Dispatch
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --------------------------------------------------------------------
// FieldRenderer — minimal, primitives-only form. Falls back to raw
// JSON for complex shapes.
// --------------------------------------------------------------------

function FieldRenderer({
  descriptor,
  value,
  onChange,
}: {
  readonly descriptor: FormDescriptor;
  readonly value: unknown;
  readonly onChange: (next: unknown) => void;
}): JSX.Element {
  switch (descriptor.kind) {
    case "string":
      return (
        <LabeledInput label="input">
          <input
            type="text"
            value={(value as string | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={inputStyle}
            autoFocus
          />
        </LabeledInput>
      );
    case "number":
      return (
        <LabeledInput label="input">
          <input
            type="number"
            value={
              typeof value === "number" ? value : Number(value ?? 0)
            }
            onChange={(e) => onChange(Number(e.target.value))}
            className={inputStyle}
            autoFocus
          />
        </LabeledInput>
      );
    case "boolean":
      return (
        <LabeledInput label="input">
          <button
            type="button"
            onClick={() => onChange(!(value as boolean))}
            className={cn(
              "h-7 px-2.5 rounded-md border text-[11px] font-mono",
              "bg-[var(--color-glass)] border-[var(--color-glass-edge)]",
              "hover:border-[var(--color-glass-edge-hot)]",
            )}
          >
            {String(Boolean(value))}
          </button>
        </LabeledInput>
      );
    case "enum":
      return (
        <LabeledInput label="input">
          <select
            value={String(value)}
            onChange={(e) => onChange(coerceEnumValue(e.target.value, descriptor))}
            className={inputStyle}
          >
            {descriptor.options.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </LabeledInput>
      );
    case "object": {
      const obj = (value as Record<string, unknown>) ?? {};
      return (
        <div className="flex flex-col gap-2">
          {descriptor.fields.map((field) => (
            <div key={field.name}>
              <div className="font-mono text-[10px] text-[var(--color-ink-mute)] mb-1">
                {field.name}
                {field.descriptor.required ? " *" : ""}
              </div>
              <FieldRenderer
                descriptor={field.descriptor}
                value={obj[field.name]}
                onChange={(next) => onChange({ ...obj, [field.name]: next })}
              />
            </div>
          ))}
        </div>
      );
    }
    default:
      return (
        <LabeledInput label={`raw json (${descriptor.kind})`}>
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
            className={cn(inputStyle, "font-mono text-[11px] py-1.5")}
          />
        </LabeledInput>
      );
  }
}

function LabeledInput({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-sans text-[9.5px] uppercase tracking-[0.04em] text-[var(--color-ink-mute)]">
        {label}
      </span>
      {children}
    </div>
  );
}

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
        <span className="font-sans text-[9.5px] uppercase tracking-[0.04em] text-[var(--color-err)]">
          blocked
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

const inputStyle = cn(
  "h-7 w-full px-2 rounded-md",
  "bg-[var(--color-void-hi)] text-[var(--color-ink)]",
  "border border-[var(--color-glass-edge)]",
  "font-mono text-[11.5px]",
  "focus:outline-none focus:border-[var(--color-violet-hot)]",
  "placeholder:text-[var(--color-ink-mute)]",
);

function coerceEnumValue(
  raw: string,
  descriptor: { readonly options: readonly { readonly value: unknown }[] },
): unknown {
  const match = descriptor.options.find((o) => String(o.value) === raw);
  return match === undefined ? raw : match.value;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
