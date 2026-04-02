import type { ExprNode, FlowNode, PatchFlow } from "@manifesto-ai/core";

import { collectExprReads } from "./expr.js";
import { patchPathToSemanticPath } from "./path.js";

export type FlowPatchTarget = {
  path: string;
  sourcePath: string;
  op: PatchFlow["op"];
};

export type FlowEffectTarget = {
  index: number;
  type: string;
  sourcePath: string;
};

export type FlowCallTarget = {
  flow: string;
  sourcePath: string;
};

export type FlowConditionTarget = {
  sourcePath: string;
  expr: ExprNode;
};

export type FlowAnalysis = {
  reads: string[];
  patches: FlowPatchTarget[];
  effects: FlowEffectTarget[];
  calls: FlowCallTarget[];
  conditions: FlowConditionTarget[];
  hasExplicitStop: boolean;
};

export function analyzeFlow(flow: FlowNode, basePath: string): FlowAnalysis {
  const reads = new Set<string>();
  const patches: FlowPatchTarget[] = [];
  const effects: FlowEffectTarget[] = [];
  const calls: FlowCallTarget[] = [];
  const conditions: FlowConditionTarget[] = [];
  let effectIndex = 0;
  let hasExplicitStop = false;

  function collectReads(expr: ExprNode): void {
    for (const read of collectExprReads(expr)) {
      reads.add(read);
    }
  }

  function visit(node: FlowNode, nodePath: string): void {
    switch (node.kind) {
      case "seq":
        node.steps.forEach((step, index) => visit(step, `${nodePath}.steps.${index}`));
        break;
      case "if":
        conditions.push({ sourcePath: `${nodePath}.cond`, expr: node.cond });
        collectReads(node.cond);
        visit(node.then, `${nodePath}.then`);
        if (node.else) {
          visit(node.else, `${nodePath}.else`);
        }
        break;
      case "patch":
        patches.push({
          path: patchPathToSemanticPath(node.path),
          sourcePath: nodePath,
          op: node.op
        });
        if (node.value) {
          collectReads(node.value);
        }
        break;
      case "effect":
        effects.push({
          index: effectIndex++,
          type: node.type,
          sourcePath: nodePath
        });
        Object.values(node.params).forEach((expr) => collectReads(expr));
        break;
      case "call":
        calls.push({ flow: node.flow, sourcePath: nodePath });
        break;
      case "halt":
      case "fail":
        hasExplicitStop = true;
        if (node.kind === "fail" && node.message) {
          collectReads(node.message);
        }
        break;
    }
  }

  visit(flow, basePath);

  return {
    reads: [...reads].sort(),
    patches,
    effects,
    calls,
    conditions,
    hasExplicitStop
  };
}

