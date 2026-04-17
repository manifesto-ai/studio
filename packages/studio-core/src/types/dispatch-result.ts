import type { DispatchReport } from "@manifesto-ai/sdk";
import type { TraceId } from "./trace.js";

export type StudioDispatchResult =
  | (Extract<DispatchReport, { readonly kind: "completed" }> & {
      readonly traceIds: readonly TraceId[];
    })
  | (Extract<DispatchReport, { readonly kind: "rejected" }> & {
      readonly traceIds: readonly TraceId[];
    })
  | (Extract<DispatchReport, { readonly kind: "failed" }> & {
      readonly traceIds: readonly TraceId[];
    });
