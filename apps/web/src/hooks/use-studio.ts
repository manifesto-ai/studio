import { useMemo } from "react";
import {
  projectTransitionGraph,
  type DomainGraphProjection,
  type FindingsReportProjection,
  type ActionAvailabilityProjection,
  type ActionBlockerProjection,
  type TransitionGraphProjection
} from "@manifesto-ai/studio-core";

import {
  useStudioState,
  useStudioRefs,
  type StudioRefs
} from "../context/studio-context.js";
import {
  buildActionSpecs,
  buildSchemaTree,
  type ActionSpec,
  type SchemaTreeItem
} from "../authoring.js";

type StudioImperativeRefs = StudioRefs & {
  compile: (source: string, reason: "auto" | "manual") => void;
  execute: (actionId: string, args: unknown[]) => Promise<void>;
  resetRuntime: () => void;
};

export function useStudioActions(): StudioImperativeRefs {
  return useStudioRefs() as StudioImperativeRefs;
}

export function useGraph(): DomainGraphProjection | null {
  const state = useStudioState();
  const { session } = useStudioRefs();
  const snapshotVersion = state.liveSnapshot?.meta.version ?? -1;

  return useMemo(
    () => (session ? session.getGraph("full") : null),
    [session, snapshotVersion]
  );
}

export function useFindings(): FindingsReportProjection | null {
  const state = useStudioState();
  const { session } = useStudioRefs();
  const snapshotVersion = state.liveSnapshot?.meta.version ?? -1;

  return useMemo(
    () => (session ? session.getFindings() : null),
    [session, snapshotVersion]
  );
}

export function useActionAvailability(): ActionAvailabilityProjection[] {
  const state = useStudioState();
  const { session } = useStudioRefs();
  const snapshotVersion = state.liveSnapshot?.meta.version ?? -1;

  return useMemo(
    () => (session ? session.getActionAvailability() : []),
    [session, snapshotVersion]
  );
}

export function useActionSpecs(): ActionSpec[] {
  const state = useStudioState();
  const availability = useActionAvailability();

  return useMemo(
    () => (state.activeSchema ? buildActionSpecs(state.activeSchema, availability) : []),
    [state.activeSchema, availability]
  );
}

export function useBlocker(actionId?: string): ActionBlockerProjection {
  const state = useStudioState();
  const { session } = useStudioRefs();
  const snapshotVersion = state.liveSnapshot?.meta.version ?? -1;

  return useMemo(
    () =>
      session && actionId
        ? session.explainActionBlocker(actionId)
        : ({
            status: "not-provided",
            actionId: actionId ?? "unknown",
            summary: "Compile a valid MEL draft to inspect action guards."
          } as ActionBlockerProjection),
    [actionId, session, snapshotVersion]
  );
}

export function useSchemaTree(): SchemaTreeItem[] {
  const state = useStudioState();

  return useMemo(
    () => (state.activeSchema ? buildSchemaTree(state.activeSchema) : []),
    [state.activeSchema]
  );
}

export function useTransitionGraph(): TransitionGraphProjection {
  const state = useStudioState();

  return useMemo(
    () =>
      projectTransitionGraph(state.records, state.projectionPreset, {
        currentSnapshot: state.liveSnapshot ?? undefined
      }),
    [state.records, state.projectionPreset, state.liveSnapshot]
  );
}
