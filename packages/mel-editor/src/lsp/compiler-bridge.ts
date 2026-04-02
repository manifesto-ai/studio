/**
 * Compiler Bridge
 *
 * Wraps compileMelDomain() with:
 * - Diagnostic format conversion (1-based → 0-based)
 * - Last-good schema caching per file
 */

import { compileMelDomain } from "@manifesto-ai/compiler";
import type {
  CompileMelDomainResult,
  Diagnostic as MelDiagnostic,
  DomainSchema,
} from "@manifesto-ai/compiler";
import {
  Diagnostic as LspDiagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver/browser.js";

interface CompilationState {
  lastResult: CompileMelDomainResult | null;
  lastGoodSchema: DomainSchema | null;
  version: number;
}

export class CompilerBridge {
  private cache = new Map<string, CompilationState>();

  /**
   * Compile MEL text and return LSP diagnostics.
   * Caches the last-good schema for autocompletion.
   */
  compile(uri: string, text: string, version: number): LspDiagnostic[] {
    const result = compileMelDomain(text, { mode: "domain" });

    const state = this.cache.get(uri) ?? {
      lastResult: null,
      lastGoodSchema: null,
      version: 0,
    };

    state.lastResult = result;
    state.version = version;

    // Update last-good schema on success
    if (result.schema) {
      state.lastGoodSchema = result.schema;
    }

    this.cache.set(uri, state);

    // Convert all diagnostics to LSP format
    const diagnostics: LspDiagnostic[] = [
      ...result.errors.map(toLspDiagnostic),
      ...result.warnings.map(toLspDiagnostic),
    ];

    return diagnostics;
  }

  /** Get the last successfully compiled schema (for autocompletion) */
  getSchema(uri: string): DomainSchema | null {
    return this.cache.get(uri)?.lastGoodSchema ?? null;
  }

  /** Get the raw compilation result */
  getLastResult(uri: string): CompileMelDomainResult | null {
    return this.cache.get(uri)?.lastResult ?? null;
  }

  /** Remove cached state for a closed file */
  remove(uri: string): void {
    this.cache.delete(uri);
  }
}

function toLspDiagnostic(diag: MelDiagnostic): LspDiagnostic {
  const startLine = Math.max(0, diag.location.start.line - 1);
  const startChar = Math.max(0, diag.location.start.column - 1);
  const endLine = Math.max(0, diag.location.end.line - 1);
  const endChar = Math.max(0, diag.location.end.column - 1);

  const lspDiag: LspDiagnostic = {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    severity: toSeverity(diag.severity),
    source: "mel",
    code: diag.code,
    message: diag.message,
  };

  if (diag.suggestion) {
    lspDiag.message += `\nSuggestion: ${diag.suggestion}`;
  }

  return lspDiag;
}

function toSeverity(severity: MelDiagnostic["severity"]): DiagnosticSeverity {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
  }
}
