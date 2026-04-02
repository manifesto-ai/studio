/**
 * AST Utilities for Phase 2
 *
 * Provides:
 * - Parse + scope analysis wrapper
 * - AST traversal to find all references to a symbol
 * - Symbol resolution at a given position
 */

import {
  tokenize,
  parse,
  analyzeScope,
  type ProgramNode,
  type DomainNode,
  type StateNode,
  type ComputedNode,
  type ActionNode,
  type TypeDeclNode,
  type ExprNode,
  type GuardedStmtNode,
  type InnerStmtNode,
  type PathNode,
  type SourceLocation,
  type ScopeAnalysisResult,
  type Scope,
} from "@manifesto-ai/compiler";

// Re-export useful types
export type { ProgramNode, SourceLocation, Scope, ScopeAnalysisResult };

/** A reference to a symbol in the source code */
export interface SymbolReference {
  name: string;
  location: SourceLocation;
  kind: "definition" | "reference";
  symbolKind: "state" | "computed" | "action" | "param" | "type";
}

/** Result of parsing and analyzing a document */
export interface AnalysisResult {
  program: ProgramNode;
  scopes: ScopeAnalysisResult;
  definitions: SymbolReference[];
  references: SymbolReference[];
}

/** Parse and analyze a MEL document. Returns null on parse failure. */
export function analyzeDocument(text: string): AnalysisResult | null {
  try {
    const lexResult = tokenize(text);
    if (lexResult.diagnostics.some((d) => d.severity === "error")) return null;

    const parseResult = parse(lexResult.tokens);
    if (!parseResult.program) return null;

    const program = parseResult.program;
    const scopes = analyzeScope(program);
    const definitions: SymbolReference[] = [];
    const references: SymbolReference[] = [];

    collectSymbols(program, definitions, references);

    return { program, scopes, definitions, references };
  } catch {
    return null;
  }
}

/** Find the symbol at a given offset in the source. Returns the narrowest match. */
export function findSymbolAtOffset(
  analysis: AnalysisResult,
  offset: number
): SymbolReference | null {
  // Collect all matching symbols, then pick the narrowest (most specific) one.
  // References (identifiers) are always narrower than definitions (full nodes).
  let best: SymbolReference | null = null;
  let bestSpan = Infinity;

  for (const ref of analysis.references) {
    if (containsOffset(ref.location, offset)) {
      const span = ref.location.end.offset - ref.location.start.offset;
      if (span < bestSpan) {
        best = ref;
        bestSpan = span;
      }
    }
  }

  for (const def of analysis.definitions) {
    if (containsOffset(def.location, offset)) {
      const span = def.location.end.offset - def.location.start.offset;
      if (span < bestSpan) {
        best = def;
        bestSpan = span;
      }
    }
  }

  return best;
}

/** Find the definition of a symbol by name and kind */
export function findDefinition(
  analysis: AnalysisResult,
  name: string,
  symbolKind?: string
): SymbolReference | null {
  return (
    analysis.definitions.find(
      (d) => d.name === name && (!symbolKind || d.symbolKind === symbolKind)
    ) ?? null
  );
}

/** Find all references to a symbol (excluding definition) */
export function findAllReferences(
  analysis: AnalysisResult,
  name: string,
  symbolKind?: string
): SymbolReference[] {
  return analysis.references.filter(
    (r) => r.name === name && (!symbolKind || r.symbolKind === symbolKind)
  );
}

/** Find all occurrences (definition + references) */
export function findAllOccurrences(
  analysis: AnalysisResult,
  name: string,
  symbolKind?: string
): SymbolReference[] {
  const defs = analysis.definitions.filter(
    (d) => d.name === name && (!symbolKind || d.symbolKind === symbolKind)
  );
  const refs = findAllReferences(analysis, name, symbolKind);
  return [...defs, ...refs];
}

function containsOffset(loc: SourceLocation, offset: number): boolean {
  return offset >= loc.start.offset && offset < loc.end.offset;
}

// ============ Symbol Collection (AST Traversal) ============

function collectSymbols(
  program: ProgramNode,
  definitions: SymbolReference[],
  references: SymbolReference[]
): void {
  const domain = program.domain;
  if (!domain) return;

  // Types
  for (const typeDecl of domain.types ?? []) {
    collectTypeDecl(typeDecl, definitions);
  }

  // Members
  for (const member of domain.members) {
    switch (member.kind) {
      case "state":
        collectState(member as StateNode, definitions);
        break;
      case "computed":
        collectComputed(member as ComputedNode, definitions, references, domain);
        break;
      case "action":
        collectAction(member as ActionNode, definitions, references, domain);
        break;
    }
  }
}

function collectTypeDecl(
  node: TypeDeclNode,
  definitions: SymbolReference[]
): void {
  definitions.push({
    name: node.name,
    location: node.location,
    kind: "definition",
    symbolKind: "type",
  });
  // Type expressions may reference other named types
  // We could walk typeExpr to find SimpleTypeNode references,
  // but for Phase 2 MVP, we skip type expression references
}

function collectState(
  node: StateNode,
  definitions: SymbolReference[]
): void {
  for (const field of node.fields) {
    definitions.push({
      name: field.name,
      location: field.location,
      kind: "definition",
      symbolKind: "state",
    });
  }
}

function collectComputed(
  node: ComputedNode,
  definitions: SymbolReference[],
  references: SymbolReference[],
  domain: DomainNode
): void {
  definitions.push({
    name: node.name,
    location: node.location,
    kind: "definition",
    symbolKind: "computed",
  });
  collectExprReferences(node.expression, references, domain);
}

function collectAction(
  node: ActionNode,
  definitions: SymbolReference[],
  references: SymbolReference[],
  domain: DomainNode
): void {
  definitions.push({
    name: node.name,
    location: node.location,
    kind: "definition",
    symbolKind: "action",
  });

  // Parameters are definitions within action scope
  for (const param of node.params ?? []) {
    definitions.push({
      name: param.name,
      location: param.location,
      kind: "definition",
      symbolKind: "param",
    });
  }

  // Available condition
  if (node.available) {
    collectExprReferences(node.available, references, domain);
  }

  // Body statements
  for (const stmt of node.body) {
    collectStmtReferences(stmt, references, domain);
  }
}

function collectStmtReferences(
  stmt: GuardedStmtNode | InnerStmtNode,
  references: SymbolReference[],
  domain: DomainNode
): void {
  switch (stmt.kind) {
    case "when":
      collectExprReferences(stmt.condition, references, domain);
      for (const inner of stmt.body) {
        collectStmtReferences(inner, references, domain);
      }
      break;
    case "once":
      collectPathReferences(stmt.marker, references, domain);
      if (stmt.condition) {
        collectExprReferences(stmt.condition, references, domain);
      }
      for (const inner of stmt.body) {
        collectStmtReferences(inner, references, domain);
      }
      break;
    case "onceIntent":
      if (stmt.condition) {
        collectExprReferences(stmt.condition, references, domain);
      }
      for (const inner of stmt.body) {
        collectStmtReferences(inner, references, domain);
      }
      break;
    case "patch":
      collectPathReferences(stmt.path, references, domain);
      if (stmt.value) {
        collectExprReferences(stmt.value, references, domain);
      }
      break;
    case "effect":
      for (const arg of stmt.args) {
        if (arg.isPath) {
          collectPathReferences(arg.value as PathNode, references, domain);
        } else {
          collectExprReferences(arg.value as ExprNode, references, domain);
        }
      }
      break;
    case "fail":
    case "stop":
      // These don't contain identifier references
      break;
  }
}

function collectExprReferences(
  expr: ExprNode,
  references: SymbolReference[],
  domain: DomainNode
): void {
  switch (expr.kind) {
    case "identifier":
      references.push({
        name: expr.name,
        location: expr.location,
        kind: "reference",
        symbolKind: resolveSymbolKind(expr.name, domain),
      });
      break;

    case "propertyAccess":
      collectExprReferences(expr.object, references, domain);
      break;

    case "indexAccess":
      collectExprReferences(expr.object, references, domain);
      collectExprReferences(expr.index, references, domain);
      break;

    case "functionCall":
      for (const arg of expr.args) {
        collectExprReferences(arg, references, domain);
      }
      break;

    case "binary":
      collectExprReferences(expr.left, references, domain);
      collectExprReferences(expr.right, references, domain);
      break;

    case "unary":
      collectExprReferences(expr.operand, references, domain);
      break;

    case "ternary":
      collectExprReferences(expr.condition, references, domain);
      collectExprReferences(expr.consequent, references, domain);
      collectExprReferences(expr.alternate, references, domain);
      break;

    case "objectLiteral":
      for (const prop of expr.properties) {
        collectExprReferences(prop.value, references, domain);
      }
      break;

    case "arrayLiteral":
      for (const elem of expr.elements) {
        collectExprReferences(elem, references, domain);
      }
      break;

    case "literal":
    case "systemIdent":
    case "iterationVar":
      break;
  }
}

function collectPathReferences(
  path: PathNode,
  references: SymbolReference[],
  domain: DomainNode
): void {
  if (!path?.segments?.length) return;

  const first = path.segments[0];
  if (first.kind === "propertySegment") {
    references.push({
      name: first.name,
      location: first.location,
      kind: "reference",
      symbolKind: resolveSymbolKind(first.name, domain),
    });
  }
}

/** Resolve what kind of symbol an identifier refers to in the domain */
function resolveSymbolKind(
  name: string,
  domain: DomainNode
): SymbolReference["symbolKind"] {
  for (const member of domain.members) {
    if (member.kind === "state") {
      for (const field of (member as StateNode).fields) {
        if (field.name === name) return "state";
      }
    } else if (member.kind === "computed" && (member as ComputedNode).name === name) {
      return "computed";
    } else if (member.kind === "action" && (member as ActionNode).name === name) {
      return "action";
    }
  }
  // Could be a param — default to state since we can't determine from domain alone
  return "param";
}
