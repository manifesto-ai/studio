import { forwardRef, useMemo } from "react";
import { CircleAlert, Command, TriangleAlert } from "lucide-react";
import { useStudio } from "@manifesto-ai/studio-react";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import type { Fixture } from "@/fixtures";

/**
 * SourcePane — wraps the Monaco host div in a glass viewport.
 *
 * IMPORTANT: The host div is forwarded via ref; it must NEVER remount
 * once Monaco is attached. App.tsx enforces that by keeping the ref
 * stable across adapter transitions. We only reparent the *chrome*,
 * not the editor surface.
 */
export const SourcePane = forwardRef<HTMLDivElement, { readonly fixture: Fixture }>(
  function SourcePane({ fixture }, hostRef) {
    const { module, diagnostics } = useStudio();

    const { errors, warnings } = useMemo(() => {
      let e = 0;
      let w = 0;
      for (const m of diagnostics) {
        if (m.severity === "error") e += 1;
        else if (m.severity === "warning") w += 1;
      }
      return { errors: e, warnings: w };
    }, [diagnostics]);

    return (
      <Panel className="overflow-hidden">
        <PanelHeader
          channel="computed"
          right={<KeyHintChip label="⌘ S" action="Build" />}
        >
          <span>Source</span>
        </PanelHeader>

        <PanelBody className="relative flex flex-col">
          {/* Editor surface — stable, never re-parented. Full bleed to
           * the panel edges so the Monaco gutter reads as intrinsic. */}
          <div ref={hostRef} className="flex-1 min-h-0" />
          <SourceFooter
            errors={errors}
            warnings={warnings}
            moduleLoaded={module !== null}
          />
        </PanelBody>
      </Panel>
    );
  },
);

function KeyHintChip({
  label,
  action,
}: {
  readonly label: string;
  readonly action: string;
}): JSX.Element {
  return (
    <Button variant="chip" size="xs" className="pointer-events-none gap-1.5">
      <Command className="h-[10px] w-[10px] text-[var(--color-ink-dim)]" />
      <span className="font-mono text-[10px] tracking-wide text-[var(--color-ink-dim)]">
        {label}
      </span>
      <span className="text-[var(--color-ink-mute)] text-[10px]">{action}</span>
    </Button>
  );
}

function SourceFooter({
  errors,
  warnings,
  moduleLoaded,
}: {
  readonly errors: number;
  readonly warnings: number;
  readonly moduleLoaded: boolean;
}): JSX.Element {
  return (
    <div
      className="
        flex items-center gap-4 px-3.5 py-2
        border-t border-[var(--color-rule)]
        bg-[color-mix(in_oklch,var(--color-void)_40%,transparent)]
        font-mono text-[10.5px]
      "
    >
      <DiagStat
        count={errors}
        Icon={CircleAlert}
        label="error"
        tone="var(--color-err)"
      />
      <DiagStat
        count={warnings}
        Icon={TriangleAlert}
        label="warn"
        tone="var(--color-warn)"
      />
      <span className="ml-auto text-[var(--color-ink-mute)]">
        {moduleLoaded ? "module compiled" : "awaiting first build"}
      </span>
    </div>
  );
}

function DiagStat({
  count,
  Icon,
  label,
  tone,
}: {
  readonly count: number;
  readonly Icon: typeof CircleAlert;
  readonly label: string;
  readonly tone: string;
}): JSX.Element {
  const active = count > 0;
  return (
    <div className="flex items-center gap-1.5">
      <Icon
        className="h-[11px] w-[11px]"
        style={{ color: active ? tone : "var(--color-ink-mute)" }}
      />
      <span
        className="text-[var(--color-ink)]"
        style={{ color: active ? tone : "var(--color-ink-dim)" }}
      >
        {count}
      </span>
      <span className="text-[var(--color-ink-mute)]">
        {label}
        {count === 1 ? "" : "s"}
      </span>
    </div>
  );
}
