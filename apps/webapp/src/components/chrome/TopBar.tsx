import { useStudio } from "@manifesto-ai/studio-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { ProjectSwitcher } from "@/components/chrome/ProjectSwitcher";

/**
 * Top bar — the observatory's brow. Carries brand mark, project
 * selector, and a determinism indicator. Everything else (marketing,
 * external links) lives elsewhere.
 */
export function TopBar(): JSX.Element {
  const { module, diagnostics } = useStudio();
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

      <ProjectSwitcher />

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
  // Rule P2 (UX philosophy §2.5): the tooltip cites the SDK/MEL
  // fact that underwrites the determinism claim. Wording is not
  // invented — it is a direct restatement of MEL's
  // Non-Turing-completeness guarantee and the SDK legality ladder
  // being reproducible against the current snapshot.
  const explanation =
    status === "ok"
      ? "MEL은 비-튜링 완전 언어입니다. 현 스냅샷에 대한 가용성·디스패치가능성·시뮬레이션 판정은 모두 정적으로 결정되며 재현 가능합니다."
      : status === "err"
        ? "컴파일러가 오류를 보고했습니다. 합법성 판정은 오류가 해결되기 전까지 유효하지 않습니다."
        : "아직 빌드된 모듈이 없습니다. 소스를 빌드하면 결정적 판정이 가능해집니다.";
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`determinism status: ${tone.label}`}
            data-testid="determinism-indicator"
            className="flex items-center gap-1.5 h-7 px-2 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)]"
          >
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
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8} className="max-w-[320px]">
          <div className="flex flex-col gap-1">
            <span className="font-sans text-[11px] font-semibold">
              {tone.label}
            </span>
            <span className="font-sans text-[10.5px] leading-relaxed text-[var(--color-ink-dim)]">
              {explanation}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
