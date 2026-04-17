import type { DomainModule } from "@manifesto-ai/compiler";
import type {
  IdentityFate,
  LocalTargetKey,
  ReconciliationPlan,
  SnapshotReconciliation,
  TraceTagging,
} from "../types/reconciliation.js";
import type { TraceId, TraceRecord } from "../types/trace.js";

type DomainSchema = DomainModule["schema"];
type StateFieldSpec = DomainSchema["state"]["fields"][string];
type FieldTypeDef = NonNullable<DomainSchema["state"]["fieldTypes"]>[string];

type RenameIntent = {
  readonly from: LocalTargetKey;
  readonly to: LocalTargetKey;
};

export type ComputePlanOptions = {
  readonly renames?: readonly RenameIntent[];
};

type TargetKind = "state_field" | "computed" | "action";

type TargetEntry = {
  readonly kind: TargetKind;
  readonly key: LocalTargetKey;
  readonly name: string;
  readonly signature: string | null;
};

const STATE_FIELD_PREFIX = "state_field:" as const;
const COMPUTED_PREFIX = "computed:" as const;
const ACTION_PREFIX = "action:" as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

function stateFieldSignature(
  name: string,
  spec: StateFieldSpec,
  richType: FieldTypeDef | undefined,
): string {
  if (richType !== undefined) {
    return `rich:${stableStringify(richType)}`;
  }
  const { type, required, fields, items } = spec;
  return `basic:${stableStringify({ type, required, fields, items })}`;
}

function enumerateTargets(module: DomainModule): Map<LocalTargetKey, TargetEntry> {
  const entries = new Map<LocalTargetKey, TargetEntry>();
  const schema = module.schema;
  const fieldTypes = schema.state.fieldTypes;

  for (const name of Object.keys(schema.state.fields).sort()) {
    const spec = schema.state.fields[name];
    if (spec === undefined) continue;
    const key = `${STATE_FIELD_PREFIX}${name}` as LocalTargetKey;
    entries.set(key, {
      kind: "state_field",
      key,
      name,
      signature: stateFieldSignature(name, spec, fieldTypes?.[name]),
    });
  }

  for (const name of Object.keys(schema.computed.fields).sort()) {
    const key = `${COMPUTED_PREFIX}${name}` as LocalTargetKey;
    entries.set(key, { kind: "computed", key, name, signature: null });
  }

  for (const name of Object.keys(schema.actions).sort()) {
    const key = `${ACTION_PREFIX}${name}` as LocalTargetKey;
    entries.set(key, { kind: "action", key, name, signature: null });
  }

  return entries;
}

function buildIdentityMap(
  prev: Map<LocalTargetKey, TargetEntry> | null,
  next: Map<LocalTargetKey, TargetEntry>,
  renames: readonly RenameIntent[] | undefined,
): Map<LocalTargetKey, IdentityFate> {
  const map = new Map<LocalTargetKey, IdentityFate>();
  const renameByTo = new Map<LocalTargetKey, LocalTargetKey>();
  if (renames) {
    for (const r of renames) renameByTo.set(r.to, r.from);
  }

  if (prev === null) {
    for (const key of [...next.keys()].sort()) {
      map.set(key, { kind: "initialized", reason: "new" });
    }
    return map;
  }

  const union = new Set<LocalTargetKey>([...prev.keys(), ...next.keys()]);
  for (const key of [...union].sort()) {
    const prevEntry = prev.get(key);
    const nextEntry = next.get(key);
    const renamedFrom = renameByTo.get(key);

    if (prevEntry === undefined && nextEntry !== undefined) {
      if (renamedFrom !== undefined && prev.has(renamedFrom)) {
        map.set(key, { kind: "renamed", from: renamedFrom });
      } else {
        map.set(key, { kind: "initialized", reason: "new" });
      }
      continue;
    }

    if (prevEntry !== undefined && nextEntry === undefined) {
      map.set(key, { kind: "discarded", reason: "removed" });
      continue;
    }

    if (prevEntry !== undefined && nextEntry !== undefined) {
      if (nextEntry.signature === null) {
        map.set(key, { kind: "preserved" });
        continue;
      }
      if (prevEntry.signature === nextEntry.signature) {
        map.set(key, { kind: "preserved" });
      } else {
        map.set(key, { kind: "discarded", reason: "type_incompatible" });
      }
    }
  }
  return map;
}

function buildSnapshotPlan(
  identityMap: Map<LocalTargetKey, IdentityFate>,
): SnapshotReconciliation {
  const preserved: LocalTargetKey[] = [];
  const initialized: LocalTargetKey[] = [];
  const discarded: LocalTargetKey[] = [];

  for (const [key, fate] of identityMap.entries()) {
    if (!key.startsWith(STATE_FIELD_PREFIX)) continue;
    switch (fate.kind) {
      case "preserved":
        preserved.push(key);
        break;
      case "initialized":
        initialized.push(key);
        break;
      case "discarded":
        discarded.push(key);
        break;
      case "renamed":
        preserved.push(key);
        break;
    }
  }

  return {
    preserved,
    initialized,
    discarded,
    warned: [],
  };
}

export function computePlan(
  prev: DomainModule | null,
  next: DomainModule,
  opts?: ComputePlanOptions,
): ReconciliationPlan {
  const prevTargets = prev === null ? null : enumerateTargets(prev);
  const nextTargets = enumerateTargets(next);
  const identityMap = buildIdentityMap(prevTargets, nextTargets, opts?.renames);
  const snapshotPlan = buildSnapshotPlan(identityMap);

  return {
    prevSchemaHash: prev === null ? null : prev.schema.hash,
    nextSchemaHash: next.schema.hash,
    identityMap,
    snapshotPlan,
    traceTag: {
      stillValid: [],
      obsolete: [],
      renamed: [],
    },
  };
}

export function tagTraces(
  records: readonly TraceRecord[],
  next: DomainModule,
): TraceTagging {
  const nextActions = next.schema.actions;
  const stillValid: TraceId[] = [];
  const obsolete: TraceId[] = [];

  for (const record of records) {
    const actionName = record.raw.intent.type;
    if (actionName in nextActions) {
      stillValid.push(record.id);
    } else {
      obsolete.push(record.id);
    }
  }

  return { stillValid, obsolete, renamed: [] };
}

export function withTraceTagging(
  plan: ReconciliationPlan,
  traceTag: TraceTagging,
): ReconciliationPlan {
  return { ...plan, traceTag };
}
