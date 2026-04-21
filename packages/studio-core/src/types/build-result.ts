import type { DomainModule } from "@manifesto-ai/compiler";
import type { Marker } from "../adapter-interface.js";
import type { ReconciliationPlan } from "./reconciliation.js";

export type BuildOk = {
  readonly kind: "ok";
  readonly buildId: string;
  readonly module: DomainModule;
  readonly schemaHash: string;
  readonly plan: ReconciliationPlan;
  readonly warnings: readonly Marker[];
};

export type BuildFail = {
  readonly kind: "fail";
  readonly buildId: string;
  readonly errors: readonly Marker[];
  readonly warnings: readonly Marker[];
};

export type BuildResult = BuildOk | BuildFail;
