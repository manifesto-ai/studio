import { useMemo } from "react";
import { Orbit, Clock } from "lucide-react";
import {
  buildGraphModel,
  useStudio,
} from "@manifesto-ai/studio-react";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { LiveGraph } from "@/components/graph/LiveGraph";
import { useTimeScrub } from "@/hooks/useTimeScrub";

/**
 * ObservatoryPane — the central instrument. Renders the domain as a
 * live graph of cards: each state / computed node shows its current
 * value, each action node shows dispatchability. Clicking an action
 * opens a dispatch popover; a new envelope animates a propagation
 * pulse from the origin through its downstream cascade.
 */
export function ObservatoryPane(): JSX.Element {
  const { module: liveModule, plan } = useStudio();
  const { state: scrub, returnToNow } = useTimeScrub();

  // In past mode, the graph is built from the replayed module so it
  // shows the domain as it was at that envelope. The reconciliation
  // plan is not replayed (it lives on live state), so snapshot-fate
  // overlays only apply live.
  const effectiveModule =
    scrub.mode === "past" ? scrub.module : liveModule;
  const effectivePlan = scrub.mode === "past" ? null : plan;

  const graphModel = useMemo(
    () => buildGraphModel(effectiveModule, effectivePlan),
    [effectiveModule, effectivePlan],
  );

  const hasGraph =
    graphModel !== null && graphModel.nodes.length > 0;
  const isPast = scrub.mode === "past";

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        channel="state"
        right={
          isPast ? (
            <Button
              variant="solid"
              size="xs"
              onClick={returnToNow}
              className="gap-1.5"
            >
              <Clock className="h-[10px] w-[10px]" />
              viewing past · return to now
            </Button>
          ) : undefined
        }
      >
        <span>Observatory</span>
      </PanelHeader>

      <PanelBody className="relative">
        {hasGraph ? (
          <LiveGraph
            model={graphModel}
            snapshotOverride={
              scrub.mode === "past" ? scrub.snapshot : undefined
            }
            disableDispatch={isPast}
          />
        ) : (
          <EmptyObservatory />
        )}
        {isPast && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-[var(--color-violet-hot)] opacity-30"
          />
        )}
      </PanelBody>
    </Panel>
  );
}

function EmptyObservatory(): JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center max-w-[360px]">
        <div className="relative">
          <div
            className="
              h-16 w-16 rounded-full
              border border-[var(--color-glass-edge)]
              bg-[var(--color-glass)]
              flex items-center justify-center
            "
          >
            <Orbit className="h-6 w-6 text-[var(--color-violet)] opacity-60" />
          </div>
          <div
            aria-hidden
            className="
              absolute inset-0 rounded-full
              animate-ping
              border border-[var(--color-violet)]
              opacity-20
            "
          />
        </div>
        <div className="font-sans font-medium text-[14px] text-[var(--color-ink)]">
          Awaiting module
        </div>
        <div className="font-sans text-[12px] leading-relaxed text-[var(--color-ink-mute)] max-w-[280px]">
          Press{" "}
          <span className="font-mono text-[11.5px] text-[var(--color-ink)]">
            ⌘S
          </span>{" "}
          in the source pane to compile. Nodes appear as live cards
          showing state values, computed results, and dispatchable
          actions.
        </div>
      </div>
    </div>
  );
}
