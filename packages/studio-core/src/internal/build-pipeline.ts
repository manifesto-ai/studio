import { compileMelModule } from "@manifesto-ai/compiler";
import type { EffectHandler } from "@manifesto-ai/sdk";
import type { BuildResult } from "../types/build-result.js";
import type { TraceRecord } from "../types/trace.js";
import { mintBuildId } from "./build-id.js";
import { diagnosticsToMarkers } from "./marker-mapping.js";
import { computePlan, tagTraces, withTraceTagging } from "./reconciler.js";
import { createRuntime, disposeRuntime } from "./runtime-bridge.js";
import { buildOverlaySnapshot } from "./snapshot-overlay.js";
import type { StudioState } from "./state.js";

export type BuildOutput = {
  readonly result: BuildResult;
  readonly nextState: StudioState;
};

export type ExecuteBuildOptions = {
  readonly effects?: Record<string, EffectHandler>;
};

/**
 * Run one build transition.
 *
 * SE-BUILD-1: entry point is explicit trigger only (caller of executeBuild).
 * SE-BUILD-3: compileMelModule call is the single compile step.
 * SE-BUILD-4: on failure, currentModule/runtime/schemaHash are preserved.
 * SE-BUILD-5: on success, a ReconciliationPlan is attached.
 * SE-BUILD-6: runtime's host effects default to `{}`; callers opt in via
 *             `StudioCoreOptions.effects` (Phase 1 seam).
 * SE-RECON-5: plan is generated before apply (pure calculation).
 * SE-RECON-7: if schema hash unchanged, skip runtime swap and reuse prev plan.
 */
export function executeBuild(
  state: StudioState,
  traces: readonly TraceRecord[],
  options?: ExecuteBuildOptions,
): BuildOutput {
  const effects = options?.effects;
  const buildId = mintBuildId();
  const source = state.pendingSource;

  const result = compileMelModule(source, { mode: "module" });

  if (result.errors.length > 0 || result.module === null) {
    const errors = diagnosticsToMarkers(result.errors);
    const warnings = diagnosticsToMarkers(result.warnings);
    const merged: readonly typeof errors[number][] = [...errors, ...warnings];
    return {
      result: { kind: "fail", buildId, errors, warnings },
      nextState: {
        ...state,
        currentDiagnostics: [...result.errors, ...result.warnings],
        currentMarkers: merged,
        buildSeq: state.buildSeq + 1,
        currentBuildId: buildId,
      },
    };
  }

  const nextModule = result.module;
  const nextSchemaHash = nextModule.schema.hash;
  const warnings = diagnosticsToMarkers(result.warnings);

  const basePlan = computePlan(state.currentModule, nextModule);
  const traceTag = tagTraces(traces, nextModule);
  const plan = withTraceTagging(basePlan, traceTag);

  const canSkipSwap =
    state.currentSchemaHash === nextSchemaHash && state.runtime !== null;

  if (canSkipSwap) {
    return {
      result: {
        kind: "ok",
        buildId,
        module: nextModule,
        schemaHash: nextSchemaHash,
        plan,
        warnings,
      },
      nextState: {
        ...state,
        currentModule: nextModule,
        currentDiagnostics: result.warnings,
        currentMarkers: warnings,
        lastPlan: plan,
        buildSeq: state.buildSeq + 1,
        currentBuildId: buildId,
      },
    };
  }

  const prevCanonical = state.runtime?.getCanonicalSnapshot() ?? null;
  disposeRuntime(state.runtime);

  let nextRuntime;
  if (prevCanonical === null) {
    nextRuntime = createRuntime(nextModule, { effects });
  } else {
    const freshRuntime = createRuntime(nextModule, { effects });
    const freshCanonical = freshRuntime.getCanonicalSnapshot();
    const overlay = buildOverlaySnapshot(prevCanonical, freshCanonical, plan);
    disposeRuntime(freshRuntime);
    nextRuntime = createRuntime(nextModule, {
      effects,
      initialSnapshot: overlay,
    });
  }

  return {
    result: {
      kind: "ok",
      buildId,
      module: nextModule,
      schemaHash: nextSchemaHash,
      plan,
      warnings,
    },
    nextState: {
      ...state,
      currentModule: nextModule,
      currentSchemaHash: nextSchemaHash,
      currentDiagnostics: result.warnings,
      currentMarkers: warnings,
      runtime: nextRuntime,
      lastPlan: plan,
      buildSeq: state.buildSeq + 1,
      currentBuildId: buildId,
    },
  };
}
