import type { DomainSchema } from "../contracts/inputs.js";

export type IngestedSchema = {
  schema: DomainSchema;
  schemaHash: string;
};

export function ingestSchema(schema: DomainSchema): IngestedSchema {
  return {
    schema,
    schemaHash: schema.hash
  };
}

