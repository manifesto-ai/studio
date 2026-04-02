/**
 * Semantic Tokens Provider
 *
 * Provides semantic highlighting data by walking the AST.
 * Token types: keyword, type, function, variable, property, parameter, string, number
 */

import {
  SemanticTokensBuilder,
  type SemanticTokensLegend,
  type SemanticTokensParams,
  type SemanticTokens,
} from "vscode-languageserver/browser.js";
import {
  tokenize,
  parse,
  type ProgramNode,
  type DomainNode,
  type StateNode,
  type ComputedNode,
  type ActionNode,
  type TypeDeclNode,
  type ExprNode,
  type GuardedStmtNode,
  type InnerStmtNode,
  type SourceLocation,
} from "@manifesto-ai/compiler";
import type { MelDocumentManager } from "../document-manager.js";
import { getBuiltinFunction } from "../registry/builtins.js";

// Semantic token types
export const TOKEN_TYPES = [
  "namespace",   // 0: domain name
  "type",        // 1: type names
  "function",    // 2: builtin functions
  "variable",    // 3: state fields
  "property",    // 4: computed fields
  "parameter",   // 5: action parameters
  "keyword",     // 6: MEL keywords
  "number",      // 7: numeric literals
  "string",      // 8: string literals
  "method",      // 9: action names
] as const;

export const TOKEN_MODIFIERS = [
  "declaration",  // 0
  "definition",   // 1
  "readonly",     // 2
] as const;

export const SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
  tokenTypes: [...TOKEN_TYPES],
  tokenModifiers: [...TOKEN_MODIFIERS],
};

export function handleSemanticTokens(documents: MelDocumentManager) {
  return (params: SemanticTokensParams): SemanticTokens => {
    const empty = new SemanticTokensBuilder().build();

    const doc = documents.get(params.textDocument.uri);
    if (!doc) return empty;

    const text = doc.getText();

    try {
      const lexResult = tokenize(text);
      if (lexResult.diagnostics.some((d) => d.severity === "error")) return empty;

      const parseResult = parse(lexResult.tokens);
      if (!parseResult.program) return empty;

      const builder = new SemanticTokensBuilder();
      visitProgram(parseResult.program, builder);
      return builder.build();
    } catch {
      return empty;
    }
  };
}

function visitProgram(program: ProgramNode, b: SemanticTokensBuilder) {
  const domain = program.domain;
  if (!domain) return;

  // Collect state field names for reference resolution
  const stateFields = new Set<string>();
  const computedNames = new Set<string>();
  const actionNames = new Set<string>();
  const paramNames = new Set<string>();

  for (const member of domain.members) {
    if (member.kind === "state") {
      for (const field of (member as StateNode).fields) {
        stateFields.add(field.name);
      }
    } else if (member.kind === "computed") {
      computedNames.add((member as ComputedNode).name);
    } else if (member.kind === "action") {
      actionNames.add((member as ActionNode).name);
      for (const param of (member as ActionNode).params ?? []) {
        paramNames.add(param.name);
      }
    }
  }

  const ctx: VisitContext = { stateFields, computedNames, actionNames, paramNames };

  // Type declarations
  for (const typeDecl of domain.types ?? []) {
    pushToken(b, typeDecl.location, typeDecl.name.length, 1, 1); // type + definition
  }

  // Members
  for (const member of domain.members) {
    switch (member.kind) {
      case "state":
        visitState(member as StateNode, b, ctx);
        break;
      case "computed":
        visitComputed(member as ComputedNode, b, ctx);
        break;
      case "action":
        visitAction(member as ActionNode, b, ctx);
        break;
    }
  }
}

interface VisitContext {
  stateFields: Set<string>;
  computedNames: Set<string>;
  actionNames: Set<string>;
  paramNames: Set<string>;
}

function visitState(node: StateNode, b: SemanticTokensBuilder, _ctx: VisitContext) {
  for (const field of node.fields) {
    pushToken(b, field.location, field.name.length, 3, 1); // variable + definition
  }
}

function visitComputed(node: ComputedNode, b: SemanticTokensBuilder, ctx: VisitContext) {
  pushToken(b, node.location, node.name.length, 4, 1); // property + definition
  visitExpr(node.expression, b, ctx);
}

function visitAction(node: ActionNode, b: SemanticTokensBuilder, ctx: VisitContext) {
  pushToken(b, node.location, node.name.length, 9, 1); // method + definition

  for (const param of node.params ?? []) {
    pushToken(b, param.location, param.name.length, 5, 1); // parameter + definition
  }

  if (node.available) {
    visitExpr(node.available, b, ctx);
  }

  for (const stmt of node.body) {
    visitStmt(stmt, b, ctx);
  }
}

function visitStmt(
  stmt: GuardedStmtNode | InnerStmtNode,
  b: SemanticTokensBuilder,
  ctx: VisitContext
) {
  switch (stmt.kind) {
    case "when":
      visitExpr(stmt.condition, b, ctx);
      for (const inner of stmt.body) visitStmt(inner, b, ctx);
      break;
    case "once":
      if (stmt.condition) visitExpr(stmt.condition, b, ctx);
      for (const inner of stmt.body) visitStmt(inner, b, ctx);
      break;
    case "onceIntent":
      if (stmt.condition) visitExpr(stmt.condition, b, ctx);
      for (const inner of stmt.body) visitStmt(inner, b, ctx);
      break;
    case "patch":
      if (stmt.value) visitExpr(stmt.value, b, ctx);
      break;
    case "effect":
      for (const arg of stmt.args) {
        if (!arg.isPath) {
          visitExpr(arg.value as ExprNode, b, ctx);
        }
      }
      break;
  }
}

function visitExpr(expr: ExprNode, b: SemanticTokensBuilder, ctx: VisitContext) {
  switch (expr.kind) {
    case "identifier": {
      let tokenType = 3; // variable (default: state)
      if (ctx.computedNames.has(expr.name)) tokenType = 4; // property
      else if (ctx.actionNames.has(expr.name)) tokenType = 9; // method
      else if (ctx.paramNames.has(expr.name)) tokenType = 5; // parameter
      pushToken(b, expr.location, expr.name.length, tokenType, 0);
      break;
    }
    case "functionCall":
      if (getBuiltinFunction(expr.name)) {
        pushToken(b, expr.location, expr.name.length, 2, 0); // function
      }
      for (const arg of expr.args) visitExpr(arg, b, ctx);
      break;
    case "literal":
      if (expr.literalType === "number") {
        pushToken(b, expr.location, expr.location.end.offset - expr.location.start.offset, 7, 0);
      } else if (expr.literalType === "string") {
        pushToken(b, expr.location, expr.location.end.offset - expr.location.start.offset, 8, 0);
      }
      break;
    case "propertyAccess":
      visitExpr(expr.object, b, ctx);
      break;
    case "indexAccess":
      visitExpr(expr.object, b, ctx);
      visitExpr(expr.index, b, ctx);
      break;
    case "binary":
      visitExpr(expr.left, b, ctx);
      visitExpr(expr.right, b, ctx);
      break;
    case "unary":
      visitExpr(expr.operand, b, ctx);
      break;
    case "ternary":
      visitExpr(expr.condition, b, ctx);
      visitExpr(expr.consequent, b, ctx);
      visitExpr(expr.alternate, b, ctx);
      break;
    case "objectLiteral":
      for (const prop of expr.properties) visitExpr(prop.value, b, ctx);
      break;
    case "arrayLiteral":
      for (const elem of expr.elements) visitExpr(elem, b, ctx);
      break;
  }
}

function pushToken(
  b: SemanticTokensBuilder,
  loc: SourceLocation,
  length: number,
  tokenType: number,
  tokenModifiers: number
) {
  const line = Math.max(0, loc.start.line - 1);
  const char = Math.max(0, loc.start.column - 1);
  b.push(line, char, length, tokenType, tokenModifiers);
}
