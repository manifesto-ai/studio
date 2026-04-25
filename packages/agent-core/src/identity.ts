import type { AgentMessage } from "./model.js";

export type IdentityBuildContext = {
  readonly input: string;
  readonly turnId: string;
  readonly step: number;
  readonly messages: readonly AgentMessage[];
};

export type IdentityProvider = {
  readonly build: (
    context: IdentityBuildContext,
  ) => Promise<string> | string;
};

export function createStaticIdentityProvider(system: string): IdentityProvider {
  return {
    build: () => system,
  };
}
