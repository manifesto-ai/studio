import { ChevronDown } from "lucide-react";
import { useStudio } from "@manifesto-ai/studio-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import type { FixtureId, Fixture } from "@/fixtures";

/**
 * Top bar — the observatory's brow. Carries brand mark, fixture
 * selection, schema hash, and a determinism indicator. Everything else
 * (marketing, external links) lives elsewhere.
 */
export function TopBar({
  fixtureId,
  onFixtureChange,
  fixtures,
}: {
  readonly fixtureId: FixtureId;
  readonly onFixtureChange: (next: FixtureId) => void;
  readonly fixtures: readonly Fixture[];
}): JSX.Element {
  const { module, diagnostics } = useStudio();
  const active = fixtures.find((f) => f.id === fixtureId) ?? fixtures[0];
  const errors = diagnostics.filter((m) => m.severity === "error").length;
  const status: "ok" | "err" | "idle" =
    module === null ? "idle" : errors > 0 ? "err" : "ok";

  return (
    <header
      className="
        relative z-10 flex items-center gap-3
        h-[44px] px-3
        border-b border-[var(--color-rule)]
        bg-[color-mix(in_oklch,var(--color-void)_70%,transparent)]
        backdrop-blur-2xl
      "
    >
      {/* Brand mark */}
      <div className="flex items-center gap-2">
        <BrandMark />
        <span
          className="font-sans font-semibold text-[13px] tracking-tight text-[var(--color-ink)]"
          style={{ lineHeight: 1 }}
        >
          Manifesto
        </span>
      </div>

      <Separator />

      {/* Fixture breadcrumb */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="
              group flex items-center gap-1 h-7 px-1.5 rounded-md
              font-sans text-[12px] text-[var(--color-ink-dim)]
              hover:text-[var(--color-ink)] hover:bg-[var(--color-glass)]
              transition-colors outline-none
              focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)]
              focus-visible:outline-offset-2
            "
          >
            <span className="text-[var(--color-ink-mute)]">studio</span>
            <span className="text-[var(--color-ink-mute)]">/</span>
            <span className="font-mono text-[11.5px] text-[var(--color-ink)]">
              {active.label}
            </span>
            <ChevronDown className="h-3 w-3 text-[var(--color-ink-mute)] group-hover:text-[var(--color-ink-dim)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Fixture</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={fixtureId}
            onValueChange={(v) => onFixtureChange(v as FixtureId)}
          >
            {fixtures.map((f) => (
              <DropdownMenuRadioItem key={f.id} value={f.id}>
                <span className="font-mono text-[12px]">{f.label}</span>
                {f.hint !== undefined && (
                  <span className="ml-auto font-mono text-[10px] text-[var(--color-ink-mute)]">
                    {f.hint}
                  </span>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Determinism status — minimal, right-aligned */}
      <div className="ml-auto">
        <DeterminismIndicator status={status} />
      </div>
    </header>
  );
}

function Separator(): JSX.Element {
  return <div className="h-4 w-px bg-[var(--color-rule)]" />;
}

function BrandMark(): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 26 26"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <defs>
        <linearGradient id="brandStroke" x1="0" y1="0" x2="26" y2="26">
          <stop offset="0%" stopColor="var(--color-violet-hot)" />
          <stop offset="100%" stopColor="var(--color-sig-state)" />
        </linearGradient>
      </defs>
      <circle
        cx="13"
        cy="13"
        r="10"
        stroke="url(#brandStroke)"
        strokeWidth="1.2"
        opacity="0.9"
      />
      <ellipse
        cx="13"
        cy="13"
        rx="10"
        ry="4.2"
        stroke="url(#brandStroke)"
        strokeWidth="1.2"
        transform="rotate(35 13 13)"
        opacity="0.7"
      />
      <circle cx="13" cy="13" r="1.6" fill="var(--color-violet-hot)" />
    </svg>
  );
}

function DeterminismIndicator({
  status,
}: {
  readonly status: "ok" | "err" | "idle";
}): JSX.Element {
  const tone =
    status === "ok"
      ? {
          dot: "var(--color-sig-determ)",
          label: "deterministic",
          ink: "text-[var(--color-sig-determ)]",
        }
      : status === "err"
        ? {
            dot: "var(--color-err)",
            label: "blocked",
            ink: "text-[var(--color-err)]",
          }
        : {
            dot: "var(--color-ink-mute)",
            label: "idle",
            ink: "text-[var(--color-ink-mute)]",
          };
  return (
    <div className="flex items-center gap-1.5 h-7 px-2">
      <span
        aria-hidden
        className="h-[6px] w-[6px] rounded-full"
        style={{
          background: tone.dot,
          boxShadow: `0 0 8px ${tone.dot}`,
        }}
      />
      <span
        className={`font-sans text-[11px] tracking-tight font-medium ${tone.ink}`}
      >
        {tone.label}
      </span>
    </div>
  );
}
