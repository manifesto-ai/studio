import type { GraphRef } from "./findings.js";
import type { FactProvenance } from "./graph-ir.js";

export type CauseNode = {
  ref: GraphRef;
  fact: string;
  provenance: FactProvenance;
  isRoot: boolean;
};

export type CauseChain = {
  observation: CauseNode;
  path: CauseNode[];
  root: CauseNode;
  summary: string;
};

export type Explanation = CauseChain;

