/**
 * Schema Introspection Provider (Phase 3: AI-Native)
 *
 * Custom LSP requests for LLM agents to structurally inspect MEL domains:
 * - mel/schemaIntrospection: full compiled DomainSchema
 * - mel/actionSignatures: action names + input types (for Intent generation)
 */

import type { Connection } from "vscode-languageserver/browser.js";
import type { CompilerBridge } from "../compiler-bridge.js";

export interface SchemaIntrospectionParams {
  uri: string;
}

export interface ActionSignature {
  name: string;
  parameters: Array<{ name: string; type: string }>;
  available: boolean;
  description?: string;
}

export interface SchemaIntrospectionResult {
  domain: string | null;
  state: Record<string, { type: string; default?: unknown }>;
  computed: string[];
  actions: ActionSignature[];
  types: string[];
}

export function setupIntrospection(
  connection: Connection,
  bridge: CompilerBridge
): void {
  // Full schema introspection
  connection.onRequest(
    "mel/schemaIntrospection",
    (params: SchemaIntrospectionParams): SchemaIntrospectionResult | null => {
      const schema = bridge.getSchema(params.uri);
      if (!schema) return null;

      const state: Record<string, { type: string; default?: unknown }> = {};
      if (schema.state?.fields) {
        for (const [name, field] of Object.entries(schema.state.fields)) {
          state[name] = {
            type: formatType(field.type),
            ...(field.default !== undefined ? { default: field.default } : {}),
          };
        }
      }

      const computed: string[] = [];
      if (schema.computed && "fields" in schema.computed) {
        computed.push(
          ...Object.keys(
            (schema.computed as { fields: Record<string, unknown> }).fields
          )
        );
      }

      const actions: ActionSignature[] = [];
      if (schema.actions) {
        for (const [name, spec] of Object.entries(schema.actions)) {
          const parameters: Array<{ name: string; type: string }> = [];
          if (spec.input?.fields) {
            for (const [pName, pField] of Object.entries(spec.input.fields)) {
              parameters.push({
                name: pName,
                type: formatType(pField.type),
              });
            }
          }
          actions.push({
            name,
            parameters,
            available: !!spec.available,
          });
        }
      }

      const types = schema.types ? Object.keys(schema.types) : [];

      return {
        domain: schema.meta?.name ?? null,
        state,
        computed,
        actions,
        types,
      };
    }
  );

  // Action signatures only (lightweight, for Intent generation)
  connection.onRequest(
    "mel/actionSignatures",
    (
      params: SchemaIntrospectionParams
    ): ActionSignature[] | null => {
      const schema = bridge.getSchema(params.uri);
      if (!schema?.actions) return null;

      return Object.entries(schema.actions).map(([name, spec]) => {
        const parameters: Array<{ name: string; type: string }> = [];
        if (spec.input?.fields) {
          for (const [pName, pField] of Object.entries(spec.input.fields)) {
            parameters.push({
              name: pName,
              type: formatType(pField.type),
            });
          }
        }
        return {
          name,
          parameters,
          available: !!spec.available,
        };
      });
    }
  );
}

function formatType(type: unknown): string {
  if (typeof type === "string") return type;
  if (type && typeof type === "object" && "enum" in type) {
    return (type as { enum: unknown[] }).enum
      .map((v) => JSON.stringify(v))
      .join(" | ");
  }
  return "unknown";
}
