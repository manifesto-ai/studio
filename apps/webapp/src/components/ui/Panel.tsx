import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Panel — the "observation viewport" metaphor. A glass surface that
 * reveals the core it observes. Header uses the mono channel label.
 */
export const Panel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Panel({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "glass",
          "flex flex-col min-h-0 min-w-0 relative",
          "w-full h-full",
          className,
        )}
        {...props}
      />
    );
  },
);

export function PanelHeader({
  children,
  right,
  className,
  channel,
}: {
  readonly children: ReactNode;
  readonly right?: ReactNode;
  readonly className?: string;
  readonly channel?: "state" | "action" | "computed" | "effect" | "determ";
}): JSX.Element {
  const channelDot: Record<string, string> = {
    state: "var(--color-sig-state)",
    action: "var(--color-sig-action)",
    computed: "var(--color-sig-computed)",
    effect: "var(--color-sig-effect)",
    determ: "var(--color-sig-determ)",
  };
  const dotColor = channel !== undefined ? channelDot[channel] : undefined;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-3.5 py-2.5",
        "border-b border-[var(--color-rule)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {dotColor !== undefined && (
          <span
            aria-hidden
            className="h-[7px] w-[7px] rounded-full shrink-0"
            style={{
              background: dotColor,
              boxShadow: `0 0 10px ${dotColor}`,
            }}
          />
        )}
        <span className="label-channel truncate">{children}</span>
      </div>
      {right !== undefined && (
        <div className="flex items-center gap-1.5 shrink-0">{right}</div>
      )}
    </div>
  );
}

export function PanelBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <div className={cn("flex-1 min-h-0 min-w-0", className)}>{children}</div>
  );
}
