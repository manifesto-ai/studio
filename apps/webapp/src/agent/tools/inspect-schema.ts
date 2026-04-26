import type { DomainModule } from "@manifesto-ai/studio-core";
import {
  digestSchema,
  formatSchemaDigestMarkdown,
  type SchemaActionDigest,
  type SchemaDigest,
} from "../digest/manifesto-digest.js";
import type { AgentTool } from "./types.js";

export type InspectSchemaContext = {
  readonly getModule: () => DomainModule | null;
};

export type SchemaActionSummary = SchemaActionDigest;

export type InspectSchemaOutput = SchemaDigest & {
  readonly summary: string;
};

export function createInspectSchemaTool(): AgentTool<
  Record<string, never>,
  InspectSchemaOutput,
  InspectSchemaContext
> {
  return {
    name: "inspectSchema",
    description:
      "Read the current compiled MEL schema summary and refresh schema " +
      "freshness for schema-dependent tools. Call this after schema " +
      "changes, after tool affordances say the schema is stale, or " +
      "before choosing action names/argument shapes when unsure.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    run: async (_input, ctx) => {
      try {
        const module = ctx.getModule();
        if (module === null) {
          return {
            ok: false,
            kind: "runtime_error",
            message:
              "no compiled schema available - user module has not compiled yet",
          };
        }
        const digest = digestSchema(module);
        return {
          ok: true,
          output: {
            ...digest,
            summary: formatSchemaDigestMarkdown(digest),
          },
        };
      } catch (err) {
        return {
          ok: false,
          kind: "runtime_error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
