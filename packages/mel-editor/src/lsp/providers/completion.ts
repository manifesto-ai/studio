/**
 * Completion Provider
 *
 * Provides autocompletion for:
 * - Builtin functions (with snippets)
 * - Domain symbols (state, computed, actions, types)
 * - Keywords (structural and statement-level)
 * - System identifiers ($system, $meta, $input, $item)
 * - Effect types
 */

import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  type CompletionParams,
} from "vscode-languageserver/browser.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { MelDocumentManager } from "../document-manager.js";
import type { CompilerBridge } from "../compiler-bridge.js";
import {
  getAllBuiltinFunctions,
  type BuiltinFunction,
} from "../registry/builtins.js";
import {
  STRUCTURAL_KEYWORDS,
  STATEMENT_KEYWORDS,
  SYSTEM_IDENTIFIERS,
  TYPE_KEYWORDS,
  EFFECT_TYPES,
  getSnippetCompletions,
} from "../registry/keywords.js";

export function handleCompletion(
  documents: MelDocumentManager,
  bridge: CompilerBridge
) {
  return (params: CompletionParams): CompletionItem[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const context = detectContext(doc, params.position.line, params.position.character);
    const items: CompletionItem[] = [];

    switch (context.kind) {
      case "dollar":
        items.push(...getSystemIdentifierCompletions());
        break;

      case "effect_type":
        items.push(...getEffectTypeCompletions());
        break;

      case "top_level":
        items.push(...getStructuralKeywordCompletions());
        items.push(...getSnippetCompletions());
        break;

      case "statement":
        items.push(...getStatementKeywordCompletions());
        break;

      case "type":
        items.push(...getTypeCompletions());
        break;

      case "expression":
      default:
        items.push(...getBuiltinFunctionCompletions());
        items.push(...getDomainSymbolCompletions(bridge, params.textDocument.uri));
        break;
    }

    return items;
  };
}

type CompletionContext =
  | { kind: "dollar" }
  | { kind: "effect_type" }
  | { kind: "top_level" }
  | { kind: "statement" }
  | { kind: "type" }
  | { kind: "expression" };

function detectContext(
  doc: TextDocument,
  line: number,
  character: number
): CompletionContext {
  const text = doc.getText();
  const offset = doc.offsetAt({ line, character });

  // Get text before cursor on current line
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineBefore = text.substring(lineStart, offset);
  const trimmedBefore = lineBefore.trimStart();

  // After `$` → system identifiers
  if (lineBefore.endsWith("$") || /\$\w*$/.test(lineBefore)) {
    return { kind: "dollar" };
  }

  // After `effect ` → effect types
  if (/\beffect\s+\w*$/.test(lineBefore)) {
    return { kind: "effect_type" };
  }

  // After `:` in state/param context → type completions
  if (/:\s*\w*$/.test(trimmedBefore) && isInTypePosition(text, offset)) {
    return { kind: "type" };
  }

  // Determine nesting depth (rough heuristic)
  const textBefore = text.substring(0, offset);
  const braceDepth = countUnmatched(textBefore, "{", "}");

  // Depth 0 or 1: outside domain or at top level inside domain
  if (braceDepth <= 1 && /^\s*\w*$/.test(trimmedBefore)) {
    return { kind: "top_level" };
  }

  // Depth 2+: inside action body → statement keywords
  if (
    braceDepth >= 2 &&
    /^\s*\w*$/.test(trimmedBefore) &&
    !isInsideExpression(lineBefore)
  ) {
    return { kind: "statement" };
  }

  return { kind: "expression" };
}

function isInTypePosition(text: string, offset: number): boolean {
  // Look backwards for context: after `:` in field/param declaration
  const before = text.substring(Math.max(0, offset - 100), offset);
  return /:\s*\w*$/.test(before) && !/=\s*\w*$/.test(before);
}

function isInsideExpression(lineBefore: string): boolean {
  // If there's an open paren or we're after =, we're in an expression
  const openParens =
    (lineBefore.match(/\(/g) ?? []).length -
    (lineBefore.match(/\)/g) ?? []).length;
  return openParens > 0 || /=\s*\S+$/.test(lineBefore);
}

function countUnmatched(text: string, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
      } else if (text[i - 1] !== "\\") {
        inString = false;
      }
      continue;
    }
    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) depth--;
  }
  return depth;
}

// ============ Completion item generators ============

function getBuiltinFunctionCompletions(): CompletionItem[] {
  return getAllBuiltinFunctions().map(toFunctionCompletion);
}

function toFunctionCompletion(fn: BuiltinFunction): CompletionItem {
  return {
    label: fn.name,
    kind: CompletionItemKind.Function,
    detail: fn.signature,
    documentation: {
      kind: "markdown",
      value: `${fn.description}\n\n\`\`\`mel\n${fn.example}\n\`\`\``,
    },
    insertText: fn.snippet,
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: `1_${fn.name}`,
  };
}

function getDomainSymbolCompletions(
  bridge: CompilerBridge,
  uri: string
): CompletionItem[] {
  const schema = bridge.getSchema(uri);
  if (!schema) return [];

  const items: CompletionItem[] = [];

  // State fields
  if (schema.state?.fields) {
    for (const [name, field] of Object.entries(schema.state.fields)) {
      items.push({
        label: name,
        kind: CompletionItemKind.Field,
        detail: `state: ${formatFieldType(field.type)}`,
        sortText: `0_${name}`,
      });
    }
  }

  // Computed fields
  if (schema.computed && "fields" in schema.computed) {
    for (const name of Object.keys(
      (schema.computed as { fields: Record<string, unknown> }).fields
    )) {
      items.push({
        label: name,
        kind: CompletionItemKind.Property,
        detail: "computed",
        sortText: `0_${name}`,
      });
    }
  }

  // Actions
  if (schema.actions) {
    for (const [name, spec] of Object.entries(schema.actions)) {
      items.push({
        label: name,
        kind: CompletionItemKind.Method,
        detail: `action${spec.input ? `(${formatFieldType(spec.input.type)})` : "()"}`,
        sortText: `0_${name}`,
      });
    }
  }

  // Types
  if (schema.types) {
    for (const name of Object.keys(schema.types)) {
      items.push({
        label: name,
        kind: CompletionItemKind.Class,
        detail: "type",
        sortText: `0_${name}`,
      });
    }
  }

  return items;
}

function getSystemIdentifierCompletions(): CompletionItem[] {
  return SYSTEM_IDENTIFIERS.map((si) => ({
    label: si.name,
    kind: CompletionItemKind.Variable,
    detail: si.type,
    documentation: si.description,
    sortText: `0_${si.name}`,
  }));
}

function getEffectTypeCompletions(): CompletionItem[] {
  return EFFECT_TYPES.map((et) => ({
    label: et,
    kind: CompletionItemKind.EnumMember,
    sortText: `0_${et}`,
  }));
}

function getStructuralKeywordCompletions(): CompletionItem[] {
  return STRUCTURAL_KEYWORDS.map((kw) => ({
    label: kw.name,
    kind: CompletionItemKind.Keyword,
    detail: kw.description,
    sortText: `0_${kw.name}`,
  }));
}

function getStatementKeywordCompletions(): CompletionItem[] {
  return STATEMENT_KEYWORDS.map((kw) => ({
    label: kw.name,
    kind: CompletionItemKind.Keyword,
    detail: kw.description,
    sortText: `0_${kw.name}`,
  }));
}

function getTypeCompletions(): CompletionItem[] {
  return TYPE_KEYWORDS.map((t) => ({
    label: t.name,
    kind: CompletionItemKind.TypeParameter,
    detail: t.description,
    sortText: `0_${t.name}`,
  }));
}

function formatFieldType(type: unknown): string {
  if (typeof type === "string") return type;
  if (type && typeof type === "object" && "enum" in type) {
    return (type as { enum: unknown[] }).enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  return "unknown";
}
