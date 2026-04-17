import type {
  EditorAdapter,
  Listener,
  Marker,
  Unsubscribe,
} from "@manifesto-ai/studio-core";

export type HeadlessOptions = {
  readonly initialSource?: string;
};

export type HeadlessAdapter = EditorAdapter & {
  getPendingSource(): string;
  getMarkersEmitted(): readonly Marker[];
};

export function createHeadlessAdapter(
  options?: HeadlessOptions,
): HeadlessAdapter {
  let pendingSource = options?.initialSource ?? "";
  let markers: readonly Marker[] = [];
  const buildListeners = new Set<Listener>();

  return {
    getSource(): string {
      return pendingSource;
    },
    setSource(source: string): void {
      // SE-BUILD-2: staging only, no build trigger.
      pendingSource = source;
    },
    onBuildRequest(listener: Listener): Unsubscribe {
      buildListeners.add(listener);
      return () => {
        buildListeners.delete(listener);
      };
    },
    requestBuild(): void {
      for (const listener of buildListeners) {
        listener();
      }
    },
    setMarkers(next: readonly Marker[]): void {
      markers = next;
    },
    getPendingSource(): string {
      return pendingSource;
    },
    getMarkersEmitted(): readonly Marker[] {
      return markers;
    },
  };
}
