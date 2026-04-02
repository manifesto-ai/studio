/**
 * MEL Keywords, Types, System Identifiers, and Snippets
 */

import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from "vscode-languageserver/browser.js";

export interface KeywordInfo {
  name: string;
  description: string;
}

export interface SystemIdentifierInfo {
  name: string;
  type: string;
  description: string;
}

/** Top-level structural keywords (inside domain {}) */
export const STRUCTURAL_KEYWORDS: KeywordInfo[] = [
  { name: "state", description: "Declare mutable state fields with types and defaults." },
  { name: "computed", description: "Declare a pure derived value from state." },
  { name: "action", description: "Declare a state transition with guards." },
  { name: "type", description: "Declare a named type for use in state fields." },
];

/** Guard / statement keywords (inside action body) */
export const STATEMENT_KEYWORDS: KeywordInfo[] = [
  { name: "when", description: "Conditional guard. Body executes if condition is true." },
  { name: "once", description: "Idempotency guard using a marker path." },
  { name: "onceIntent", description: "Sugar for once($meta.intentId). Per-intent idempotency." },
  { name: "patch", description: "Set a state field value." },
  { name: "effect", description: "Declare a side-effect requirement for Host." },
  { name: "fail", description: "Abort action with an error code." },
  { name: "stop", description: "Abort action silently with a reason." },
];

/** All MEL keywords */
export const ALL_KEYWORDS: KeywordInfo[] = [
  ...STRUCTURAL_KEYWORDS,
  ...STATEMENT_KEYWORDS,
  { name: "domain", description: "Root declaration. Every MEL file defines exactly one domain." },
  { name: "available", description: "Guard on action availability. `available when condition`." },
  { name: "with", description: "Attach a message to `fail`. `fail \"CODE\" with \"message\"`." },
  { name: "unset", description: "Remove a field value. `patch unset path`." },
  { name: "merge", description: "Merge into a field. `patch merge path = expression`." },
  { name: "import", description: "Import from another module (reserved)." },
  { name: "from", description: "Import source (reserved)." },
  { name: "export", description: "Export a declaration (reserved)." },
  { name: "as", description: "Alias in import (reserved)." },
];

/** Primitive type names */
export const TYPE_KEYWORDS: KeywordInfo[] = [
  { name: "string", description: "String type." },
  { name: "number", description: "Number type (integer or float)." },
  { name: "boolean", description: "Boolean type (true or false)." },
  { name: "null", description: "Null type." },
  { name: "Array", description: "Array type. Usage: `Array<T>`." },
  { name: "Record", description: "Record (key-value map) type. Usage: `Record<K, V>`." },
];

/** System identifiers ($system, $meta, $input, $item) */
export const SYSTEM_IDENTIFIERS: SystemIdentifierInfo[] = [
  { name: "$system.uuid", type: "string", description: "Unique identifier generated per evaluation. Non-deterministic." },
  { name: "$system.time.now", type: "number", description: "Current timestamp in milliseconds. Non-deterministic." },
  { name: "$system.random", type: "number", description: "Random number between 0 and 1. Non-deterministic." },
  { name: "$meta.intentId", type: "string", description: "Unique ID for the current intent. Used for idempotency." },
  { name: "$meta.actor", type: "string", description: "Actor who triggered the action." },
  { name: "$meta.authority", type: "string", description: "Authority level of the actor." },
  { name: "$input", type: "ActionInput", description: "Action input parameters object." },
  { name: "$item", type: "T", description: "Current iteration element in filter/map/find/every/some." },
];

/** Snippet completions for structural keywords */
export function getSnippetCompletions(): CompletionItem[] {
  return [
    {
      label: "domain",
      kind: CompletionItemKind.Snippet,
      detail: "Domain block",
      insertText: "domain ${1:Name} {\n\t$0\n}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "state",
      kind: CompletionItemKind.Snippet,
      detail: "State block",
      insertText: "state {\n\t${1:field}: ${2:type} = ${3:default}\n}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "computed",
      kind: CompletionItemKind.Snippet,
      detail: "Computed field",
      insertText: "computed ${1:name} = ${2:expression}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "action",
      kind: CompletionItemKind.Snippet,
      detail: "Action block",
      insertText:
        "action ${1:name}(${2:params}) {\n\twhen ${3:condition} {\n\t\t$0\n\t}\n}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "type",
      kind: CompletionItemKind.Snippet,
      detail: "Named type declaration",
      insertText: "type ${1:Name} = { ${2:field}: ${3:type} }",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "when",
      kind: CompletionItemKind.Snippet,
      detail: "When guard",
      insertText: "when ${1:condition} {\n\t$0\n}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "once",
      kind: CompletionItemKind.Snippet,
      detail: "Once idempotency guard",
      insertText:
        "once(${1:marker}) {\n\tpatch ${1:marker} = \\$meta.intentId\n\t$0\n}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "onceIntent",
      kind: CompletionItemKind.Snippet,
      detail: "Per-intent idempotency guard",
      insertText: "onceIntent {\n\t$0\n}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "effect",
      kind: CompletionItemKind.Snippet,
      detail: "Effect declaration",
      insertText: "effect ${1:type}({\n\t${2:args}\n})",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "fail",
      kind: CompletionItemKind.Snippet,
      detail: "Fail with error code",
      insertText: 'fail "${1:CODE}"',
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "patch",
      kind: CompletionItemKind.Snippet,
      detail: "Patch state field",
      insertText: "patch ${1:path} = ${2:expression}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
  ];
}

/** Effect type completions */
export const EFFECT_TYPES: string[] = [
  "array.filter",
  "array.map",
  "array.sort",
  "array.find",
  "array.every",
  "array.some",
  "array.flatMap",
  "array.groupBy",
  "array.unique",
  "array.partition",
  "record.keys",
  "record.values",
  "record.entries",
  "record.filter",
  "record.mapValues",
  "record.fromEntries",
  "api.fetch",
  "api.post",
  "api.put",
  "api.remove",
];
