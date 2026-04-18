export {
  createMonacoAdapter,
  type CreateMonacoAdapterOptions,
  type MonacoAdapter,
  type MonacoEditorLike,
  type MonacoLike,
} from "./monaco-adapter.js";

export {
  markerToMonaco,
  markersToMonaco,
  spanToMonacoRange,
  MONACO_SEVERITY,
  type MonacoMarkerData,
} from "./marker-mapping.js";

export {
  MEL_LANGUAGE_ID,
  registerMelLanguage,
  type MonacoLanguageApiLike,
} from "./language.js";
