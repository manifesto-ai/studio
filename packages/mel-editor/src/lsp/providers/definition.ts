/**
 * Go to Definition Provider
 *
 * Resolves identifier at cursor → jumps to its declaration.
 */

import {
  type DefinitionParams,
  type Location,
} from "vscode-languageserver/browser.js";
import type { MelDocumentManager } from "../document-manager.js";
import {
  analyzeDocument,
  findSymbolAtOffset,
  findDefinition,
} from "../ast-utils.js";

export function handleDefinition(documents: MelDocumentManager) {
  return (params: DefinitionParams): Location | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const analysis = analyzeDocument(doc.getText());
    if (!analysis) return null;

    const offset = doc.offsetAt(params.position);
    const symbol = findSymbolAtOffset(analysis, offset);
    if (!symbol) return null;

    // If already at definition, return it
    if (symbol.kind === "definition") {
      return {
        uri: params.textDocument.uri,
        range: toRange(symbol.location),
      };
    }

    // Find the definition for this reference
    const def = findDefinition(analysis, symbol.name, symbol.symbolKind);
    if (!def) return null;

    return {
      uri: params.textDocument.uri,
      range: toRange(def.location),
    };
  };
}

function toRange(loc: import("../ast-utils.js").SourceLocation) {
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
