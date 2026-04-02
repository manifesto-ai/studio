/**
 * Hover Provider
 *
 * Shows information when hovering over:
 * - Builtin function names
 * - System identifiers ($system, $meta, $input, $item)
 * - Domain symbols (state, computed, action)
 * - Keywords
 */

import { type Hover, type HoverParams } from "vscode-languageserver/browser.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { MelDocumentManager } from "../document-manager.js";
import type { CompilerBridge } from "../compiler-bridge.js";
import { getBuiltinFunction } from "../registry/builtins.js";
import {
  ALL_KEYWORDS,
  SYSTEM_IDENTIFIERS,
} from "../registry/keywords.js";

export function handleHover(
  documents: MelDocumentManager,
  bridge: CompilerBridge
) {
  return (params: HoverParams): Hover | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const { line, character } = params.position;
    const word = getWordAtPosition(doc, line, character);
    if (!word) return null;

    // 1. Check for system identifier (starts with $)
    if (word.text.startsWith("$")) {
      const fullIdent = getSystemIdentAtPosition(doc, line, character);
      if (fullIdent) {
        const si = SYSTEM_IDENTIFIERS.find(
          (s) => s.name === fullIdent || fullIdent.startsWith(s.name)
        );
        if (si) {
          return {
            contents: {
              kind: "markdown",
              value: `**${si.name}**: \`${si.type}\`\n\n${si.description}`,
            },
          };
        }
      }
    }

    // 2. Check builtin function (word followed by `(`)
    const fn = getBuiltinFunction(word.text);
    if (fn) {
      const params = fn.parameters
        .map((p) => `${p.name}: ${p.type}`)
        .join(", ");
      return {
        contents: {
          kind: "markdown",
          value: [
            `**${fn.name}**(${params}): ${fn.returnType}`,
            "",
            fn.description,
            "",
            "```mel",
            fn.example,
            "```",
          ].join("\n"),
        },
      };
    }

    // 3. Check domain symbols from schema
    const schema = bridge.getSchema(params.textDocument.uri);
    if (schema) {
      // State field
      if (schema.state?.fields?.[word.text]) {
        const field = schema.state.fields[word.text];
        const typeStr = formatFieldType(field.type);
        const defaultStr =
          field.default !== undefined
            ? `\n\nDefault: \`${JSON.stringify(field.default)}\``
            : "";
        return {
          contents: {
            kind: "markdown",
            value: `**state** \`${word.text}\`: \`${typeStr}\`${defaultStr}`,
          },
        };
      }

      // Computed
      const computed = schema.computed as { fields?: Record<string, unknown> };
      if (computed?.fields?.[word.text]) {
        return {
          contents: {
            kind: "markdown",
            value: `**computed** \`${word.text}\``,
          },
        };
      }

      // Action
      if (schema.actions?.[word.text]) {
        const action = schema.actions[word.text];
        const inputStr = action.input
          ? `(${formatFieldType(action.input.type)})`
          : "()";
        return {
          contents: {
            kind: "markdown",
            value: `**action** \`${word.text}\`${inputStr}`,
          },
        };
      }

      // Named type
      if (schema.types?.[word.text]) {
        return {
          contents: {
            kind: "markdown",
            value: `**type** \`${word.text}\``,
          },
        };
      }
    }

    // 4. Check keyword
    const kw = ALL_KEYWORDS.find((k) => k.name === word.text);
    if (kw) {
      return {
        contents: {
          kind: "markdown",
          value: `**${kw.name}** — ${kw.description}`,
        },
      };
    }

    return null;
  };
}

interface WordInfo {
  text: string;
  start: number;
  end: number;
}

function getWordAtPosition(
  doc: TextDocument,
  line: number,
  character: number
): WordInfo | null {
  const text = doc.getText();
  const offset = doc.offsetAt({ line, character });
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const lineText = text.substring(
    lineStart,
    lineEnd === -1 ? text.length : lineEnd
  );
  const col = offset - lineStart;

  // Find word boundaries (including $)
  let start = col;
  while (start > 0 && /[\w$.]/.test(lineText[start - 1])) start--;
  let end = col;
  while (end < lineText.length && /[\w$.]/.test(lineText[end])) end++;

  const word = lineText.substring(start, end);
  if (!word || /^\d/.test(word)) return null;

  // Strip trailing dots
  const trimmed = word.replace(/\.+$/, "");
  if (!trimmed) return null;

  return { text: trimmed, start, end };
}

function getSystemIdentAtPosition(
  doc: TextDocument,
  line: number,
  character: number
): string | null {
  const text = doc.getText();
  const offset = doc.offsetAt({ line, character });
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const lineText = text.substring(
    lineStart,
    lineEnd === -1 ? text.length : lineEnd
  );
  const col = offset - lineStart;

  // Find $ and read the full dotted identifier
  let start = col;
  while (start > 0 && /[\w$.]/.test(lineText[start - 1])) start--;

  if (lineText[start] !== "$") return null;

  let end = col;
  while (end < lineText.length && /[\w$.]/.test(lineText[end])) end++;

  return lineText.substring(start, end).replace(/\.+$/, "");
}

function formatFieldType(type: unknown): string {
  if (typeof type === "string") return type;
  if (type && typeof type === "object" && "enum" in type) {
    return (type as { enum: unknown[] }).enum
      .map((v) => JSON.stringify(v))
      .join(" | ");
  }
  return "unknown";
}
