import { createManifesto, DisposedError } from "@manifesto-ai/sdk";
import type { CanonicalSnapshot, EffectHandler } from "@manifesto-ai/sdk";
import type { DomainModule } from "@manifesto-ai/compiler";
// `@manifesto-ai/sdk/provider` is the documented public seam for provider /
// decorator authors. Studio uses it to compose a base runtime around a kernel
// that has been hydrated with a preserved canonical snapshot (SC-3).
import {
  activateComposable,
  createBaseRuntimeInstance,
  getRuntimeKernelFactory,
  type RuntimeKernel,
} from "@manifesto-ai/sdk/provider";
import type { OpaqueRuntime } from "./state.js";

type CoreSnapshot = Parameters<RuntimeKernel<never>["setVisibleSnapshot"]>[0];

export type CreateRuntimeOptions = {
  readonly initialSnapshot?: CanonicalSnapshot<unknown>;
  readonly effects?: Record<string, EffectHandler>;
};

/**
 * Create an SDK activated runtime from a compiled module.
 *
 * Defaults: `effects = {}` (preserves Phase 0 SE-BUILD-6 guarantee for
 * callers that do not opt in via `StudioCoreOptions.effects`).
 *
 * Optional `initialSnapshot` hydrates the kernel before wrapping as base
 * instance — used by the reconciler's snapshot preservation path.
 */
export function createRuntime(
  module: DomainModule,
  options?: CreateRuntimeOptions,
): OpaqueRuntime {
  const effects = options?.effects ?? {};
  const initialSnapshot = options?.initialSnapshot;

  // DomainSchema shapes from @manifesto-ai/compiler and @manifesto-ai/sdk
  // are structurally compatible. Assert via unknown to cross the boundary.
  const composable = createManifesto(
    module.schema as unknown as Parameters<typeof createManifesto>[0],
    effects,
  );

  const factory = getRuntimeKernelFactory(composable);
  const kernel = factory();
  activateComposable(composable);

  if (initialSnapshot !== undefined) {
    kernel.setVisibleSnapshot(initialSnapshot as CoreSnapshot, { notify: false });
  }

  return createBaseRuntimeInstance(kernel) as unknown as OpaqueRuntime;
}

/**
 * Safely dispose a runtime. Idempotent against DisposedError.
 */
export function disposeRuntime(runtime: OpaqueRuntime | null): void {
  if (runtime === null) return;
  try {
    runtime.dispose();
  } catch (err) {
    if (err instanceof DisposedError) return;
    throw err;
  }
}
