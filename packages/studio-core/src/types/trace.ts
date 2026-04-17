import type { ExecutionDiagnostics } from "@manifesto-ai/sdk";

export type TraceId = string & { readonly __brand: "TraceId" };

export type HostTrace = NonNullable<ExecutionDiagnostics["hostTraces"]>[number];

export type TraceRecord = {
  readonly id: TraceId;
  readonly intentId: string;
  readonly schemaHash: string;
  readonly raw: HostTrace;
  readonly recordedAt: number;
};
