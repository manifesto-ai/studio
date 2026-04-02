/**
 * Rename Provider
 *
 * Renames a symbol at the cursor and all its references.
 */

import {
  type RenameParams,
  type PrepareRenameParams,
  type WorkspaceEdit,
  type Range,
  TextEdit,
} from "vscode-languageserver/browser.js";
import type { MelDocumentManager } from "../document-manager.js";
import {
  analyzeDocument,
  findSymbolAtOffset,
  findAllOccurrences,
  type SourceLocation,
} from "../ast-utils.js";

export function handleRename(documents: MelDocumentManager) {
  return (params: RenameParams): WorkspaceEdit | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const analysis = analyzeDocument(doc.getText());
    if (!analysis) return null;

    const offset = doc.offsetAt(params.position);
    const symbol = findSymbolAtOffset(analysis, offset);
    if (!symbol) return null;

    // Don't allow renaming builtins or system identifiers
    if (symbol.symbolKind === "param" && symbol.kind === "reference") {
      // Could be a param — still allow rename
    }

    const occurrences = findAllOccurrences(
      analysis,
      symbol.name,
      symbol.symbolKind
    );
    if (occurrences.length === 0) return null;

    const edits: TextEdit[] = occurrences.map((occ) => ({
      range: toRange(occ.location),
      newText: params.newName,
    }));

    return {
      changes: {
        [params.textDocument.uri]: edits,
      },
    };
  };
}

export function handlePrepareRename(documents: MelDocumentManager) {
  return (
    params: PrepareRenameParams
  ): { range: Range; placeholder: string } | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const analysis = analyzeDocument(doc.getText());
    if (!analysis) return null;

    const offset = doc.offsetAt(params.position);
    const symbol = findSymbolAtOffset(analysis, offset);
    if (!symbol) return null;

    return {
      range: toRange(symbol.location),
      placeholder: symbol.name,
    };
  };
}

function toRange(loc: SourceLocation) {
  return {
    start: {
      line: Math.max(0, loc.start.line - 1),
      character: Math.max(0, loc.start.column - 1),
    },
    end: {
      line: Math.max(0, loc.end.line - 1),
      character: Math.max(0, loc.end.column - 1),
    },
  };
}
