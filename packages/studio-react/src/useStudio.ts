import { useContext, useMemo } from "react";
import type {
  DomainModule,
  Marker,
  ReconciliationPlan,
  Snapshot,
} from "./type-imports.js";
import type { WorldLineage } from "@manifesto-ai/studio-core";
import { StudioContext, type StudioContextValue } from "./StudioProvider.js";

export type UseStudioValue = StudioContextValue & {
  /**
   * Current compiled module (null before the first successful build).
   * Read-through to `core.getModule()` — re-evaluated whenever
   * `version` bumps.
   */
  readonly module: DomainModule | null;
  readonly snapshot: Snapshot<unknown> | null;
  readonly plan: ReconciliationPlan | null;
  readonly diagnostics: readonly Marker[];
  /** Synthetic Merkle-ish world chain. Pillar 4. */
  readonly lineage: WorldLineage;
};

export function useStudio(): UseStudioValue {
  const ctx = useContext(StudioContext);
  if (ctx === null) {
    throw new Error(
      "[studio-react] useStudio must be used inside <StudioProvider>",
    );
  }
  const { core, version } = ctx;
  return useMemo<UseStudioValue>(
    () => ({
      ...ctx,
      module: core.getModule(),
      snapshot: core.getSnapshot(),
      plan: core.getLastReconciliationPlan(),
      diagnostics: core.getDiagnostics(),
      lineage: core.getLineage(),
    }),
    // `version` is the cache key — bumping it invalidates all four reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, version],
  );
}
