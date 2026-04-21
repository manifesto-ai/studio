import { cn } from "@/lib/cn";

/**
 * The Manifesto signature. Everything in Studio is anchored to a
 * snapshot or schema hash; surfacing it in the chrome turns determinism
 * from an invisible guarantee into a visible presence. Used on top bar,
 * panel headers, history timeline, etc.
 */
export function HashChip({
  hash,
  label,
  tone = "violet",
  className,
  title,
}: {
  readonly hash: string | null | undefined;
  readonly label?: string;
  readonly tone?: "violet" | "cyan" | "amber" | "lime";
  readonly className?: string;
  readonly title?: string;
}): JSX.Element {
  const dotColor = {
    violet: "var(--color-violet-hot)",
    cyan: "var(--color-sig-state)",
    amber: "var(--color-sig-action)",
    lime: "var(--color-sig-determ)",
  }[tone];

  const display =
    hash === null || hash === undefined || hash === ""
      ? "— — — — — — — —"
      : hash.slice(0, 8);

  return (
    <span
      title={title ?? hash ?? undefined}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md",
        "bg-[color-mix(in_oklch,var(--color-violet)_8%,transparent)]",
        "border border-[var(--color-glass-edge)]",
        "font-mono text-[10.5px] font-medium tracking-wide",
        "text-[var(--color-ink)]",
        className,
      )}
    >
      <span
        aria-hidden
        className="h-[5px] w-[5px] rounded-full"
        style={{
          background: dotColor,
          boxShadow: `0 0 8px ${dotColor}`,
        }}
      />
      {label !== undefined && (
        <span className="text-[var(--color-ink-dim)] tracking-[0.04em] uppercase text-[10px] font-sans font-medium">
          {label}
        </span>
      )}
      <span>{display}</span>
    </span>
  );
}
