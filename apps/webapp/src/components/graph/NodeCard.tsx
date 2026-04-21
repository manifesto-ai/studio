import { motion } from "motion/react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatType, formatValue } from "./formatValue";
import { ValueView } from "./ValueView";
import type { Rect } from "./layout";

/**
 * NodeCard variants by kind.  Each card shows the node's name, its
 * declared type, and (when live) its current snapshot value or
 * dispatchability.  Cards are absolutely positioned by the layout
 * algorithm and animate layout changes via Framer Motion.
 */

type CardShellProps = {
  readonly id: string;
  readonly rect: Rect;
  readonly highlighted: boolean;
  readonly focused: boolean;
  readonly pulsing: boolean;
  readonly onClick?: () => void;
  readonly onDoubleClick?: () => void;
  readonly children: React.ReactNode;
  readonly tone: "state" | "action" | "computed";
};

const TONE_STYLES: Record<
  "state" | "action" | "computed",
  { dot: string; border: string; glow: string; label: string }
> = {
  state: {
    dot: "var(--color-sig-state)",
    border: "color-mix(in oklch, var(--color-sig-state) 35%, transparent)",
    glow: "var(--color-sig-state)",
    label: "state",
  },
  action: {
    dot: "var(--color-sig-action)",
    border: "color-mix(in oklch, var(--color-sig-action) 40%, transparent)",
    glow: "var(--color-sig-action)",
    label: "action",
  },
  computed: {
    dot: "var(--color-sig-computed)",
    border: "color-mix(in oklch, var(--color-sig-computed) 40%, transparent)",
    glow: "var(--color-sig-computed)",
    label: "computed",
  },
};

function CardShell({
  id,
  rect,
  highlighted,
  focused,
  pulsing,
  onClick,
  onDoubleClick,
  children,
  tone,
}: CardShellProps): JSX.Element {
  const tokens = TONE_STYLES[tone];
  return (
    <div
      data-node-id={id}
      style={{
        width: "100%",
        height: "100%",
        opacity: highlighted ? 1 : 0.28,
        transform: focused ? "scale(1.02)" : undefined,
        transition:
          "opacity 200ms ease-out, transform 180ms ease-out, box-shadow 150ms, border-color 150ms",
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group rounded-lg select-none",
        "flex flex-col overflow-hidden relative",
        "bg-[color-mix(in_oklch,var(--color-void-hi)_85%,transparent)]",
        "backdrop-blur-xl",
      )}
    >
      <div
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{
          border: `1px solid ${focused ? tokens.glow : tokens.border}`,
          boxShadow: focused
            ? `0 0 0 1px ${tokens.glow}, 0 0 24px -4px ${tokens.glow}`
            : highlighted
              ? `0 12px 32px -12px rgba(0,0,0,0.6)`
              : "none",
        }}
      />
      {/* Channel tint strip on top — restates kind silently */}
      <div
        aria-hidden
        className="h-[2px] shrink-0"
        style={{
          background: `linear-gradient(90deg, ${tokens.dot} 0%, transparent 100%)`,
          opacity: focused ? 1 : 0.55,
        }}
      />
      {children}

      {/* Pulse ring — plays once per generation when this node is touched */}
      {pulsing && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0.8, scale: 1 }}
          animate={{ opacity: 0, scale: 1.28 }}
          transition={{ duration: 0.9, ease: [0.2, 0.7, 0.4, 1] }}
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{
            border: `1.5px solid ${tokens.glow}`,
            boxShadow: `0 0 24px ${tokens.glow}`,
          }}
        />
      )}
    </div>
  );
}

type CardHeaderProps = {
  readonly name: string;
  readonly tone: "state" | "action" | "computed";
  readonly trailing?: React.ReactNode;
};

function CardHeader({ name, tone, trailing }: CardHeaderProps): JSX.Element {
  const tokens = TONE_STYLES[tone];
  return (
    <div className="flex items-center gap-1.5 px-3 pt-2">
      <span
        aria-hidden
        className="h-[6px] w-[6px] rounded-full shrink-0"
        style={{
          background: tokens.dot,
          boxShadow: `0 0 8px ${tokens.dot}`,
        }}
      />
      <span
        className="font-mono text-[11.5px] text-[var(--color-ink)] truncate"
        title={name}
      >
        {name}
      </span>
      <span
        className="ml-auto font-sans text-[9px] tracking-[0.06em] uppercase text-[var(--color-ink-mute)]"
        style={{ color: tokens.dot, opacity: 0.7 }}
      >
        {tokens.label}
      </span>
      {trailing}
    </div>
  );
}

// --------------------------------------------------------------------
// StateCard
// --------------------------------------------------------------------

export function StateCard(props: {
  readonly id: string;
  readonly name: string;
  readonly typeLabel: string;
  readonly typeDef?: unknown;
  readonly value: unknown;
  readonly rect: Rect;
  readonly highlighted: boolean;
  readonly focused: boolean;
  readonly pulsing: boolean;
  readonly onClick?: () => void;
  readonly onDoubleClick?: () => void;
}): JSX.Element {
  return (
    <CardShell
      id={props.id}
      rect={props.rect}
      highlighted={props.highlighted}
      focused={props.focused}
      pulsing={props.pulsing}
      tone="state"
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
    >
      <CardHeader name={props.name} tone="state" />
      <div
        className="flex flex-col justify-between flex-1 min-h-0 px-3 pb-2 gap-1"
        data-card-detail
      >
        <div
          className="font-mono text-[10px] text-[var(--color-ink-mute)] truncate"
          title={props.typeLabel}
        >
          {props.typeLabel || "—"}
        </div>
        <ValueView tone="state" value={props.value} typeDef={props.typeDef} />
      </div>
    </CardShell>
  );
}

// --------------------------------------------------------------------
// ComputedCard
// --------------------------------------------------------------------

export function ComputedCard(props: {
  readonly id: string;
  readonly name: string;
  readonly typeLabel: string;
  readonly typeDef?: unknown;
  readonly value: unknown;
  readonly rect: Rect;
  readonly highlighted: boolean;
  readonly focused: boolean;
  readonly pulsing: boolean;
  readonly onClick?: () => void;
  readonly onDoubleClick?: () => void;
}): JSX.Element {
  return (
    <CardShell
      id={props.id}
      rect={props.rect}
      highlighted={props.highlighted}
      focused={props.focused}
      pulsing={props.pulsing}
      tone="computed"
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
    >
      <CardHeader name={props.name} tone="computed" />
      <div
        className="flex flex-col justify-between flex-1 min-h-0 px-3 pb-2 gap-1"
        data-card-detail
      >
        <div className="font-mono text-[10px] text-[var(--color-ink-mute)] truncate">
          {props.typeLabel || "derived"}
        </div>
        <ValueView
          tone="computed"
          value={props.value}
          typeDef={props.typeDef}
        />
      </div>
    </CardShell>
  );
}

// --------------------------------------------------------------------
// ActionCard
// --------------------------------------------------------------------

export function ActionCard(props: {
  readonly id: string;
  readonly name: string;
  readonly argLabel: string;
  readonly dispatchable: boolean | null;
  readonly blockerCount: number;
  readonly rect: Rect;
  readonly highlighted: boolean;
  readonly focused: boolean;
  readonly pulsing: boolean;
  readonly onClick?: () => void;
  readonly onDoubleClick?: () => void;
}): JSX.Element {
  const status =
    props.dispatchable === null
      ? "unknown"
      : props.dispatchable
        ? "ready"
        : "blocked";
  const statusColor =
    status === "ready"
      ? "var(--color-sig-determ)"
      : status === "blocked"
        ? "var(--color-err)"
        : "var(--color-ink-mute)";
  const statusLabel =
    status === "ready"
      ? "dispatchable"
      : status === "blocked"
        ? `${props.blockerCount} blocker${props.blockerCount === 1 ? "" : "s"}`
        : "—";

  return (
    <CardShell
      id={props.id}
      rect={props.rect}
      highlighted={props.highlighted}
      focused={props.focused}
      pulsing={props.pulsing}
      tone="action"
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
    >
      <CardHeader
        name={props.name}
        tone="action"
        trailing={
          <Zap
            className="h-[10px] w-[10px] shrink-0"
            style={{ color: "var(--color-sig-action)", opacity: 0.7 }}
          />
        }
      />
      <div
        className="flex flex-col justify-between flex-1 min-h-0 px-3 pb-2"
        data-card-detail
      >
        <div className="font-mono text-[10px] text-[var(--color-ink-mute)] truncate">
          {props.argLabel || "no input"}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-[5px] w-[5px] rounded-full"
            style={{
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
          <span
            className="font-sans text-[10.5px]"
            style={{ color: statusColor }}
          >
            {statusLabel}
          </span>
        </div>
      </div>
    </CardShell>
  );
}

export { formatType, formatValue };
