declare module "*.mel" {
  import type { DomainSchema } from "@manifesto-ai/studio-core";

  const schema: DomainSchema;
  export default schema;
}
