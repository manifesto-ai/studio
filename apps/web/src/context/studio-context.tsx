import { createContext, useContext, type Dispatch } from "react";
import type { Diagnostic } from "@manifesto-ai/compiler";
import type {
  ActionBlockerProjection,
  DomainSchema,
  ObservationRecord,
  ProjectionPreset,
  StudioSession
} from "@manifesto-ai/studio-core";
import type { ManifestoBaseInstance, Snapshot as RuntimeSnapshot } from "@manifesto-ai/sdk";

export type AppRuntime = ManifestoBaseInstance<any>;
export type AppSnapshot = RuntimeSnapshot<Record<string, unknown>>;
export type CompileStatus = "idle" | "compiling" | "ready" | "error";
export type StudioMode = "author" | "observe";

export type StudioState = {
  mode: StudioMode;

  // Compilation (shared)
  source: string;
  autoCompile: boolean;
  compileStatus: CompileStatus;
  compilerDiagnostics: Diagnostic[];
  compiledSource: string;
  compileMessage: string;

  // Schema & Runtime (shared)
  activeSchema: DomainSchema | null;
  liveSnapshot: AppSnapshot | null;

  // Author mode
  selectedNodeId?: string;

  // Observe mode
  selectedActionId?: string;
  fieldValues: Record<string, string>;
  records: ObservationRecord[];
  runtimeMessage: string;
  runtimePending: boolean;
  projectionPreset: ProjectionPreset;
  selectedRecordId?: string;
  selectedTransitionNodeId?: string;
  selectedTransitionEdgeId?: string;
};

export type StudioAction =
  | { type: "SET_MODE"; mode: StudioMode }
  | { type: "SET_SOURCE"; source: string }
  | { type: "SET_AUTO_COMPILE"; enabled: boolean }
  | { type: "COMPILE_START" }
  | {
      type: "COMPILE_SUCCESS";
      schema: DomainSchema;
      source: string;
      diagnostics: Diagnostic[];
      message: string;
      snapshot: AppSnapshot;
    }
  | { type: "COMPILE_ERROR"; diagnostics: Diagnostic[]; message: string }
  | { type: "SELECT_NODE"; nodeId?: string }
  | { type: "SELECT_ACTION"; actionId: string }
  | { type: "SET_FIELD_VALUE"; key: string; value: string }
  | { type: "SET_FIELD_VALUES"; values: Record<string, string> }
  | { type: "EXECUTE_START"; actionId: string }
  | {
      type: "EXECUTE_COMMITTED";
      snapshot: AppSnapshot;
      record: ObservationRecord;
      message: string;
    }
  | {
      type: "EXECUTE_REJECTED";
      record: ObservationRecord;
      message: string;
    }
  | {
      type: "EXECUTE_FAILED";
      snapshot?: AppSnapshot;
      record: ObservationRecord;
      message: string;
    }
  | { type: "SET_RUNTIME_MESSAGE"; message: string }
  | { type: "RESET_RUNTIME"; snapshot: AppSnapshot; message: string }
  | { type: "SET_PROJECTION_PRESET"; preset: ProjectionPreset }
  | { type: "SELECT_RECORD"; recordId?: string }
  | { type: "SELECT_TRANSITION_NODE"; nodeId?: string }
  | { type: "SELECT_TRANSITION_EDGE"; edgeId?: string };

export type StudioRefs = {
  runtime: AppRuntime | null;
  session: StudioSession | null;
};

const StudioStateContext = createContext<StudioState | null>(null);
const StudioDispatchContext = createContext<Dispatch<StudioAction> | null>(null);
const StudioRefsContext = createContext<StudioRefs | null>(null);

export const StudioStateProvider = StudioStateContext.Provider;
export const StudioDispatchProvider = StudioDispatchContext.Provider;
export const StudioRefsProvider = StudioRefsContext.Provider;

export function useStudioState(): StudioState {
  const state = useContext(StudioStateContext);
  if (!state) {
    throw new Error("useStudioState must be used within StudioProvider");
  }
  return state;
}

export function useStudioDispatch(): Dispatch<StudioAction> {
  const dispatch = useContext(StudioDispatchContext);
  if (!dispatch) {
    throw new Error("useStudioDispatch must be used within StudioProvider");
  }
  return dispatch;
}

export function useStudioRefs(): StudioRefs {
  const refs = useContext(StudioRefsContext);
  if (!refs) {
    throw new Error("useStudioRefs must be used within StudioProvider");
  }
  return refs;
}
