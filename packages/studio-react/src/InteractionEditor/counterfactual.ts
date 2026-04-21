/**
 * Static counterfactual hint derivation (UX philosophy Rule P1).
 *
 * "If the MEL guard is simple enough to parse statically, show a
 *  one-liner: 'would pass if <state change>'. Use only static MEL
 *  analysis via the compiler's existing guard AST — no heuristics,
 *  no LLM. If the guard is too complex to analyze, show nothing
 *  rather than guessing."
 *
 * Rationale: Pillar 5 (Provable, not plausible) forbids the UI from
 * making claims it cannot prove. A plausible-but-wrong hint is
 * strictly worse than silence — it trains the user to doubt every
 * claim the UI makes.
 *
 * Scope of what we CAN safely decode from `DispatchBlocker.expression`:
 *
 *   - `eq(ref, literal)`            → "if <ref> becomes <literal>"
 *   - `neq(ref, literal)`           → "if <ref> differs from <literal>"
 *   - `gt/gte/lt/lte(ref, literal)` → "if <ref> is <op> <literal>"
 *   - `isNull(ref)` / `isNotNull(ref)`
 *   - A bare `ref` (boolean field) → "if <ref> becomes true"
 *   - `not(<above>)`                → negation of above
 *
 * Anything else — variadic `and`/`or`, aggregation, computed
 * composition, cross-field comparisons — returns `null` (silence).
 * We never guess across operator types.
 */
import type { DispatchBlocker } from "@manifesto-ai/studio-core";

export type CounterfactualHint = {
  /** Human-readable one-liner. Korean prose, UI-presentable as-is. */
  readonly text: string;
  /** The ref path the hint refers to — useful for click-to-reveal. */
  readonly refPath: string;
};

/** Minimal ExprNode shape we care about. */
type Node = {
  readonly kind?: string;
  readonly op?: string;
  readonly ref?: string;
  readonly path?: readonly unknown[];
  readonly value?: unknown;
  readonly args?: readonly Node[];
  readonly left?: Node;
  readonly right?: Node;
};

function asNode(x: unknown): Node | null {
  if (x === null || typeof x !== "object") return null;
  return x as Node;
}

function refPath(node: Node): string | null {
  if (node.kind !== "ref" && node.kind !== "state_ref" && node.kind !== "computed_ref" && node.kind !== "var_ref") {
    return null;
  }
  if (typeof node.ref === "string") return node.ref;
  if (Array.isArray(node.path)) {
    return node.path.map(String).join(".");
  }
  return null;
}

function literalValue(node: Node): { ok: true; value: unknown } | { ok: false } {
  if (node.kind === "literal") return { ok: true, value: node.value };
  return { ok: false };
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "(복합값)";
}

function comparisonHint(
  op: string,
  a: Node,
  b: Node,
): CounterfactualHint | null {
  // Prefer the form: ref OP literal. Only one side may be a ref for
  // the hint to be unambiguous.
  const aRef = refPath(a);
  const bRef = refPath(b);
  const aLit = literalValue(a);
  const bLit = literalValue(b);

  let ref: string | null = null;
  let lit: unknown = null;
  if (aRef !== null && bLit.ok) {
    ref = aRef;
    lit = bLit.value;
  } else if (bRef !== null && aLit.ok) {
    ref = bRef;
    lit = aLit.value;
  } else {
    return null;
  }

  const v = formatValue(lit);
  switch (op) {
    case "eq":
      return { text: `${ref} 가 ${v} 가 되면 통과합니다.`, refPath: ref };
    case "neq":
      return { text: `${ref} 가 ${v} 가 아니게 되면 통과합니다.`, refPath: ref };
    case "gt":
      return { text: `${ref} 가 ${v} 보다 크면 통과합니다.`, refPath: ref };
    case "gte":
      return { text: `${ref} 가 ${v} 이상이면 통과합니다.`, refPath: ref };
    case "lt":
      return { text: `${ref} 가 ${v} 보다 작으면 통과합니다.`, refPath: ref };
    case "lte":
      return { text: `${ref} 가 ${v} 이하이면 통과합니다.`, refPath: ref };
    default:
      return null;
  }
}

function isNullHint(node: Node, polarity: "isNull" | "isNotNull"): CounterfactualHint | null {
  const args = Array.isArray(node.args) ? node.args : [];
  if (args.length !== 1) return null;
  const r = refPath(args[0]);
  if (r === null) return null;
  if (polarity === "isNull") {
    return { text: `${r} 가 null 이 되면 통과합니다.`, refPath: r };
  }
  return { text: `${r} 가 null 이 아니게 되면 통과합니다.`, refPath: r };
}

function bareRefHint(node: Node): CounterfactualHint | null {
  const r = refPath(node);
  if (r === null) return null;
  return { text: `${r} 가 true 가 되면 통과합니다.`, refPath: r };
}

/**
 * Decode a guard expression into a safe, statically-provable
 * counterfactual hint, or `null` if the expression is beyond what
 * we can safely claim about.
 */
export function deriveCounterfactualHint(expr: unknown): CounterfactualHint | null {
  const root = asNode(expr);
  if (root === null) return null;

  // Call forms: eq/neq/gt/gte/lt/lte/isNull/isNotNull/not.
  if (root.kind === "call") {
    const op = typeof root.op === "string" ? root.op : null;
    const args = Array.isArray(root.args) ? root.args : [];
    if (op === null) return null;

    if (op === "isNull") return isNullHint(root, "isNull");
    if (op === "isNotNull") return isNullHint(root, "isNotNull");

    if (op === "not" && args.length === 1) {
      // Negation of a bare ref is "ref must become false".
      const inner = args[0];
      const r = refPath(inner);
      if (r !== null) {
        return { text: `${r} 가 false 가 되면 통과합니다.`, refPath: r };
      }
      // Negation of a comparison is the inverse operator.
      if (inner.kind === "call" && typeof inner.op === "string" && Array.isArray(inner.args) && inner.args.length === 2) {
        const invert: Record<string, string> = {
          eq: "neq", neq: "eq",
          gt: "lte", gte: "lt",
          lt: "gte", lte: "gt",
        };
        const opi = invert[inner.op];
        if (opi !== undefined) {
          return comparisonHint(opi, inner.args[0], inner.args[1]);
        }
      }
      return null;
    }

    if (args.length === 2 && ["eq", "neq", "gt", "gte", "lt", "lte"].includes(op)) {
      return comparisonHint(op, args[0], args[1]);
    }

    return null;
  }

  // Binary-op form (some AST producers use kind:"binary" instead of call).
  if (root.kind === "binary" || root.kind === "binop") {
    const op = typeof root.op === "string" ? root.op : null;
    if (op !== null && root.left !== undefined && root.right !== undefined) {
      const normOp: Record<string, string> = {
        "==": "eq", "===": "eq",
        "!=": "neq", "!==": "neq",
        ">": "gt", ">=": "gte",
        "<": "lt", "<=": "lte",
      };
      const normalized = normOp[op];
      if (normalized !== undefined) {
        return comparisonHint(normalized, root.left, root.right);
      }
    }
    return null;
  }

  // Bare ref = boolean state or computed.
  if (root.kind === "ref" || root.kind === "state_ref" || root.kind === "computed_ref") {
    return bareRefHint(root);
  }

  return null;
}

/**
 * Batch: given a list of blockers, produce at most ONE counterfactual
 * hint — the first safely-decodable one. Showing multiple hints
 * invites users to read them as a conjunction, which would require us
 * to *prove* conjunction safety (we can't).
 */
export function firstProvableHint(
  blockers: readonly DispatchBlocker[] | undefined,
): CounterfactualHint | null {
  if (blockers === undefined) return null;
  for (const b of blockers) {
    const h = deriveCounterfactualHint(b.expression);
    if (h !== null) return h;
  }
  return null;
}
