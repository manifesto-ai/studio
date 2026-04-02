/**
 * Server Capabilities
 *
 * Declares what LSP features the MEL language server supports.
 */

import {
  type ServerCapabilities,
  TextDocumentSyncKind,
} from "vscode-languageserver/browser.js";
import { SEMANTIC_TOKENS_LEGEND } from "./providers/semantic-tokens.js";

export const serverCapabilities: ServerCapabilities = {
  textDocumentSync: TextDocumentSyncKind.Full,
  completionProvider: {
    triggerCharacters: [".", "$", "("],
    resolveProvider: false,
  },
  hoverProvider: true,
  signatureHelpProvider: {
    triggerCharacters: ["(", ","],
  },
  documentSymbolProvider: true,
  // Phase 2
  definitionProvider: true,
  referencesProvider: true,
  renameProvider: { prepareProvider: true },
  codeActionProvider: true,
  semanticTokensProvider: {
    legend: SEMANTIC_TOKENS_LEGEND,
    full: true,
  },
};
