import {
  createStudioCore,
  type EditorAdapter,
  type Listener,
  type Marker,
  type StudioCore,
  type Unsubscribe,
} from "@manifesto-ai/studio-core";
import { MEL_AUTHOR_AGENT_MEL } from "./agent-domain.js";
import type {
  MelAuthorLifecycle,
  MelAuthorLifecycleResult,
  MelAuthorLineageOutput,
} from "./types.js";

export type CreateMelAuthorLifecycleInput = {
  readonly request: string;
  readonly workspaceId?: string;
};

export async function createMelAuthorLifecycle(
  input: CreateMelAuthorLifecycleInput,
): Promise<MelAuthorLifecycle> {
  const core = createStudioCore();
  core.attach(createMemoryAdapter(MEL_AUTHOR_AGENT_MEL));
  const build = await core.build();
  if (build.kind !== "ok") {
    throw new Error(
      `MEL Author lifecycle domain failed to build with ${build.errors.length} error${build.errors.length === 1 ? "" : "s"}.`,
    );
  }

  const workspaceId =
    input.workspaceId ?? `author-workspace:${stableHash(input.request)}`;
  await dispatch(core, "start", input.request, workspaceId);

  return {
    recordReadSource: () => dispatch(core, "recordReadSource"),
    recordMutationAttempt: (toolName, changed) =>
      dispatch(core, "recordMutationAttempt", toolName, changed),
    recordBuild: (status, diagnosticCount) =>
      dispatch(core, "recordBuild", status, diagnosticCount),
    recordGuideSearch: () => dispatch(core, "recordGuideSearch"),
    recordInspection: (toolName) =>
      dispatch(core, "recordInspection", toolName),
    recordSimulation: () => dispatch(core, "recordSimulation"),
    recordToolError: (toolName) => dispatch(core, "recordToolError", toolName),
    markStalled: (reason) => dispatch(core, "markStalled", reason),
    retry: () => dispatch(core, "retry"),
    giveUp: (reason) => dispatch(core, "giveUp", reason),
    recordFinalize: (proposalId) => dispatch(core, "finalize", proposalId),
    getLineage: () => lineageOutput(core),
  };
}

async function dispatch(
  core: StudioCore,
  action: string,
  ...args: readonly unknown[]
): Promise<MelAuthorLifecycleResult> {
  try {
    const result = await core.dispatchAsync(core.createIntent(action, ...args));
    if (result.kind === "completed") {
      return { ok: true, action, kind: result.kind };
    }
    return {
      ok: false,
      action,
      kind: result.kind,
      message: `Author lifecycle action "${action}" was ${result.kind}.`,
    };
  } catch (err) {
    return {
      ok: false,
      action,
      kind: "thrown",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function lineageOutput(core: StudioCore): MelAuthorLineageOutput {
  const lineage = core.getLineage();
  return {
    lineage,
    snapshot: core.getSnapshot(),
    worldCount: lineage.worlds.length,
    headWorldId: lineage.head?.worldId ?? null,
  };
}

function createMemoryAdapter(initialSource: string): EditorAdapter {
  let source = initialSource;
  let markers: readonly Marker[] = [];
  const listeners = new Set<Listener>();
  void markers;
  return {
    getSource: () => source,
    setSource: (next) => {
      source = next;
    },
    onBuildRequest: (listener): Unsubscribe => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    requestBuild: () => {
      for (const listener of listeners) listener();
    },
    setMarkers: (next) => {
      markers = next;
    },
  };
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
