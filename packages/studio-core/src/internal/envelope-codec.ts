import { webCrypto } from "./web-crypto.js";
import type { ReconciliationPlan } from "../types/reconciliation.js";
import {
  deserializePlan,
  serializePlan,
  type EditIntent,
  type EditIntentAuthor,
  type EditIntentEnvelope,
  type EnvelopeVersion,
  type PayloadVersion,
} from "../types/edit-intent.js";

const SUPPORTED_ENVELOPE_VERSION: EnvelopeVersion = 1;
const SUPPORTED_PAYLOAD_VERSION: PayloadVersion = 1;

export type BuildEnvelopeInput = {
  readonly payload: EditIntent;
  readonly plan: ReconciliationPlan;
  readonly author: EditIntentAuthor;
  readonly correlationId?: string;
  readonly causationId?: string;
};

/**
 * Mint a fresh envelope. `id` is a UUID and `timestamp` is `Date.now()`.
 * Callers wanting deterministic IDs for replay should construct envelopes
 * directly via the literal shape.
 */
export function buildEnvelope(input: BuildEnvelopeInput): EditIntentEnvelope {
  const { payload, plan, author, correlationId, causationId } = input;
  return {
    id: webCrypto.randomUUID(),
    timestamp: Date.now(),
    envelopeVersion: SUPPORTED_ENVELOPE_VERSION,
    payloadKind: payload.kind,
    payloadVersion: SUPPORTED_PAYLOAD_VERSION,
    prevSchemaHash: plan.prevSchemaHash,
    nextSchemaHash: plan.nextSchemaHash,
    author,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(causationId !== undefined ? { causationId } : {}),
    payload,
    plan: serializePlan(plan),
  };
}

export function encodeEnvelope(envelope: EditIntentEnvelope): string {
  return JSON.stringify(envelope);
}

export class EnvelopeCodecError extends Error {
  constructor(message: string) {
    super(`[studio-core] envelope codec: ${message}`);
    this.name = "EnvelopeCodecError";
  }
}

function assertPayloadShape(payload: unknown): asserts payload is EditIntent {
  if (
    payload === null ||
    typeof payload !== "object" ||
    !("kind" in payload) ||
    typeof (payload as { kind: unknown }).kind !== "string"
  ) {
    throw new EnvelopeCodecError("payload missing kind");
  }
  const kind = (payload as { kind: string }).kind;
  if (kind !== "rebuild" && kind !== "rename_decl") {
    throw new EnvelopeCodecError(`unknown payload kind: ${kind}`);
  }
}

export function decodeEnvelope(text: string): EditIntentEnvelope {
  const parsed = JSON.parse(text) as Record<string, unknown>;

  if (parsed.envelopeVersion !== SUPPORTED_ENVELOPE_VERSION) {
    throw new EnvelopeCodecError(
      `unsupported envelopeVersion ${String(parsed.envelopeVersion)}`,
    );
  }
  if (parsed.payloadVersion !== SUPPORTED_PAYLOAD_VERSION) {
    throw new EnvelopeCodecError(
      `unsupported payloadVersion ${String(parsed.payloadVersion)}`,
    );
  }
  assertPayloadShape(parsed.payload);

  // Trust remaining fields — they are dumb data, validated at schema-hash match time.
  return parsed as unknown as EditIntentEnvelope;
}

export function extractPlan(envelope: EditIntentEnvelope): ReconciliationPlan {
  return deserializePlan(envelope.plan);
}
