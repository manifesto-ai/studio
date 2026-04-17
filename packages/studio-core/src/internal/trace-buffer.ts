import type { HostTrace, TraceId, TraceRecord } from "../types/trace.js";

/**
 * FNV-1a 64-bit hash → 16-char hex. Deterministic, sync, isomorphic
 * (Node + browser) — no WebCrypto round-trip needed. TraceId is a stable
 * identifier for reconciliation, not a security primitive; a fast
 * non-cryptographic hash is appropriate.
 */
function fnv1a64Hex(input: string): string {
  // 64-bit arithmetic emulated with two 32-bit halves.
  // Offset basis: 0xcbf29ce484222325; prime: 0x100000001b3.
  let hi = 0xcbf2_9ce4 >>> 0;
  let lo = 0x8422_2325 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    lo ^= ch;
    // Multiply 64-bit (hi,lo) by prime = 0x0000_0100_0000_01b3.
    // Break prime into (pHi=0x00000100, pLo=0x000001b3) so:
    //   result = (hi * pLo) + (lo * pHi) + (lo * pLo [as 64-bit])
    const loP = Math.imul(lo, 0x01b3) >>> 0;
    const loPHi = Math.floor((lo * 0x01b3) / 0x1_0000_0000);
    const hiP = (Math.imul(hi, 0x01b3) + Math.imul(lo, 0x0100)) >>> 0;
    lo = loP >>> 0;
    hi = (hiP + loPHi) >>> 0;
  }
  return (
    hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0")
  );
}

function mintTraceId(intentId: string, hostTraceIndex: number): TraceId {
  return fnv1a64Hex(`${intentId}:${hostTraceIndex}`) as TraceId;
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
