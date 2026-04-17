import { createHash } from "node:crypto";
import type { HostTrace, TraceId, TraceRecord } from "../types/trace.js";

function mintTraceId(intentId: string, hostTraceIndex: number): TraceId {
  const hash = createHash("sha256")
    .update(`${intentId}:${hostTraceIndex}`)
    .digest("hex")
    .slice(0, 16);
  return hash as TraceId;
}

export type TraceBuffer = {
  append(
    intentId: string,
    schemaHash: string,
    hostTraces: readonly HostTrace[],
  ): readonly TraceId[];
  getAll(): readonly TraceRecord[];
  clear(): void;
};

export function createTraceBuffer(maxSize: number): TraceBuffer {
  const records: TraceRecord[] = [];

  return {
    append(intentId, schemaHash, hostTraces) {
      const ids: TraceId[] = [];
      for (let i = 0; i < hostTraces.length; i++) {
        const raw = hostTraces[i];
        if (raw === undefined) continue;
        const id = mintTraceId(intentId, i);
        ids.push(id);
        records.push({
          id,
          intentId,
          schemaHash,
          raw,
          recordedAt: Date.now(),
        });
      }
      while (records.length > maxSize) {
        records.shift();
      }
      return ids;
    },
    getAll() {
      return records;
    },
    clear() {
      records.length = 0;
    },
  };
}
