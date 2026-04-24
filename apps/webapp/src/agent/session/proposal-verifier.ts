import {
  createStudioCore,
  type BuildResult,
  type EditorAdapter,
  type Listener,
  type Marker,
  type SourceSpan,
  type Unsubscribe,
} from "@manifesto-ai/studio-core";

export type ProposalDiagnostic = {
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly code?: string;
};

export type ProposalVerification = {
  readonly status: "verified" | "invalid";
  readonly diagnostics: readonly ProposalDiagnostic[];
  readonly schemaHash: string | null;
  readonly summary: string;
};

const RESERVED_NAMESPACES = ["$host", "$mel", "$system"] as const;

export async function verifyMelProposal(
  proposedSource: string,
): Promise<ProposalVerification> {
  const lintDiagnostics = lintReservedNamespaces(proposedSource);
  if (lintDiagnostics.length > 0) {
    return {
      status: "invalid",
      diagnostics: lintDiagnostics,
      schemaHash: null,
      summary: "proposal uses reserved Manifesto namespace identifiers",
    };
  }

  const adapter = createMemoryAdapter(proposedSource);
  const core = createStudioCore();
  const detach = core.attach(adapter);
  try {
    const result = await core.build();
    return verificationFromBuildResult(result);
  } finally {
    detach();
  }
}

function verificationFromBuildResult(
  result: BuildResult,
): ProposalVerification {
  if (result.kind === "ok") {
    return {
      status: "verified",
      diagnostics: result.warnings.map(markerToDiagnostic),
      schemaHash: result.schemaHash,
      summary:
        result.warnings.length === 0
          ? "proposal builds cleanly"
          : `proposal builds with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`,
    };
  }
  return {
    status: "invalid",
    diagnostics: [...result.errors, ...result.warnings].map(markerToDiagnostic),
    schemaHash: null,
    summary: `proposal failed to build with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`,
  };
}

function lintReservedNamespaces(source: string): readonly ProposalDiagnostic[] {
  const diagnostics: ProposalDiagnostic[] = [];
  for (const name of RESERVED_NAMESPACES) {
    for (const offset of findReservedDeclarationOffsets(source, name)) {
      const point = pointAtOffset(source, offset);
      diagnostics.push({
        severity: "error",
        message: `reserved namespace "${name}" cannot be declared by domain MEL`,
        line: point.line,
        column: point.column,
        code: "agent/reserved-namespace",
      });
    }
  }
  return diagnostics;
}

function findReservedDeclarationOffsets(
  source: string,
  name: string,
): readonly number[] {
  const escaped = name.replace("$", "\\$");
  const patterns = [
    new RegExp(`\\b(?:domain|type|computed|action)\\s+(${escaped})\\b`, "g"),
    new RegExp(`^\\s*(${escaped})\\s*:`, "gm"),
    new RegExp(`\\{\\s*(${escaped})\\s*:`, "g"),
  ];
  const offsets: number[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const found = match[1];
      if (found === undefined) continue;
      offsets.push(match.index + match[0].indexOf(found));
    }
  }
  return offsets;
}

function markerToDiagnostic(marker: Marker): ProposalDiagnostic {
  return {
    severity: marker.severity,
    message: marker.message,
    line: marker.span.start.line,
    column: marker.span.start.column,
    code: marker.code,
  };
}

function pointAtOffset(
  source: string,
  targetOffset: number,
): { readonly line: number; readonly column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < source.length && i < targetOffset; i++) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
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

export function spanFromDiagnostic(
  d: ProposalDiagnostic,
): SourceSpan {
  return {
    start: { line: d.line, column: d.column },
    end: { line: d.line, column: d.column + 1 },
  };
}
