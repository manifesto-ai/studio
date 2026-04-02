/**
 * LSP Bridge
 *
 * Manages the Web Worker lifecycle and provides Monaco-compatible
 * language features by proxying LSP protocol messages.
 *
 * Uses a lightweight direct-message approach rather than
 * monaco-languageclient to avoid heavy dependencies.
 */

import * as monaco from "monaco-editor";
import {
  type RequestMessage,
  type ResponseMessage,
  type NotificationMessage
} from "vscode-languageserver-protocol";
import { MEL_LANGUAGE_ID } from "../mel-language.js";

type PendingRequest = {
  resolve: (result: any) => void;
  reject: (error: any) => void;
};

export class MelLspBridge {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private disposables: monaco.IDisposable[] = [];
  private documentVersion = new Map<string, number>();

  start(): void {
    this.worker = new Worker(
      new URL("./worker-entry.js", import.meta.url),
      { type: "module" }
    );

    this.worker.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    // Initialize the server
    this.sendRequest("initialize", {
      capabilities: {},
      rootUri: null,
      processId: null
    }).then(() => {
      this.sendNotification("initialized", {});
      this.registerMonacoProviders();
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  notifyDocumentOpen(uri: string, text: string): void {
    this.documentVersion.set(uri, 1);
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: MEL_LANGUAGE_ID,
        version: 1,
        text
      }
    });
  }

  notifyDocumentChange(uri: string, text: string): void {
    const version = (this.documentVersion.get(uri) ?? 0) + 1;
    this.documentVersion.set(uri, version);
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    });
  }

  notifyDocumentClose(uri: string): void {
    this.documentVersion.delete(uri);
    this.sendNotification("textDocument/didClose", {
      textDocument: { uri }
    });
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });

      const message: RequestMessage = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };

      this.worker?.postMessage(message);
    });
  }

  private sendNotification(method: string, params: any): void {
    const message: NotificationMessage = {
      jsonrpc: "2.0",
      method,
      params
    };

    this.worker?.postMessage(message);
  }

  private handleMessage(message: ResponseMessage | NotificationMessage): void {
    if ("id" in message && message.id !== undefined) {
      const pending = this.pending.get(message.id as number);
      if (pending) {
        this.pending.delete(message.id as number);
        if ("error" in message && message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Handle server-initiated notifications (e.g., diagnostics)
    const notification = message as NotificationMessage;
    if (notification.method === "textDocument/publishDiagnostics") {
      this.handleDiagnostics(notification.params as any);
    }
  }

  private handleDiagnostics(params: {
    uri: string;
    diagnostics: Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      severity?: number;
      message: string;
      code?: string | number;
    }>;
  }): void {
    const model = monaco.editor
      .getModels()
      .find((m) => m.uri.toString() === params.uri);

    if (!model) {
      return;
    }

    const markers: monaco.editor.IMarkerData[] = params.diagnostics.map((d) => ({
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      message: d.message,
      severity: toMonacoSeverity(d.severity),
      code: d.code !== undefined ? String(d.code) : undefined
    }));

    monaco.editor.setModelMarkers(model, "mel-lsp", markers);
  }

  private registerMonacoProviders(): void {
    // Completion
    this.disposables.push(
      monaco.languages.registerCompletionItemProvider(MEL_LANGUAGE_ID, {
        triggerCharacters: [".", "$", "("],
        provideCompletionItems: async (model, position) => {
          const result = await this.sendRequest("textDocument/completion", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });

          if (!result) {
            return { suggestions: [] };
          }

          const items = Array.isArray(result) ? result : result.items ?? [];
          return {
            suggestions: items.map((item: any) => toMonacoCompletionItem(item, model, position))
          };
        }
      })
    );

    // Hover
    this.disposables.push(
      monaco.languages.registerHoverProvider(MEL_LANGUAGE_ID, {
        provideHover: async (model, position) => {
          const result = await this.sendRequest("textDocument/hover", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });

          if (!result) {
            return null;
          }

          return {
            contents: Array.isArray(result.contents)
              ? result.contents.map(toMonacoMarkdown)
              : [toMonacoMarkdown(result.contents)],
            range: result.range ? toMonacoRange(result.range) : undefined
          };
        }
      })
    );

    // Signature Help
    this.disposables.push(
      monaco.languages.registerSignatureHelpProvider(MEL_LANGUAGE_ID, {
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: async (model, position) => {
          const result = await this.sendRequest("textDocument/signatureHelp", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });

          if (!result) {
            return null;
          }

          return {
            value: {
              signatures: result.signatures.map((sig: any) => ({
                label: sig.label,
                documentation: sig.documentation
                  ? toMonacoMarkdown(sig.documentation)
                  : undefined,
                parameters: (sig.parameters ?? []).map((p: any) => ({
                  label: p.label,
                  documentation: p.documentation
                    ? toMonacoMarkdown(p.documentation)
                    : undefined
                }))
              })),
              activeSignature: result.activeSignature ?? 0,
              activeParameter: result.activeParameter ?? 0
            },
            dispose: () => {}
          };
        }
      })
    );

    // Definition
    this.disposables.push(
      monaco.languages.registerDefinitionProvider(MEL_LANGUAGE_ID, {
        provideDefinition: async (model, position) => {
          const result = await this.sendRequest("textDocument/definition", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });

          if (!result) {
            return null;
          }

          const locations = Array.isArray(result) ? result : [result];
          return locations.map((loc: any) => ({
            uri: monaco.Uri.parse(loc.uri),
            range: toMonacoRange(loc.range)
          }));
        }
      })
    );

    // Document Symbols
    this.disposables.push(
      monaco.languages.registerDocumentSymbolProvider(MEL_LANGUAGE_ID, {
        provideDocumentSymbols: async (model) => {
          const result = await this.sendRequest("textDocument/documentSymbol", {
            textDocument: { uri: model.uri.toString() }
          });

          if (!result) {
            return [];
          }

          return result.map(toMonacoDocumentSymbol);
        }
      })
    );
  }
}

function toMonacoSeverity(severity?: number): monaco.MarkerSeverity {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Info;
  }
}

function toMonacoRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  };
}

function toMonacoMarkdown(
  content: string | { kind: string; value: string }
): monaco.IMarkdownString {
  if (typeof content === "string") {
    return { value: content };
  }
  return { value: content.value };
}

function toMonacoCompletionItem(
  item: any,
  model: monaco.editor.ITextModel,
  position: monaco.Position
): monaco.languages.CompletionItem {
  const word = model.getWordUntilPosition(position);
  const range = {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: word.endColumn
  };

  return {
    label: item.label,
    kind: item.kind ?? monaco.languages.CompletionItemKind.Text,
    detail: item.detail,
    documentation: item.documentation
      ? toMonacoMarkdown(item.documentation)
      : undefined,
    insertText: item.insertText ?? item.label,
    insertTextRules:
      item.insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range
  };
}

function toMonacoDocumentSymbol(symbol: any): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail ?? "",
    kind: symbol.kind ?? monaco.languages.SymbolKind.Variable,
    tags: [],
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: symbol.children?.map(toMonacoDocumentSymbol)
  };
}
