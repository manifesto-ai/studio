import { describe, expect, it } from "vitest";
import { compileMelModule, type DomainModule } from "@manifesto-ai/compiler";
import {
  buildEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  EnvelopeCodecError,
  extractPlan,
} from "../internal/envelope-codec.js";
import { computePlan } from "../internal/reconciler.js";
import { serializePlan } from "../types/edit-intent.js";

function compile(source: string): DomainModule {
  const result = compileMelModule(source, { mode: "module" });
  if (result.module === null) {
    throw new Error("compile failed");
  }
  return result.module;
}

const SRC_V1 = `
domain D {
  state { a: number = 0 }
  computed dd = mul(a, 2)
  action inc() { onceIntent { patch a = add(a, 1) } }
}
`.trim();

describe("envelope codec", () => {
  it("builds envelope with required immutable fields", () => {
    const next = compile(SRC_V1);
    const plan = computePlan(null, next);
    const env = buildEnvelope({
      payload: { kind: "rebuild", source: SRC_V1 },
      plan,
      author: "human",
    });

    expect(env.envelopeVersion).toBe(1);
    expect(env.payloadVersion).toBe(1);
    expect(env.payloadKind).toBe("rebuild");
    expect(env.author).toBe("human");
    expect(env.prevSchemaHash).toBeNull();
    expect(env.nextSchemaHash).toBe(next.schema.hash);
    expect(typeof env.id).toBe("string");
    expect(env.id.length).toBeGreaterThan(0);
    expect(typeof env.timestamp).toBe("number");
    expect(env.correlationId).toBeUndefined();
    expect(env.causationId).toBeUndefined();
  });

  it("round-trips through encode/decode", () => {
    const next = compile(SRC_V1);
    const plan = computePlan(null, next);
    const env = buildEnvelope({
      payload: { kind: "rebuild", source: SRC_V1 },
      plan,
      author: "human",
      correlationId: "corr-1",
    });

    const wire = encodeEnvelope(env);
    const decoded = decodeEnvelope(wire);

    expect(decoded.id).toBe(env.id);
    expect(decoded.timestamp).toBe(env.timestamp);
    expect(decoded.nextSchemaHash).toBe(env.nextSchemaHash);
    expect(decoded.correlationId).toBe("corr-1");
    expect(decoded.payload).toEqual(env.payload);
    expect(decoded.plan).toEqual(env.plan);
  });

  it("extractPlan reconstructs ReconciliationPlan with Map identity", () => {
    const next = compile(SRC_V1);
    const plan = computePlan(null, next);
    const env = buildEnvelope({
      payload: { kind: "rebuild", source: SRC_V1 },
      plan,
      author: "human",
    });

    const restored = extractPlan(env);
    expect(restored.identityMap).toBeInstanceOf(Map);
    expect(restored.identityMap.size).toBe(plan.identityMap.size);
    expect(restored.nextSchemaHash).toBe(plan.nextSchemaHash);
  });

  it("rejects unsupported envelope version", () => {
    const next = compile(SRC_V1);
    const plan = computePlan(null, next);
    const env = buildEnvelope({
      payload: { kind: "rebuild", source: SRC_V1 },
      plan,
      author: "human",
    });
    const wire = encodeEnvelope(env).replace(
      '"envelopeVersion":1',
      '"envelopeVersion":2',
    );
    expect(() => decodeEnvelope(wire)).toThrow(EnvelopeCodecError);
  });

  it("rejects unknown payload kind", () => {
    const next = compile(SRC_V1);
    const plan = computePlan(null, next);
    const env = buildEnvelope({
      payload: { kind: "rebuild", source: SRC_V1 },
      plan,
      author: "human",
    });
    const wire = encodeEnvelope(env).replace(
      '"kind":"rebuild"',
      '"kind":"add_action"',
    );
    expect(() => decodeEnvelope(wire)).toThrow(EnvelopeCodecError);
  });

  it("serializePlan/deserializePlan preserves identity entries", () => {
    const next = compile(SRC_V1);
    const plan = computePlan(null, next);
    const serialized = serializePlan(plan);
    expect(serialized.identityMap.length).toBe(plan.identityMap.size);
    for (const [key, fate] of serialized.identityMap) {
      expect(plan.identityMap.get(key)).toEqual(fate);
    }
  });
});
