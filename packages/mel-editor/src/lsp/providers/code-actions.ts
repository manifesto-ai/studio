/**
 * Code Actions Provider
 *
 * Offers Quick Fixes based on diagnostics:
 * - E_UNKNOWN_FN: "Did you mean `filter`?" with fuzzy match
 */

import {
  type CodeActionParams,
  type CodeAction,
  CodeActionKind,
  type Diagnostic,
  TextEdit,
} from "vscode-languageserver/browser.js";
import type { MelDocumentManager } from "../document-manager.js";
import { getAllBuiltinFunctions } from "../registry/builtins.js";

export function handleCodeAction(documents: MelDocumentManager) {
  return (params: CodeActionParams): CodeAction[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const actions: CodeAction[] = [];

    for (const diag of params.context.diagnostics) {
      if (diag.code === "E_UNKNOWN_FN") {
        actions.push(...suggestFunctionFix(diag, params.textDocument.uri, doc.getText()));
      }
    }

    return actions;
  };
}

function suggestFunctionFix(
  diag: Diagnostic,
  uri: string,
  _text: string
): CodeAction[] {
  // Extract the unknown function name from the message
  const match = diag.message.match(/Unknown function '(\w+)'/);
  if (!match) return [];

  const unknownName = match[1];
  const suggestions = findSimilarFunctions(unknownName, 3);

  return suggestions.map((name) => ({
    title: `Did you mean '${name}'?`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diag],
    edit: {
      changes: {
        [uri]: [TextEdit.replace(diag.range, name)],
      },
    },
    isPreferred: suggestions[0] === name,
  }));
}

/** Find similar function names using Levenshtein distance */
function findSimilarFunctions(name: string, maxResults: number): string[] {
  const allFunctions = getAllBuiltinFunctions();
  const scored = allFunctions
    .map((fn) => ({
      name: fn.name,
      distance: levenshtein(name.toLowerCase(), fn.name.toLowerCase()),
    }))
    .filter((s) => s.distance <= Math.max(3, Math.floor(name.length / 2)))
    .sort((a, b) => a.distance - b.distance);

  return scored.slice(0, maxResults).map((s) => s.name);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
