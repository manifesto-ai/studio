/**
 * Diagnostics Provider
 *
 * Compiles MEL on every document change and publishes diagnostics.
 */

import type { Connection } from "vscode-languageserver/browser.js";
import type { MelDocumentManager } from "../document-manager.js";
import type { CompilerBridge } from "../compiler-bridge.js";

export function setupDiagnostics(
  connection: Connection,
  documents: MelDocumentManager,
  bridge: CompilerBridge
): void {
  documents.onDidChangeContent((change) => {
    const doc = change.document;
    const diagnostics = bridge.compile(doc.uri, doc.getText(), doc.version);
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  });

  documents.onDidClose((event) => {
    bridge.remove(event.document.uri);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });
}
