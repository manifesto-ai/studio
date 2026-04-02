import type {
  ActionAvailabilityProjection,
  DomainGraphProjection,
  DomainGraphProjectionNode,
  DomainSchema,
  FindingsReportProjection,
  ObservationRecord
} from "@manifesto-ai/studio-core";
import type { Diagnostic } from "@manifesto-ai/compiler";

type SchemaFieldDefinition = {
  type: unknown;
  required?: boolean;
  fields?: Record<string, SchemaFieldDefinition>;
};

type SchemaObjectDefinition = {
  type: "object";
  required?: boolean;
  fields?: Record<string, SchemaFieldDefinition>;
};

export type ActionInputField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum" | "json";
  required: boolean;
  options?: string[];
};

export type ActionSpec = {
  id: string;
  description?: string;
  fields: ActionInputField[];
  available?: boolean;
  blockerCount?: number;
};

export type OutlineEntry = {
  id: string;
  label: string;
  hint?: string;
  nodeId: string;
};

export type OutlineSection = {
  id: string;
  label: string;
  entries: OutlineEntry[];
};

export type SchemaTreeItem = {
  id: string;
  name: string;
  hint?: string;
  children?: SchemaTreeItem[];
};

export type RuntimeLogEntry = ObservationRecord;

export const STARTER_MEL_SOURCE = `domain EditorialBoard {
  type Review = {
    assigned: boolean,
    approved: boolean
  }

  state {
    title: string = ""
    body: string = ""
    hasAuthor: boolean = false
    authorName: string = ""
    reviewRequested: boolean = false
    review: Review = {
      assigned: false,
      approved: false
    }
    published: boolean = false
    publishAttempts: number = 0
  }

  computed canRequestReview = and(hasAuthor, not(reviewRequested))
  computed readyForPublish = and(reviewRequested, review.assigned, review.approved, not(published))
  computed hasPublishedDraft = published

  action assignAuthor(name: string) {
    onceIntent {
      patch authorName = name
      patch hasAuthor = true
    }
  }

  action requestReview() {
    onceIntent when canRequestReview {
      patch reviewRequested = true
      patch review = {
        assigned: true,
        approved: false
      }
    }
  }

  action approveReview() {
    onceIntent when reviewRequested {
      patch review = {
        assigned: review.assigned,
        approved: true
      }
    }
  }

  action publish() {
    onceIntent when readyForPublish {
      patch published = true
      patch publishAttempts = add(publishAttempts, 1)
    }
  }

  action retract() {
    onceIntent when published {
      patch published = false
    }
  }
}`;

function fieldTypeName(field: SchemaFieldDefinition): ActionInputField["type"] {
  if (typeof field.type === "string") {
    switch (field.type) {
      case "number":
      case "string":
      case "boolean":
        return field.type;
      default:
        return "json";
    }
  }

  if (field.type && typeof field.type === "object" && "enum" in field.type) {
    return "enum";
  }

  return "json";
}

function fieldOptions(field: SchemaFieldDefinition): string[] | undefined {
  if (!field.type || typeof field.type !== "object" || !("enum" in field.type)) {
    return undefined;
  }

  const options = field.type.enum;
  return Array.isArray(options) ? options.map((option) => String(option)) : undefined;
}

function getActionInputFields(schema: DomainSchema, actionId: string): ActionInputField[] {
  const action = schema.actions[actionId];
  if (!action || !action.input) {
    return [];
  }

  const input = action.input as SchemaObjectDefinition;
  if (input.type !== "object" || !input.fields) {
    return [
      {
        key: "value",
        label: "value",
        type: "json",
        required: true
      }
    ];
  }

  return Object.entries(input.fields).map(([key, field]) => ({
    key,
    label: key,
    type: fieldTypeName(field),
    required: field.required ?? true,
    options: fieldOptions(field)
  }));
}

function flattenStateFields(
  fields: Record<string, SchemaFieldDefinition>,
  prefix?: string
): OutlineEntry[] {
  return Object.entries(fields).flatMap(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const current: OutlineEntry = {
      id: `outline:state:${path}`,
      label: path,
      hint:
        typeof field.type === "string"
          ? field.type
          : field.type && typeof field.type === "object" && "enum" in field.type
            ? "enum"
            : "object",
      nodeId: `state:${path}`
    };

    if (!field.fields) {
      return [current];
    }

    return [current, ...flattenStateFields(field.fields, path)];
  });
}

function buildStateTree(
  fields: Record<string, SchemaFieldDefinition>,
  prefix?: string
): SchemaTreeItem[] {
  return Object.entries(fields).map(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const hint =
      typeof field.type === "string"
        ? field.type
        : field.type && typeof field.type === "object" && "enum" in field.type
          ? "enum"
          : "object";

    return {
      id: `state:${path}`,
      name: key,
      hint,
      children: field.fields ? buildStateTree(field.fields, path) : undefined
    };
  });
}

export function buildSchemaTree(schema: DomainSchema): SchemaTreeItem[] {
  return [
    {
      id: "group:state",
      name: "state",
      children: buildStateTree(schema.state.fields)
    },
    {
      id: "group:computed",
      name: "computed",
      children: Object.keys(schema.computed.fields).map((path) => ({
        id: `computed:${path}`,
        name: path,
        hint: "computed"
      }))
    },
    {
      id: "group:actions",
      name: "actions",
      children: Object.keys(schema.actions).map((actionId) => ({
        id: `action:${actionId}`,
        name: actionId,
        hint: schema.actions[actionId]?.description
      }))
    }
  ];
}

export function buildOutline(schema: DomainSchema): OutlineSection[] {
  return [
    {
      id: "state",
      label: "State",
      entries: flattenStateFields(schema.state.fields)
    },
    {
      id: "computed",
      label: "Computed",
      entries: Object.keys(schema.computed.fields).map((path) => ({
        id: `outline:computed:${path}`,
        label: path,
        hint: "computed",
        nodeId: `computed:${path}`
      }))
    },
    {
      id: "actions",
      label: "Actions",
      entries: Object.keys(schema.actions).map((actionId) => ({
        id: `outline:action:${actionId}`,
        label: actionId,
        hint: schema.actions[actionId]?.description,
        nodeId: `action:${actionId}`
      }))
    }
  ];
}

export function buildActionSpecs(
  schema: DomainSchema,
  availability: ActionAvailabilityProjection[]
): ActionSpec[] {
  const availabilityByAction = new Map(
    availability.map((entry) => [entry.actionId, entry] as const)
  );

  return Object.keys(schema.actions).map((actionId) => {
    const availabilityEntry = availabilityByAction.get(actionId);
    return {
      id: actionId,
      description: schema.actions[actionId]?.description,
      fields: getActionInputFields(schema, actionId),
      available: availabilityEntry?.status === "ready" ? availabilityEntry.available : undefined,
      blockerCount: availabilityEntry?.blockers?.length ?? 0
    };
  });
}

export function buildInitialFieldValues(action: ActionSpec | null): Record<string, string> {
  if (!action) {
    return {};
  }

  return Object.fromEntries(
    action.fields.map((field) => [
      field.key,
      field.type === "enum" ? field.options?.[0] ?? "" : ""
    ])
  );
}

function coerceFieldValue(field: ActionInputField, rawValue: string): unknown {
  if (!rawValue && field.required) {
    throw new Error(`"${field.label}" is required.`);
  }

  if (!rawValue && !field.required) {
    return undefined;
  }

  switch (field.type) {
    case "number": {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        throw new Error(`"${field.label}" must be a finite number.`);
      }
      return parsed;
    }
    case "boolean":
      return rawValue === "true";
    case "json":
      return JSON.parse(rawValue);
    case "enum":
    case "string":
      return rawValue;
  }
}

export function parseActionArgs(
  action: ActionSpec,
  fieldValues: Record<string, string>
): unknown[] {
  return action.fields.map((field) =>
    coerceFieldValue(field, fieldValues[field.key] ?? "")
  );
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.location;
  if (!location) {
    return `[${diagnostic.code}] ${diagnostic.message}`;
  }

  return `[${diagnostic.code}] ${diagnostic.message} (${location.start.line}:${location.start.column})`;
}

export function getNodeLabel(node: DomainGraphProjectionNode): string {
  const metadata = node.metadata ?? {};

  if (typeof metadata.actionId === "string") {
    return metadata.actionId;
  }

  if (typeof metadata.path === "string") {
    return metadata.path;
  }

  return node.id.replace(/^[^:]+:/, "");
}

export function getNodeById(
  graph: DomainGraphProjection,
  nodeId?: string
): DomainGraphProjectionNode | undefined {
  if (!nodeId) {
    return undefined;
  }

  return graph.nodes.find((node) => node.id === nodeId);
}

export function getIncomingRelations(graph: DomainGraphProjection, nodeId?: string) {
  if (!nodeId) {
    return [];
  }

  return graph.edges.filter((edge) => edge.target === nodeId);
}

export function getOutgoingRelations(graph: DomainGraphProjection, nodeId?: string) {
  if (!nodeId) {
    return [];
  }

  return graph.edges.filter((edge) => edge.source === nodeId);
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function summarizeCompilerState(
  diagnostics: Diagnostic[],
  hasActiveDomain: boolean
): string {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  if (errors > 0) {
    return hasActiveDomain
      ? `${errors} compile errors in draft. Graph and runtime still reflect the last successful compile.`
      : `${errors} compile errors. Fix the draft to generate a graph and runtime.`;
  }

  if (warnings > 0) {
    return `${warnings} compiler warnings in the current draft.`;
  }

  return hasActiveDomain
    ? "Compiled successfully. Graph and runtime are synchronized with the editor."
    : "No compiled domain is active yet.";
}

export function summarizeFindings(report: FindingsReportProjection): string {
  return `${report.summary.bySeverity.error} errors, ${report.summary.bySeverity.warn} warnings, ${report.summary.bySeverity.info} info`;
}
