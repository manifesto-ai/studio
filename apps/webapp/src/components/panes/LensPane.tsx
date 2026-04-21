import {
  Activity,
  Boxes,
  History,
  Stethoscope,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  DiagnosticsPanel,
  DispatchTimeline,
  InteractionEditor,
  PlanPanel,
  SnapshotTree,
  type SnapshotFocus,
} from "@manifesto-ai/studio-react";
// Marker is defined in studio-core (adapter-interface) and not
// re-exported by studio-react; pull it from the authoritative source.
import type { Marker } from "@manifesto-ai/studio-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFocus } from "@/hooks/useFocus";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";

export type LensId = "interact" | "snapshot" | "plan" | "history" | "diagnostics";

type LensMeta = {
  readonly id: LensId;
  readonly label: string;
  readonly hint: string;
  readonly Icon: LucideIcon;
  readonly channel: "state" | "action" | "computed" | "effect" | "determ";
};

const LENSES: readonly LensMeta[] = [
  {
    id: "interact",
    label: "Interact",
    hint: "Dispatch intents · available actions",
    Icon: Zap,
    channel: "action",
  },
  {
    id: "snapshot",
    label: "Inspect",
    hint: "Current state tree · click a graph node to scope",
    Icon: Boxes,
    channel: "state",
  },
  {
    id: "plan",
    label: "Plan",
    hint: "Reconciliation plan · last build",
    Icon: Activity,
    channel: "computed",
  },
  {
    id: "history",
    label: "Dispatches",
    hint: "Dispatch timeline · snapshot transitions",
    Icon: History,
    channel: "determ",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    hint: "Compiler errors & warnings",
    Icon: Stethoscope,
    channel: "effect",
  },
];

/**
 * LensPane — the right-hand column. Replaces the old horizontal tab row
 * with a vertical **icon rail** so the active lens content gets the
 * full panel width. Rail doubles as a conceptual cue: "pick your
 * observation channel, then look through it."
 */
export function LensPane({
  value,
  onChange,
  onRevealMarker,
}: {
  readonly value: LensId;
  readonly onChange: (next: LensId) => void;
  readonly onRevealMarker: (marker: Marker) => void;
}): JSX.Element {
  const active = LENSES.find((l) => l.id === value) ?? LENSES[0];

  // Map Focus → SnapshotFocus for the Inspect lens. GraphNode ids are
  // `state:X` / `computed:X` / `action:X`; split on the first colon.
  const { focus } = useFocus();
  const snapshotFocus: SnapshotFocus | null = useMemo(() => {
    if (focus === null || focus.kind !== "node") return null;
    const idx = focus.id.indexOf(":");
    if (idx < 0) return null;
    const kind = focus.id.slice(0, idx);
    const name = focus.id.slice(idx + 1);
    if (kind === "state" || kind === "computed" || kind === "action") {
      return { kind, name };
    }
    return null;
  }, [focus]);

  // Pulse hint — when focus changes while the user isn't on the
  // relevant lens, briefly glow the rail button. Soft hint only; we
  // never force-switch tabs (would steal attention from e.g. a
  // mid-edit Interact form).
  //
  // Lens routing:
  //   action    → interact lens  (replaces the old inline popover)
  //   state     → inspect lens
  //   computed  → inspect lens
  const [pulseLens, setPulseLens] = useState<LensId | null>(null);
  const lastFocusIdRef = useRef<string | null>(null);
  const targetLens: LensId | null =
    snapshotFocus === null
      ? null
      : snapshotFocus.kind === "action"
        ? "interact"
        : "snapshot";
  useEffect(() => {
    const nextId = snapshotFocus === null
      ? null
      : `${snapshotFocus.kind}:${snapshotFocus.name}`;
    if (nextId === lastFocusIdRef.current) return;
    lastFocusIdRef.current = nextId;
    if (nextId === null) return;
    if (targetLens === null) return;
    if (value === targetLens) return;
    setPulseLens(targetLens);
    const t = window.setTimeout(() => setPulseLens(null), 1400);
    return () => window.clearTimeout(t);
  }, [snapshotFocus, value, targetLens]);

  const focusedActionName: string | undefined =
    snapshotFocus !== null && snapshotFocus.kind === "action"
      ? snapshotFocus.name
      : undefined;

  return (
    <Panel className="overflow-hidden !flex-row">
      {/* Vertical icon rail */}
      <TooltipProvider delayDuration={250}>
        <nav
          aria-label="Lens selector"
          className="
            flex flex-col items-center gap-1 py-2 px-1.5
            w-[44px] shrink-0
            border-r border-[var(--color-rule)]
            bg-[color-mix(in_oklch,var(--color-void)_40%,transparent)]
          "
        >
          {LENSES.map((lens) => (
            <RailButton
              key={lens.id}
              lens={lens}
              active={lens.id === value}
              pulse={pulseLens === lens.id}
              onSelect={() => onChange(lens.id)}
            />
          ))}
        </nav>
      </TooltipProvider>

      {/* Active lens body */}
      <div className="flex flex-col flex-1 min-w-0">
        <PanelHeader channel={active.channel}>
          <span>{active.label}</span>
        </PanelHeader>
        <PanelBody className="flex flex-col">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={value}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex flex-col flex-1 min-h-0"
            >
              {/* Interact is always mounted so focus state is preserved;
               * the others are lazy. */}
              <div
                style={{
                  display: value === "interact" ? "flex" : "none",
                  flex: 1,
                  minHeight: 0,
                  flexDirection: "column",
                }}
              >
                <InteractionEditor focusedAction={focusedActionName} />
              </div>
              {value === "snapshot" ? <SnapshotTree focus={snapshotFocus} /> : null}
              {value === "plan" ? <PlanPanel /> : null}
              {value === "history" ? <DispatchTimeline /> : null}
              {value === "diagnostics" ? (
                <DiagnosticsPanel onSelect={onRevealMarker} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </PanelBody>
      </div>
    </Panel>
  );
}

function RailButton({
  lens,
  active,
  pulse = false,
  onSelect,
}: {
  readonly lens: LensMeta;
  readonly active: boolean;
  readonly pulse?: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  const { Icon } = lens;
  const channelColor = `var(--color-sig-${lens.channel})`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          aria-label={lens.label}
          aria-current={active ? "true" : undefined}
          className={cn(
            "relative group flex items-center justify-center",
            "h-8 w-8 rounded-md border transition-all duration-150",
            "focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)] focus-visible:outline-offset-2",
            active
              ? "bg-[color-mix(in_oklch,var(--color-violet)_16%,transparent)] border-[var(--color-glass-edge-hot)]"
              : "bg-transparent border-transparent hover:bg-[var(--color-glass)] hover:border-[var(--color-glass-edge)]",
          )}
        >
          <Icon
            className="h-[14px] w-[14px]"
            style={{
              color: active ? channelColor : "var(--color-ink-dim)",
              filter: active ? `drop-shadow(0 0 6px ${channelColor})` : undefined,
              transition: "color 150ms, filter 150ms",
            }}
          />
          {active && (
            <motion.span
              layoutId="lens-rail-indicator"
              className="absolute -left-[5px] top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full"
              style={{
                background: channelColor,
                boxShadow: `0 0 8px ${channelColor}`,
              }}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
          {pulse && !active && (
            // Soft hint — an outward pulse ring that fades out. Tells
            // the user "something new just landed in this lens" without
            // forcibly switching tabs.
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-md pointer-events-none"
              initial={{ opacity: 0.8, scale: 1 }}
              animate={{ opacity: 0, scale: 1.35 }}
              transition={{ duration: 1.2, ease: "easeOut", repeat: 1 }}
              style={{
                border: `1.5px solid ${channelColor}`,
                boxShadow: `0 0 14px ${channelColor}`,
              }}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        <div className="flex flex-col gap-0.5">
          <span className="font-sans text-[11px] font-medium text-[var(--color-ink)]">
            {lens.label}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-ink-mute)]">
            {lens.hint}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
