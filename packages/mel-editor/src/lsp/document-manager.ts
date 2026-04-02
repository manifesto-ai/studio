/**
 * Document Manager
 *
 * Thin wrapper around TextDocuments to track open .mel files.
 */

import { TextDocuments } from "vscode-languageserver/browser.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Connection } from "vscode-languageserver/browser.js";

export class MelDocumentManager {
  private readonly documents = new TextDocuments(TextDocument);

  get(uri: string): TextDocument | undefined {
    return this.documents.get(uri);
  }

  getText(uri: string): string | undefined {
    return this.documents.get(uri)?.getText();
  }

  get onDidChangeContent() {
    return this.documents.onDidChangeContent;
  }

  get onDidClose() {
    return this.documents.onDidClose;
  }

  listen(connection: Connection): void {
    this.documents.listen(connection);
  }
}
