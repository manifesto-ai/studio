import type { StudioState, StudioAction } from "./studio-context.js";

export function createInitialState(source: string): StudioState {
  return {
    mode: "author",
    source,
    autoCompile: true,
    compileStatus: "idle",
    compilerDiagnostics: [],
    compiledSource: "",
    compileMessage: "Compile the draft to materialize the graph.",
    activeSchema: null,
    liveSnapshot: null,
    selectedNodeId: undefined,
    selectedActionId: undefined,
    fieldValues: {},
    records: [],
    runtimeMessage: "Compile a MEL draft to start a runtime sandbox.",
    runtimePending: false,
    projectionPreset: {
      id: "default",
      name: "Default Lens",
      observe: [],
      groupBy: [],
      options: { includeBlocked: true, includeDryRun: true }
    },
    selectedRecordId: undefined,
    selectedTransitionNodeId: undefined,
    selectedTransitionEdgeId: undefined
  };
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode };

    case "SET_SOURCE":
      return { ...state, source: action.source };

    case "SET_AUTO_COMPILE":
      return { ...state, autoCompile: action.enabled };

    case "COMPILE_START":
      return {
        ...state,
        compileStatus: "compiling",
        compileMessage: "Compiling MEL draft..."
      };

    case "COMPILE_SUCCESS":
      return {
        ...state,
        compileStatus: "ready",
        activeSchema: action.schema,
        compiledSource: action.source,
        compilerDiagnostics: action.diagnostics,
        compileMessage: action.message,
        liveSnapshot: action.snapshot,
        records: [],
        runtimePending: false,
        runtimeMessage: "Runtime reset to the compiled draft.",
        selectedNodeId: state.selectedNodeId,
        selectedActionId: state.selectedActionId
          ? action.schema.actions[state.selectedActionId]
            ? state.selectedActionId
            : Object.keys(action.schema.actions)[0]
          : Object.keys(action.schema.actions)[0],
        fieldValues: {}
      };

    case "COMPILE_ERROR":
      return {
        ...state,
        compileStatus: "error",
        compilerDiagnostics: action.diagnostics,
        compileMessage: action.message,
        liveSnapshot: state.activeSchema ? state.liveSnapshot : null
      };

    case "SELECT_NODE":
      return { ...state, selectedNodeId: action.nodeId };

    case "SELECT_ACTION":
      return { ...state, selectedActionId: action.actionId };

    case "SET_FIELD_VALUE":
      return {
        ...state,
        fieldValues: { ...state.fieldValues, [action.key]: action.value }
      };

    case "SET_FIELD_VALUES":
      return { ...state, fieldValues: action.values };

    case "EXECUTE_START":
      return {
        ...state,
        runtimePending: true,
        runtimeMessage: `Executing ${action.actionId}...`
      };

    case "EXECUTE_COMMITTED":
      return {
        ...state,
        liveSnapshot: action.snapshot,
        runtimePending: false,
        runtimeMessage: action.message,
        records: [...state.records, action.record]
      };

    case "EXECUTE_REJECTED":
      return {
        ...state,
        runtimePending: false,
        runtimeMessage: action.message,
        records: [...state.records, action.record]
      };

    case "EXECUTE_FAILED":
      return {
        ...state,
        liveSnapshot: action.snapshot ?? state.liveSnapshot,
        runtimePending: false,
        runtimeMessage: action.message,
        records: [...state.records, action.record]
      };

    case "SET_RUNTIME_MESSAGE":
      return { ...state, runtimeMessage: action.message };

    case "RESET_RUNTIME":
      return {
        ...state,
        liveSnapshot: action.snapshot,
        records: [],
        runtimePending: false,
        runtimeMessage: action.message
      };

    case "SET_PROJECTION_PRESET":
      return { ...state, projectionPreset: action.preset };

    case "SELECT_RECORD":
      return { ...state, selectedRecordId: action.recordId };

    case "SELECT_TRANSITION_NODE":
      return { ...state, selectedTransitionNodeId: action.nodeId };

    case "SELECT_TRANSITION_EDGE":
      return { ...state, selectedTransitionEdgeId: action.edgeId };
  }
}
