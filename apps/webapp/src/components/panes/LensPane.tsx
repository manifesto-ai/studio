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
  HistoryTimeline,
  InteractionEditor,
  PlanPanel,
  SnapshotTree,
  type Marker,
} from "@manifesto-ai/studio-react";
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
    label: "Snapshot",
    hint: "Current state tree",
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
    label: "History",
    hint: "Snapshot timeline · replay",
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
                <InteractionEditor />
              </div>
              {value === "snapshot" ? <SnapshotTree /> : null}
              {value === "plan" ? <PlanPanel /> : null}
              {value === "history" ? <HistoryTimeline /> : null}
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
  onSelect,
}: {
  readonly lens: LensMeta;
  readonly active: boolean;
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
