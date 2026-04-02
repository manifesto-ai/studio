import type { ExprNode } from "@manifesto-ai/core";

type ConstantFoldResult =
  | { constant: true; value: unknown }
  | { constant: false };

function foldArray(args: ExprNode[]): ConstantFoldResult[] {
  return args.map((arg) => foldConstantExpr(arg));
}

function allConstant(results: ConstantFoldResult[]): results is Array<{ constant: true; value: unknown }> {
  return results.every((result) => result.constant);
}

export function collectExprReads(expr: ExprNode): string[] {
  const reads = new Set<string>();

  walkExpr(expr, (node) => {
    if (node.kind === "get") {
      reads.add(node.path);
    }
  });

  return [...reads].sort();
}

export function summarizeExpr(expr: ExprNode): string {
  switch (expr.kind) {
    case "lit":
      return JSON.stringify(expr.value);
    case "get":
      return expr.path;
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod":
      return `(${summarizeExpr(expr.left)} ${expr.kind} ${summarizeExpr(expr.right)})`;
    case "pow":
      return `pow(${summarizeExpr(expr.base)}, ${summarizeExpr(expr.exponent)})`;
    case "and":
    case "or":
      return expr.args.map((arg) => summarizeExpr(arg)).join(` ${expr.kind} `);
    case "not":
      return `not ${summarizeExpr(expr.arg)}`;
    case "if":
      return `if ${summarizeExpr(expr.cond)} then ${summarizeExpr(expr.then)} else ${summarizeExpr(expr.else)}`;
    case "concat":
    case "min":
    case "max":
    case "coalesce":
      return `${expr.kind}(${expr.args.map((arg) => summarizeExpr(arg)).join(", ")})`;
    default:
      return expr.kind;
  }
}

export function foldConstantExpr(expr: ExprNode): ConstantFoldResult {
  switch (expr.kind) {
    case "lit":
      return { constant: true, value: expr.value };
    case "not": {
      const inner = foldConstantExpr(expr.arg);

      return inner.constant ? { constant: true, value: !inner.value } : { constant: false };
    }
    case "and": {
      const args = foldArray(expr.args);
      if (allConstant(args)) {
        return { constant: true, value: args.every((arg) => Boolean(arg.value)) };
      }

      if (args.some((arg) => arg.constant && !arg.value)) {
        return { constant: true, value: false };
      }

      return { constant: false };
    }
    case "or": {
      const args = foldArray(expr.args);
      if (allConstant(args)) {
        return { constant: true, value: args.some((arg) => Boolean(arg.value)) };
      }

      if (args.some((arg) => arg.constant && Boolean(arg.value))) {
        return { constant: true, value: true };
      }

      return { constant: false };
    }
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod": {
      const left = foldConstantExpr(expr.left);
      const right = foldConstantExpr(expr.right);

      if (!left.constant || !right.constant) {
        return { constant: false };
      }

      switch (expr.kind) {
        case "eq":
          return { constant: true, value: left.value === right.value };
        case "neq":
          return { constant: true, value: left.value !== right.value };
        case "gt":
          return { constant: true, value: Number(left.value) > Number(right.value) };
        case "gte":
          return { constant: true, value: Number(left.value) >= Number(right.value) };
        case "lt":
          return { constant: true, value: Number(left.value) < Number(right.value) };
        case "lte":
          return { constant: true, value: Number(left.value) <= Number(right.value) };
        case "add":
          return { constant: true, value: Number(left.value) + Number(right.value) };
        case "sub":
          return { constant: true, value: Number(left.value) - Number(right.value) };
        case "mul":
          return { constant: true, value: Number(left.value) * Number(right.value) };
        case "div":
          return { constant: true, value: Number(left.value) / Number(right.value) };
        case "mod":
          return { constant: true, value: Number(left.value) % Number(right.value) };
      }
    }
    case "if": {
      const cond = foldConstantExpr(expr.cond);
      if (!cond.constant) {
        return { constant: false };
      }

      return foldConstantExpr(cond.value ? expr.then : expr.else);
    }
    default:
      return { constant: false };
  }
}

export function walkExpr(expr: ExprNode, visit: (expr: ExprNode) => void): void {
  visit(expr);

  switch (expr.kind) {
    case "not":
    case "abs":
    case "neg":
    case "floor":
    case "ceil":
    case "round":
    case "sqrt":
    case "toString":
    case "toNumber":
    case "toBoolean":
    case "typeof":
    case "isNull":
      walkExpr(expr.arg, visit);
      break;
    case "sumArray":
    case "minArray":
    case "maxArray":
    case "first":
    case "last":
    case "reverse":
    case "flat":
      walkExpr(expr.array, visit);
      break;
    case "len":
      walkExpr(expr.arg, visit);
      break;
    case "keys":
    case "values":
      walkExpr(expr.obj, visit);
      break;
    case "strLen":
    case "toLowerCase":
    case "toUpperCase":
    case "trim":
      walkExpr(expr.str, visit);
      break;
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod":
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      break;
    case "pow":
      walkExpr(expr.base, visit);
      walkExpr(expr.exponent, visit);
      break;
    case "and":
    case "or":
    case "concat":
    case "min":
    case "max":
    case "coalesce":
      expr.args.forEach((arg) => walkExpr(arg, visit));
      break;
    case "if":
      walkExpr(expr.cond, visit);
      walkExpr(expr.then, visit);
      walkExpr(expr.else, visit);
      break;
    case "object":
      Object.values(expr.fields).forEach((value) => walkExpr(value, visit));
      break;
    case "field":
      walkExpr(expr.object, visit);
      break;
    case "merge":
      expr.objects.forEach((value) => walkExpr(value, visit));
      break;
    case "pick":
    case "omit":
      walkExpr(expr.obj, visit);
      walkExpr(expr.keys, visit);
      break;
    case "fromEntries":
      walkExpr(expr.entries, visit);
      break;
    case "substring":
      walkExpr(expr.str, visit);
      walkExpr(expr.start, visit);
      if (expr.end) {
        walkExpr(expr.end, visit);
      }
      break;
    case "startsWith":
      walkExpr(expr.str, visit);
      walkExpr(expr.prefix, visit);
      break;
    case "endsWith":
      walkExpr(expr.str, visit);
      walkExpr(expr.suffix, visit);
      break;
    case "strIncludes":
      walkExpr(expr.str, visit);
      walkExpr(expr.search, visit);
      break;
    case "indexOf":
      walkExpr(expr.str, visit);
      walkExpr(expr.search, visit);
      break;
    case "replace":
      walkExpr(expr.str, visit);
      walkExpr(expr.search, visit);
      walkExpr(expr.replacement, visit);
      break;
    case "split":
      walkExpr(expr.str, visit);
      walkExpr(expr.delimiter, visit);
      break;
    case "slice":
      walkExpr(expr.array, visit);
      walkExpr(expr.start, visit);
      if (expr.end) {
        walkExpr(expr.end, visit);
      }
      break;
    case "at":
      walkExpr(expr.array, visit);
      walkExpr(expr.index, visit);
      break;
    case "includes":
      walkExpr(expr.array, visit);
      walkExpr(expr.item, visit);
      break;
    case "filter":
    case "find":
    case "every":
    case "some":
      walkExpr(expr.array, visit);
      walkExpr(expr.predicate, visit);
      break;
    case "map":
      walkExpr(expr.array, visit);
      walkExpr(expr.mapper, visit);
      break;
    case "append":
      walkExpr(expr.array, visit);
      expr.items.forEach((item) => walkExpr(item, visit));
      break;
    case "hasKey":
      walkExpr(expr.obj, visit);
      walkExpr(expr.key, visit);
      break;
    case "lit":
    case "get":
      break;
  }
}
