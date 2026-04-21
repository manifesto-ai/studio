import type { SourceSpan } from "@manifesto-ai/compiler";

export type Unsubscribe = () => void;
export type Listener = () => void;

export type Marker = {
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly span: SourceSpan;
  readonly code?: string;
};

export type EditorAdapter = {
  getSource(): string;
  setSource(source: string): void;
  onBuildRequest(listener: Listener): Unsubscribe;
  requestBuild(): void;
  setMarkers(markers: readonly Marker[]): void;
};

export type { SourceSpan };
