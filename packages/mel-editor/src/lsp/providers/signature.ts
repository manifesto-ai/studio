/**
 * Signature Help Provider
 *
 * Shows function parameter hints while typing inside function calls.
 * Trigger characters: `(`, `,`
 */

import {
  type SignatureHelp,
  type SignatureHelpParams,
  ParameterInformation,
  SignatureInformation,
} from "vscode-languageserver/browser.js";
import type { MelDocumentManager } from "../document-manager.js";
import { getBuiltinFunction } from "../registry/builtins.js";

export function handleSignatureHelp(documents: MelDocumentManager) {
  return (params: SignatureHelpParams): SignatureHelp | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const text = doc.getText();
    const offset = doc.offsetAt(params.position);

    const callInfo = findEnclosingFunctionCall(text, offset);
    if (!callInfo) return null;

    const fn = getBuiltinFunction(callInfo.name);
    if (!fn) return null;

    const paramLabels: ParameterInformation[] = fn.parameters.map((p) => ({
      label: `${p.name}: ${p.type}`,
      documentation: p.description,
    }));

    const sigLabel = `${fn.name}(${fn.parameters.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${fn.returnType}`;

    const sig = SignatureInformation.create(
      sigLabel,
      fn.description,
      ...paramLabels
    );

    return {
      signatures: [sig],
      activeSignature: 0,
      activeParameter: Math.min(callInfo.argIndex, fn.parameters.length - 1),
    };
  };
}

interface CallInfo {
  name: string;
  argIndex: number;
}

/**
 * Walk backwards from cursor to find the enclosing function call
 * and which argument position the cursor is at.
 */
function findEnclosingFunctionCall(
  text: string,
  offset: number
): CallInfo | null {
  let depth = 0;
  let argIndex = 0;
  let inString = false;

  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i];

    // String handling
    if (ch === '"' && text[i - 1] !== "\\") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      if (depth === 0) {
        // Found the opening paren — extract function name
        const nameEnd = i;
        let nameStart = nameEnd - 1;
        while (nameStart >= 0 && /\w/.test(text[nameStart])) {
          nameStart--;
        }
        nameStart++;

        const name = text.substring(nameStart, nameEnd);
        if (name && /^[a-zA-Z]\w*$/.test(name)) {
          return { name, argIndex };
        }
        return null;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      argIndex++;
    }
  }

  return null;
}
