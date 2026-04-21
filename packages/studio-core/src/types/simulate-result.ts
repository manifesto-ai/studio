import type { SimulateResult } from "@manifesto-ai/sdk";

export type StudioSimulateResult = SimulateResult & {
  readonly meta: {
    readonly schemaHash: string;
  };
};
