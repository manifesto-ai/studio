/**
 * Find References Provider
 *
 * Finds all occurrences of a symbol across the document.
 */

import {
  type ReferenceParams,
  type Location,
} from "vscode-languageserver/browser.js";
import type { MelDocumentManager } from "../document-manager.js";
import {
  analyzeDocument,
  findSymbolAtOffset,
  findAllOccurrences,
  type SourceLocation,
} from "../ast-utils.js";

export function handleReferences(documents: MelDocumentManager) {
  return (params: ReferenceParams): Location[] | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const analysis = analyzeDocument(doc.getText());
    if (!analysis) return null;

    const offset = doc.offsetAt(params.position);
    const symbol = findSymbolAtOffset(analysis, offset);
    if (!symbol) return null;

    const occurrences = findAllOccurrences(
      analysis,
      symbol.name,
      symbol.symbolKind
    );

    // If includeDeclaration is false, filter out definitions
    const filtered = params.context.includeDeclaration
      ? occurrences
      : occurrences.filter((o) => o.kind !== "definition");

    return filtered.map((ref) => ({
      uri: params.textDocument.uri,
      range: toRange(ref.location),
    }));
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
