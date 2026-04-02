/**
 * MEL LSP Browser Worker Entry
 *
 * Runs the MEL language server inside a Web Worker.
 * Uses BrowserMessageReader/Writer for communication with the main thread.
 */

import {
  createConnection,
  BrowserMessageReader,
  BrowserMessageWriter,
  ProposedFeatures
} from "vscode-languageserver/browser.js";

import { serverCapabilities } from "./capabilities.js";
import { MelDocumentManager } from "./document-manager.js";
import { CompilerBridge } from "./compiler-bridge.js";
import { setupDiagnostics } from "./providers/diagnostics.js";
import { handleCompletion } from "./providers/completion.js";
import { handleHover } from "./providers/hover.js";
import { handleSignatureHelp } from "./providers/signature.js";
import { handleDocumentSymbol } from "./providers/symbols.js";
import { handleDefinition } from "./providers/definition.js";
import { handleReferences } from "./providers/references.js";
import { handleRename, handlePrepareRename } from "./providers/rename.js";
import { handleSemanticTokens } from "./providers/semantic-tokens.js";
import { handleCodeAction } from "./providers/code-actions.js";
import { setupIntrospection } from "./providers/introspection.js";

const workerScope = self as DedicatedWorkerGlobalScope;
const reader = new BrowserMessageReader(workerScope);
const writer = new BrowserMessageWriter(workerScope);

const connection = createConnection(ProposedFeatures.all, reader, writer);
const documents = new MelDocumentManager();
const bridge = new CompilerBridge();

connection.onInitialize(() => ({
  capabilities: serverCapabilities
}));

// Phase 1 providers
setupDiagnostics(connection, documents, bridge);
connection.onCompletion(handleCompletion(documents, bridge));
connection.onHover(handleHover(documents, bridge));
connection.onSignatureHelp(handleSignatureHelp(documents));
connection.onDocumentSymbol(handleDocumentSymbol(documents));

// Phase 2 providers
connection.onDefinition(handleDefinition(documents));
connection.onReferences(handleReferences(documents));
connection.onRenameRequest(handleRename(documents));
connection.onPrepareRename(handlePrepareRename(documents));
connection.languages.semanticTokens.on(handleSemanticTokens(documents));
connection.onCodeAction(handleCodeAction(documents));

// Phase 3: AI-Native
setupIntrospection(connection, bridge);

// Start
documents.listen(connection);
connection.listen();
