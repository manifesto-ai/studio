import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, Play, PlayCircle, Sparkles, X } from "lucide-react";
import {
  ActionForm,
  BlockerList,
  collectBlockerPaths,
  collectSimulationDiffs,
  createIntentArgsForValue,
  createInitialFormValue,
  descriptorForAction,
  SimulationTraceView,
  summarizePreviewValue,
  useStudio,
  type FormDescriptor,
} from "@manifesto-ai/studio-react";
import type { DispatchBlocker, StudioSimulateResult } from "@manifesto-ai/studio-core";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/Popover";
import { Button } from "@/components/ui/Button";

/**
 * Floating popover for dispatching an action directly from its graph card.
 * Uses the shared ActionForm engine from `studio-react`, while keeping a
 * compact observatory-specific shell for the graph.
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
    descriptor === null
      ? undefined
      : createInitialFormValue(descriptor, { sparseOptional: true }),
  );
  const [pending, setPending] = useState<"idle" | "simulate" | "dispatch">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [liveSim, setLiveSim] = useState<StudioSimulateResult | null>(null);

  useEffect(() => {
    if (descriptor === null) {
      setValue(undefined);
      setError(null);
      setLiveSim(null);
      return;
    }
    setValue(createInitialFormValue(descriptor, { sparseOptional: true }));
    setError(null);
    setLiveSim(null);
  }, [descriptor, actionName]);

  const blockers: readonly DispatchBlocker[] | null = useMemo(() => {
    if (module === null) return null;
    try {
      const intent = createIntent(
        actionName,
        ...createIntentArgsForValue(descriptor, value),
      );
      return whyNot(intent);
    } catch {
      return null;
    }
  }, [module, actionName, descriptor, value, createIntent, whyNot]);

  const blockerPaths = useMemo(() => collectBlockerPaths(blockers), [blockers]);
  const isBlocked = blockers !== null && blockers.length > 0;

  useEffect(() => {
    if (module === null || isBlocked) {
      setLiveSim(null);
      return;
    }
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const intent = createIntent(
          actionName,
          ...createIntentArgsForValue(descriptor, value),
        );
        setLiveSim(simulate(intent));
      } catch {
        setLiveSim(null);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [module, actionName, descriptor, value, createIntent, simulate, isBlocked]);

  const runDispatch = async (): Promise<void> => {
    if (isBlocked) return;
    setError(null);
    setPending("dispatch");
    try {
      const intent = createIntent(
        actionName,
        ...createIntentArgsForValue(descriptor, value),
      );
      await dispatch(intent);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending("idle");
    }
  };

  const runSimulate = (): void => {
    setError(null);
    setPending("simulate");
    try {
      const intent = createIntent(
        actionName,
        ...createIntentArgsForValue(descriptor, value),
      );
      setLiveSim(simulate(intent));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending("idle");
    }
  };

  const onPopoverKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    const inTextarea = target.tagName === "TEXTAREA";
    if (inTextarea && !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) {
      runSimulate();
    } else {
      void runDispatch();
    }
  };

  const suggestionSource = useMemo(() => collectStateArrays(snapshot), [snapshot]);
  const getStringSuggestions = useCallback(
    ({
      label,
    }: {
      readonly descriptor: { readonly kind: "string" };
      readonly path: readonly (string | number)[];
      readonly label?: string;
      readonly value: unknown;
    }): readonly string[] => {
      if (label === undefined) return [];
      return suggestIds(label, suggestionSource);
    },
    [suggestionSource],
  );

  if (anchor === null) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={{ current: anchor }} />
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={10}
        className="w-[340px] flex flex-col gap-2.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
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
          <div className="max-h-[280px] overflow-auto pr-1">
            <ActionForm
              descriptor={descriptor}
              value={value}
              onChange={setValue}
              highlightedPaths={blockerPaths}
              getStringSuggestions={getStringSuggestions}
            />
          </div>
        )}

        {blockers !== null && blockers.length > 0 ? (
          <BlockerList blockers={blockers} hideWhenEmpty />
        ) : null}

        {liveSim !== null && !isBlocked ? (
          <CompactSimulatePreview
            result={liveSim}
            currentSnapshot={snapshot}
          />
        ) : null}

        {error !== null ? (
          <div className="rounded-md border border-[var(--color-err)] bg-[color-mix(in_oklch,var(--color-err)_12%,transparent)] p-2 flex gap-1.5">
            <CircleAlert className="h-3.5 w-3.5 text-[var(--color-err)] shrink-0 mt-0.5" />
            <span className="font-mono text-[10.5px] text-[var(--color-err)]">
              {error}
            </span>
          </div>
        ) : null}

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

function KbdHint({
  mod,
  k,
}: {
  readonly mod?: string;
  readonly k: string;
}): JSX.Element {
  return (
    <span className="ml-auto flex items-center gap-0.5 font-mono text-[9.5px] opacity-70">
      {mod !== undefined ? <span>{mod}</span> : null}
      <span>{k}</span>
    </span>
  );
}

function CompactSimulatePreview({
  result,
  currentSnapshot,
}: {
  readonly result: StudioSimulateResult;
  readonly currentSnapshot: {
    readonly data?: unknown;
    readonly computed?: Record<string, unknown>;
  } | null;
}): JSX.Element {
  const diffs = useMemo(
    () => collectSimulationDiffs(currentSnapshot, result),
    [currentSnapshot, result],
  );

  return (
    <div className="rounded-md border border-[var(--color-glass-edge)] bg-[var(--color-glass)] p-2 flex flex-col gap-0.5">
      {diffs.length === 0 ? (
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-[var(--color-ink-mute)]" />
          <span className="font-sans text-[10.5px] text-[var(--color-ink-mute)]">
            no observable change
          </span>
        </div>
      ) : null}
      {diffs.length > 0 ? (
        <>
          <div className="flex items-center gap-1.5 mb-0.5">
            <Sparkles className="h-3 w-3 text-[var(--color-violet-hot)]" />
            <span className="font-sans text-[9.5px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink-mute)]">
              will change {diffs.length}
            </span>
          </div>
          {diffs.slice(0, 4).map((diff) => (
            <div
              key={diff.path}
              className="flex items-center gap-1.5 font-mono text-[10.5px] min-w-0"
            >
              <span className="text-[var(--color-ink-dim)] truncate">
                {diff.path}
              </span>
              <span className="text-[var(--color-ink-mute)]">
                {summarizePreviewValue(diff.before, 16)}
              </span>
              <span className="text-[var(--color-ink-mute)]">→</span>
              <span className="text-[var(--color-violet-hot)] truncate">
                {summarizePreviewValue(diff.after, 16)}
              </span>
            </div>
          ))}
          {diffs.length > 4 ? (
            <span className="font-mono text-[10px] text-[var(--color-ink-mute)]">
              +{diffs.length - 4} more
            </span>
          ) : null}
        </>
      ) : null}
      {result.diagnostics?.trace !== undefined ? (
        <SimulationTraceView
          trace={result.diagnostics.trace}
          density="compact"
        />
      ) : null}
    </div>
  );
}

type StateArrayMap = ReadonlyMap<string, readonly unknown[]>;

function collectStateArrays(
  snapshot: { readonly data?: unknown } | null,
): StateArrayMap {
  const map = new Map<string, readonly unknown[]>();
  const data = snapshot?.data;
  if (data === null || data === undefined || typeof data !== "object") {
    return map;
  }
  for (const [key, next] of Object.entries(data as Record<string, unknown>)) {
    if (Array.isArray(next)) map.set(key, next);
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
      const record = item as Record<string, unknown>;
      for (const [key, next] of Object.entries(record)) {
        if (
          key.toLowerCase() === "id" ||
          key.toLowerCase() === fieldName.toLowerCase()
        ) {
          if (typeof next === "string") out.push(next);
        }
      }
    }
  }
  return Array.from(new Set(out)).slice(0, 20);
}
