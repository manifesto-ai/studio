/**
 * Document Symbols Provider
 *
 * Returns a hierarchical symbol tree for the outline panel.
 * Uses tokenize() + parse() from the compiler to get AST with source locations.
 */

import {
  DocumentSymbol,
  SymbolKind,
  type DocumentSymbolParams,
} from "vscode-languageserver/browser.js";
import { tokenize, parse } from "@manifesto-ai/compiler";
import type {
  ProgramNode,
  DomainNode,
  StateNode,
  ComputedNode,
  ActionNode,
  TypeDeclNode,
  SourceLocation,
} from "@manifesto-ai/compiler";
import type { MelDocumentManager } from "../document-manager.js";

export function handleDocumentSymbol(documents: MelDocumentManager) {
  return (params: DocumentSymbolParams): DocumentSymbol[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const text = doc.getText();

    try {
      const lexResult = tokenize(text);
      if (lexResult.diagnostics.some((d) => d.severity === "error")) {
        return [];
      }

      const parseResult = parse(lexResult.tokens);
      if (!parseResult.program) return [];

      return buildSymbols(parseResult.program);
    } catch {
      return [];
    }
  };
}

function buildSymbols(program: ProgramNode): DocumentSymbol[] {
  const domain = program.domain;
  if (!domain) return [];

  const children: DocumentSymbol[] = [];

  // Type declarations
  for (const typeDecl of domain.types ?? []) {
    children.push(createTypeSymbol(typeDecl));
  }

  // Domain members (state, computed, action)
  for (const member of domain.members) {
    switch (member.kind) {
      case "state":
        children.push(createStateSymbol(member as StateNode));
        break;
      case "computed":
        children.push(createComputedSymbol(member as ComputedNode));
        break;
      case "action":
        children.push(createActionSymbol(member as ActionNode));
        break;
    }
  }

  // Wrap in domain symbol
  const domainSymbol: DocumentSymbol = {
    name: domain.name,
    kind: SymbolKind.Namespace,
    range: toRange(domain.location),
    selectionRange: toRange(domain.location),
    children,
  };

  return [domainSymbol];
}

function createTypeSymbol(node: TypeDeclNode): DocumentSymbol {
  return {
    name: node.name,
    kind: SymbolKind.Struct,
    range: toRange(node.location),
    selectionRange: toRange(node.location),
  };
}

function createStateSymbol(node: StateNode): DocumentSymbol {
  const fieldSymbols: DocumentSymbol[] = node.fields.map((field) => ({
    name: field.name,
    kind: SymbolKind.Field,
    range: toRange(field.location),
    selectionRange: toRange(field.location),
  }));

  return {
    name: "state",
    kind: SymbolKind.Struct,
    range: toRange(node.location),
    selectionRange: toRange(node.location),
    children: fieldSymbols,
  };
}

function createComputedSymbol(node: ComputedNode): DocumentSymbol {
  return {
    name: node.name,
    kind: SymbolKind.Property,
    range: toRange(node.location),
    selectionRange: toRange(node.location),
  };
}

function createActionSymbol(node: ActionNode): DocumentSymbol {
  const params = node.params?.map((p) => p.name).join(", ") ?? "";
  return {
    name: `${node.name}(${params})`,
    kind: SymbolKind.Function,
    range: toRange(node.location),
    selectionRange: toRange(node.location),
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
