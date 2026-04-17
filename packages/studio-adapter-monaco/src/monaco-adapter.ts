import type {
  EditorAdapter,
  Listener,
  Marker,
  Unsubscribe,
} from "@manifesto-ai/studio-core";
import { markersToMonaco, type MonacoMarkerData } from "./marker-mapping.js";

/**
 * Minimal duck-typed shape of the monaco editor + namespace we rely on.
 * Keeping a local structural type keeps studio-adapter-monaco decoupled
 * from monaco-editor type imports (monaco-editor is a peer dep and lives
 * in the consuming app's bundle, not ours).
 *
 * The `model` argument is typed `any` on purpose — monaco's real
 * `setModelMarkers` takes `ITextModel`, and using `any` here lets callers
 * pass `typeof monaco` in directly (variance-friendly) without having to
 * cast. We never introspect the model, only forward it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

export interface MonacoLike {
  readonly editor: {
    readonly setModelMarkers: (
      model: AnyModel,
      owner: string,
      markers: MonacoMarkerData[],
    ) => void;
  };
}

export interface MonacoEditorLike {
  readonly getValue: () => string;
  readonly setValue: (value: string) => void;
  readonly getModel: () => AnyModel;
  readonly onDidChangeModelContent: (
    listener: () => void,
  ) => { dispose: () => void };
}

export type CreateMonacoAdapterOptions = {
  readonly editor: MonacoEditorLike;
  /**
   * Monaco's `editor.setModelMarkers` is keyed by `(model, owner)` pairs.
   * Using a stable owner string lets multiple editor instances share a
   * model without stepping on each other's diagnostics.
   */
  readonly markerOwner?: string;
  /**
   * Usually `monaco.editor` from `import * as monaco from "monaco-editor"`,
   * or the namespace your consuming app exposes. Passed in rather than
   * imported so tests (and custom bundler setups) can swap it out.
   */
  readonly monaco: MonacoLike;
};

export type MonacoAdapter = EditorAdapter & {
  /**
   * Dispose internal Monaco listeners. Does NOT dispose the editor itself —
   * that's the caller's responsibility (same as studio-core's `detach`).
   */
  readonly dispose: () => void;
};

const DEFAULT_MARKER_OWNER = "studio-core";

export function createMonacoAdapter(
  options: CreateMonacoAdapterOptions,
): MonacoAdapter {
  const { editor, monaco } = options;
  const markerOwner = options.markerOwner ?? DEFAULT_MARKER_OWNER;

  const buildListeners = new Set<Listener>();
  // loop-suppression (per docs/monaco-adapter-sketch.md §4): any value we
  // write via setSource() must not fire buildListeners on its way back.
  let suppressChangeDepth = 0;

  // We do NOT subscribe to `onDidChangeModelContent` for `requestBuild`
  // today — SE-BUILD-1 / SE-UI-2 say build is explicit. The change event
  // subscription is kept around purely to count loop-suppression depth if
  // a consumer wires up their own auto-build strategy downstream.
  const changeSub = editor.onDidChangeModelContent(() => {
    if (suppressChangeDepth > 0) return;
    // Intentionally silent — consumers wire build via requestBuild() or
    // their own keybinding. See adapter sketch §4.
  });

  let disposed = false;

  return {
    getSource(): string {
      return editor.getValue();
    },
    setSource(source: string): void {
      // SE-BUILD-2 / SE-UI-2: staging only, no build trigger. The
      // suppress guard prevents a loop if a future auto-build handler
      // observes the change event.
      suppressChangeDepth += 1;
      try {
        editor.setValue(source);
      } finally {
        suppressChangeDepth -= 1;
      }
    },
    onBuildRequest(listener: Listener): Unsubscribe {
      buildListeners.add(listener);
      return () => {
        buildListeners.delete(listener);
      };
    },
    requestBuild(): void {
      // Called by the host UI (e.g. CTRL-S keybinding or Build button).
      // SE-BUILD-1: build is explicit.
      for (const listener of buildListeners) listener();
    },
    setMarkers(markers: readonly Marker[]): void {
      const model = editor.getModel();
      if (model === null || model === undefined) return;
      monaco.editor.setModelMarkers(model, markerOwner, markersToMonaco(markers));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      changeSub.dispose();
      buildListeners.clear();
      // Clear markers on dispose so a detached editor doesn't show stale
      // diagnostics forever.
      const model = editor.getModel();
      if (model !== null && model !== undefined) {
        monaco.editor.setModelMarkers(model, markerOwner, []);
      }
    },
  };
}
