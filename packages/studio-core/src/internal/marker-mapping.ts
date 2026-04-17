import type { Marker } from "../adapter-interface.js";
import type { CompilerDiagnostic } from "./state.js";

export function diagnosticToMarker(diag: CompilerDiagnostic): Marker {
  return {
    severity: diag.severity,
    message: diag.message,
    span: {
      start: diag.location.start,
      end: diag.location.end,
    },
    code: diag.code,
  };
}

export function diagnosticsToMarkers(
  diags: readonly CompilerDiagnostic[],
): Marker[] {
  return diags.map(diagnosticToMarker);
}
