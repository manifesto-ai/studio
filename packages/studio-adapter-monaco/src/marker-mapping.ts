import type { Marker, SourceSpan } from "@manifesto-ai/studio-core";

/**
 * Minimal shape of Monaco's IMarkerData that we rely on.
 * Using a local type keeps us decoupled from the monaco-editor types package
 * at compile time — runtime the field names match.
 */
export type MonacoMarkerData = {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  code?: string;
};

/**
 * Mirror of `monaco.MarkerSeverity`. Monaco assigns numeric ids; using the
 * same numbers here avoids importing monaco at build time in this package.
 *   Hint = 1, Info = 2, Warning = 4, Error = 8
 */
export const MONACO_SEVERITY = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8,
} as const;

function severityFor(severity: Marker["severity"]): number {
  switch (severity) {
    case "error":
      return MONACO_SEVERITY.Error;
    case "warning":
      return MONACO_SEVERITY.Warning;
    case "info":
      return MONACO_SEVERITY.Info;
  }
}

/**
 * Convert a Studio `SourceSpan` (1-based line/column, UTF-16 units from the
 * compiler) into Monaco's 1-based line/column range. The two systems align
 * directly, so this is mostly a field rename with a defensive clamp at line
 * or column 0 (compiler has been observed to emit `column: 0` for zero-width
 * diagnostics; Monaco wants `>= 1`).
 */
export function spanToMonacoRange(span: SourceSpan): Pick<
  MonacoMarkerData,
  "startLineNumber" | "startColumn" | "endLineNumber" | "endColumn"
> {
  const s = Math.max(1, span.start.column);
  const e = Math.max(s, span.end.column);
  return {
    startLineNumber: Math.max(1, span.start.line),
    startColumn: s,
    endLineNumber: Math.max(1, span.end.line),
    endColumn: e,
  };
}

export function markerToMonaco(marker: Marker): MonacoMarkerData {
  return {
    severity: severityFor(marker.severity),
    message: marker.message,
    ...spanToMonacoRange(marker.span),
    ...(marker.code !== undefined ? { code: marker.code } : {}),
  };
}

export function markersToMonaco(markers: readonly Marker[]): MonacoMarkerData[] {
  return markers.map(markerToMonaco);
}
