import type {
  DomainModule,
  Marker,
  Snapshot,
  SourceSpan,
  WorldLineage,
} from "@manifesto-ai/studio-core";
import type { StudioUiSnapshot } from "@/domain/StudioUiRuntime";
import {
  readAnnotationDigest,
  type AnnotationDigest,
} from "../agent/digest/manifesto-digest.js";

export type ManifestoProjectionInput = {
  readonly studio: StudioUiSnapshot;
  readonly module: DomainModule | null;
  readonly snapshot: Snapshot<unknown> | null;
  readonly lineage: WorldLineage | null;
  readonly diagnostics: readonly Marker[];
  readonly activeProjectName?: string | null;
  readonly isActionAvailable?: (name: string) => boolean;
};

export type ManifestoEntityKind = "state" | "computed" | "action";

export type ManifestoEntityRef = {
  readonly nodeId: string;
  readonly kind: ManifestoEntityKind;
  readonly name: string;
};

export type ManifestoRelation = {
  readonly peer: ManifestoEntityRef;
  readonly relation: "feeds" | "mutates" | "unlocks";
  readonly direction: "in" | "out";
};

export type ManifestoValueProjection = {
  readonly path: string;
  readonly value: unknown;
  readonly summary: string;
};

export type ManifestoActionProjection = {
  readonly params: readonly string[];
  readonly paramHints: readonly string[];
  readonly inputHint: string | null;
  readonly available: boolean | null;
  readonly hasDispatchableGate: boolean;
  readonly description: string | null;
};

export type ManifestoEntityProjection =
  | {
      readonly status: "ok";
      readonly ref: ManifestoEntityRef;
      readonly schemaHash: string;
      readonly localKey: string;
      readonly label: string;
      readonly type: string | null;
      readonly annotations: AnnotationDigest | null;
      readonly sourceSpan: SourceSpan | null;
      readonly value: ManifestoValueProjection | null;
      readonly action: ManifestoActionProjection | null;
      readonly relations: {
        readonly incoming: readonly ManifestoRelation[];
        readonly outgoing: readonly ManifestoRelation[];
      };
      readonly lineage: {
        readonly recentChangedWorldIds: readonly string[];
      };
    }
  | {
      readonly status: "schema_unavailable" | "invalid_ref" | "missing";
      readonly ref: ManifestoEntityRef | null;
      readonly nodeId: string | null;
      readonly reason: string;
    };

export type ManifestoFocusProjection = {
  readonly status:
    | "ok"
    | "none"
    | "schema_unavailable"
    | "invalid_ref"
    | "missing";
  readonly studio: ManifestoStudioProjection;
  readonly focus: {
    readonly nodeId: string;
    readonly kind: ManifestoEntityKind;
    readonly origin: string | null;
  } | null;
  readonly entity: ManifestoEntityProjection | null;
  readonly summary: string;
};

export type ManifestoStudioProjection = {
  readonly activeLens: string;
  readonly viewMode: string;
  readonly simulationActionName: string | null;
  readonly scrubEnvelopeId: string | null;
  readonly activeProjectName: string | null;
};

export type ManifestoWorldProjection = {
  readonly viewMode: string;
  readonly simulationActionName: string | null;
  readonly scrubEnvelopeId: string | null;
  readonly headWorldId: string | null;
  readonly schemaHash: string | null;
};

export type ManifestoProjectProjection = {
  readonly activeProjectName: string | null;
  readonly moduleReady: boolean;
  readonly schemaHash: string | null;
  readonly diagnosticsCount: number;
};

export function projectFocus(
  input: ManifestoProjectionInput,
): ManifestoFocusProjection {
  const studio = projectStudio(input);
  const nodeId = input.studio.focusedNodeId;
  if (nodeId === null) {
    return {
      status: "none",
      studio,
      focus: null,
      entity: null,
      summary: "No MEL entity is focused.",
    };
  }

  const ref = parseEntityRef(nodeId);
  if (ref === null) {
    return {
      status: "invalid_ref",
      studio,
      focus: null,
      entity: {
        status: "invalid_ref",
        ref: null,
        nodeId,
        reason: `Invalid focused node id "${nodeId}".`,
      },
      summary: `The focused node id "${nodeId}" is not a MEL entity ref.`,
    };
  }

  const entity = projectEntity(ref, input);
  return {
    status: entity.status,
    studio,
    focus: {
      nodeId: ref.nodeId,
      kind: ref.kind,
      origin: input.studio.focusedNodeOrigin,
    },
    entity,
    summary: summarizeFocus(entity),
  };
}

export function projectEntity(
  target: string | ManifestoEntityRef,
  input: ManifestoProjectionInput,
): ManifestoEntityProjection {
  const ref = typeof target === "string" ? parseEntityRef(target) : target;
  if (ref === null) {
    return {
      status: "invalid_ref",
      ref: null,
      nodeId: typeof target === "string" ? target : null,
      reason: "Expected a graph node id in `<kind>:<name>` format.",
    };
  }
  if (input.module === null) {
    return {
      status: "schema_unavailable",
      ref,
      nodeId: ref.nodeId,
      reason: "No compiled MEL schema is available.",
    };
  }

  const graphNode = input.module.graph.nodes.find((n) => n.id === ref.nodeId);
  if (graphNode === undefined) {
    return {
      status: "missing",
      ref,
      nodeId: ref.nodeId,
      reason: `The current schema has no node "${ref.nodeId}".`,
    };
  }

  const localKey = toLocalKey(ref);
  const sourceSpan = input.module.sourceMap.entries[
    localKey as keyof typeof input.module.sourceMap.entries
  ]?.span ?? null;
  return {
    status: "ok",
    ref,
    schemaHash: input.module.schema.hash,
    localKey,
    label: `${ref.kind}.${ref.name}`,
    type: readEntityType(ref, input.module),
    annotations: readAnnotationDigest(input.module, localKey),
    sourceSpan,
    value: projectValue(ref, input.snapshot),
    action:
      ref.kind === "action" ? projectActionDetails(ref.name, input) : null,
    relations: projectRelations(ref, input.module),
    lineage: {
      recentChangedWorldIds: projectChangedWorldIds(ref, input.lineage),
    },
  };
}

export function projectAction(
  name: string,
  input: ManifestoProjectionInput,
): ManifestoEntityProjection {
  return projectEntity(`action:${name}`, input);
}

export function projectWorld(
  input: ManifestoProjectionInput,
): ManifestoWorldProjection {
  return {
    viewMode: input.studio.viewMode,
    simulationActionName: input.studio.simulationActionName,
    scrubEnvelopeId: input.studio.scrubEnvelopeId,
    headWorldId:
      input.lineage?.head?.worldId !== undefined
        ? String(input.lineage.head.worldId)
        : null,
    schemaHash: input.module?.schema.hash ?? null,
  };
}

export function projectProject(
  input: ManifestoProjectionInput,
): ManifestoProjectProjection {
  return {
    activeProjectName:
      input.activeProjectName ?? input.studio.activeProjectName ?? null,
    moduleReady: input.module !== null,
    schemaHash: input.module?.schema.hash ?? null,
    diagnosticsCount: input.diagnostics.length,
  };
}

export function projectStudio(
  input: ManifestoProjectionInput,
): ManifestoStudioProjection {
  return {
    activeLens: input.studio.activeLens,
    viewMode: input.studio.viewMode,
    simulationActionName: input.studio.simulationActionName,
    scrubEnvelopeId: input.studio.scrubEnvelopeId,
    activeProjectName:
      input.activeProjectName ?? input.studio.activeProjectName ?? null,
  };
}

export function parseEntityRef(nodeId: string): ManifestoEntityRef | null {
  const idx = nodeId.indexOf(":");
  if (idx <= 0 || idx === nodeId.length - 1) return null;
  const kind = nodeId.slice(0, idx);
  if (kind !== "state" && kind !== "computed" && kind !== "action") {
    return null;
  }
  const name = nodeId.slice(idx + 1);
  return { nodeId, kind, name };
}

function projectActionDetails(
  name: string,
  input: ManifestoProjectionInput,
): ManifestoActionProjection | null {
  const action = asRecord(asRecord(input.module?.schema)?.actions)?.[name];
  if (action === undefined) return null;
  const spec = asRecord(action);
  return {
    params: readStringArray(spec?.params),
    ...summarizeActionInput(action, input.module?.schema),
    available:
      input.isActionAvailable === undefined
        ? null
        : safeBoolOrNull(() => input.isActionAvailable!(name)),
    hasDispatchableGate: spec?.dispatchable !== undefined,
    description:
      typeof spec?.description === "string" && spec.description.trim() !== ""
        ? spec.description.trim()
        : null,
  };
}

function projectRelations(
  ref: ManifestoEntityRef,
  module: DomainModule,
): {
  readonly incoming: readonly ManifestoRelation[];
  readonly outgoing: readonly ManifestoRelation[];
} {
  const incoming: ManifestoRelation[] = [];
  const outgoing: ManifestoRelation[] = [];
  for (const edge of module.graph.edges) {
    if (edge.to === ref.nodeId) {
      const peer = parseEntityRef(edge.from);
      if (peer !== null) {
        incoming.push({
          peer,
          relation: edge.relation,
          direction: "in",
        });
      }
    }
    if (edge.from === ref.nodeId) {
      const peer = parseEntityRef(edge.to);
      if (peer !== null) {
        outgoing.push({
          peer,
          relation: edge.relation,
          direction: "out",
        });
      }
    }
  }
  return { incoming, outgoing };
}

function projectValue(
  ref: ManifestoEntityRef,
  snapshot: Snapshot<unknown> | null,
): ManifestoValueProjection | null {
  if (snapshot === null || ref.kind === "action") return null;
  const source =
    ref.kind === "state"
      ? asRecord((snapshot as { readonly data?: unknown }).data)
      : asRecord((snapshot as { readonly computed?: unknown }).computed);
  const value = source?.[ref.name];
  const path =
    ref.kind === "state" ? `data.${ref.name}` : `computed.${ref.name}`;
  return {
    path,
    value,
    summary: summarizeValue(value),
  };
}

function projectChangedWorldIds(
  ref: ManifestoEntityRef,
  lineage: WorldLineage | null,
): readonly string[] {
  if (lineage === null || ref.kind === "action") return [];
  const prefix =
    ref.kind === "state" ? `data.${ref.name}` : `computed.${ref.name}`;
  return lineage.worlds
    .slice()
    .reverse()
    .filter((world) =>
      world.changedPaths.some(
        (path) => path === prefix || path.startsWith(`${prefix}.`),
      ),
    )
    .slice(0, 5)
    .map((world) => String(world.id));
}

function readEntityType(
  ref: ManifestoEntityRef,
  module: DomainModule,
): string | null {
  const schema = asRecord(module.schema);
  if (ref.kind === "state") {
    const state = asRecord(schema?.state);
    const fields = asRecord(state?.fields);
    const fieldTypes = asRecord(state?.fieldTypes);
    const spec = asRecord(fields?.[ref.name]);
    return firstTypeSummary(
      fieldTypes?.[ref.name],
      spec?.type,
      spec?.definition,
      spec?.valueType,
      spec,
      schema,
    );
  }
  if (ref.kind === "computed") {
    const computed = asRecord(schema?.computed);
    const fields = asRecord(computed?.fields);
    const fieldTypes = asRecord(computed?.fieldTypes);
    const spec = asRecord(fields?.[ref.name]);
    return firstTypeSummary(
      fieldTypes?.[ref.name],
      spec?.type,
      spec?.definition,
      spec?.valueType,
      spec,
      schema,
    );
  }
  const action = asRecord(asRecord(schema?.actions)?.[ref.name]);
  const input = summarizeActionInput(action, schema);
  return input.inputHint === null ? "no input" : input.inputHint;
}

function firstTypeSummary(
  ...values: readonly unknown[]
): string | null {
  const schema = values[values.length - 1];
  for (const value of values.slice(0, -1)) {
    if (value === undefined || value === null) continue;
    const summary = summarizeType(value, schema);
    if (summary !== "unknown") return summary;
  }
  return null;
}

function toLocalKey(ref: ManifestoEntityRef): string {
  return ref.kind === "state" ? `state_field:${ref.name}` : ref.nodeId;
}

function summarizeFocus(entity: ManifestoEntityProjection): string {
  if (entity.status !== "ok") return entity.reason;
  if (entity.ref.kind === "action") {
    const available = entity.action?.available;
    const availability =
      available === null
        ? "availability unknown"
        : available
          ? "available"
          : "unavailable";
    return `Focused action ${entity.ref.name} (${availability}).`;
  }
  const type = entity.type === null ? "unknown type" : entity.type;
  const value =
    entity.value === null ? "no snapshot value" : entity.value.summary;
  return `Focused ${entity.ref.kind} ${entity.ref.name}: ${type}, ${value}.`;
}

function summarizeActionInput(
  actionSpec: unknown,
  schema: unknown,
): Pick<ManifestoActionProjection, "paramHints" | "inputHint"> {
  const action = asRecord(actionSpec);
  const paramNames = readStringArray(action?.params);
  const inputType = action?.inputType;
  if (inputType === undefined) {
    return {
      paramHints: paramNames,
      inputHint: paramNames.length === 0 ? null : paramNames.join(", "),
    };
  }

  const input = summarizeType(inputType, schema);
  const inputRecord = asRecord(inputType);
  if (inputRecord?.kind === "object") {
    const fields = asRecord(inputRecord.fields);
    const paramHints = paramNames.map((name) => {
      const field = asRecord(fields?.[name]);
      const optional = field?.optional === true ? "?" : "";
      return `${name}${optional}: ${summarizeType(field?.type, schema)}`;
    });
    return {
      paramHints,
      inputHint: paramHints.length === 0 ? input : paramHints.join(", "),
    };
  }

  if (paramNames.length === 1) {
    return {
      paramHints: [`${paramNames[0]}: ${input}`],
      inputHint: `${paramNames[0]}: ${input}`,
    };
  }
  return {
    paramHints: paramNames,
    inputHint: input,
  };
}

function summarizeType(
  typeDef: unknown,
  schema: unknown,
  seenRefs: ReadonlySet<string> = new Set(),
): string {
  if (typeof typeDef === "string") return typeDef;
  const def = asRecord(typeDef);
  if (def === null) return "unknown";
  const kind = def.kind;
  switch (kind) {
    case "primitive":
      return typeof def.type === "string" ? def.type : "unknown";
    case "literal":
      return JSON.stringify(def.value);
    case "array":
      return `${summarizeType(def.element, schema, seenRefs)}[]`;
    case "record":
    return `Record<${summarizeType(
      def.key,
      schema,
      seenRefs,
    )}, ${summarizeType(def.value, schema, seenRefs)}>`;
    case "object": {
      const entries = Object.entries(asRecord(def.fields) ?? {})
        .slice(0, 12)
        .map(([name, value]) => {
          const field = asRecord(value);
          const optional = field?.optional === true ? "?" : "";
          return `${name}${optional}: ${summarizeType(field?.type, schema, seenRefs)}`;
        });
      const suffix =
        Object.keys(asRecord(def.fields) ?? {}).length > entries.length
          ? ", ..."
          : "";
      return `{ ${entries.join(", ")}${suffix} }`;
    }
    case "union": {
      const types = Array.isArray(def.types) ? def.types : [];
      if (types.length === 0) return "unknown";
      return types
        .slice(0, 12)
        .map((entry) => summarizeType(entry, schema, seenRefs))
        .join(" | ");
    }
    case "ref": {
      if (typeof def.name !== "string") return "unknown";
      if (seenRefs.has(def.name)) return def.name;
      const typeSpec = asRecord(asRecord(schema)?.types)?.[def.name];
      const definition = asRecord(typeSpec)?.definition;
      if (definition === undefined) return def.name;
      const nextSeen = new Set(seenRefs);
      nextSeen.add(def.name);
      return summarizeType(definition, schema, nextSeen);
    }
    default:
      return "unknown";
  }
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") {
    return value === "" ? "empty string" : JSON.stringify(value);
  }
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return String(value);
    return serialized.length > 120
      ? `${serialized.slice(0, 117)}...`
      : serialized;
  } catch {
    return String(value);
  }
}

function safeBoolOrNull(fn: () => boolean): boolean | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
