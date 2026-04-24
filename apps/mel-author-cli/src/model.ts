import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
export const DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
export const DEFAULT_GATEWAY_MODEL = "google/gemma-4-26b-a4b-it";

export type AuthorModelProvider = "gateway" | "ollama";

export type AuthorModelConfig = {
  readonly provider: AuthorModelProvider;
  readonly model: string;
  readonly label: string;
  readonly status: "ready" | "misconfigured";
  readonly baseURL?: string;
  readonly message?: string;
};

export type ResolvedAuthorModel =
  | {
      readonly kind: "ok";
      readonly model: LanguageModel;
      readonly config: AuthorModelConfig & { readonly status: "ready" };
    }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly config: AuthorModelConfig;
    };

export function readAuthorModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthorModelConfig {
  const provider = resolveAuthorModelProvider(env);
  if (provider.kind === "error") {
    return {
      provider: "ollama",
      model: DEFAULT_OLLAMA_MODEL,
      label: `ollama/${DEFAULT_OLLAMA_MODEL}`,
      status: "misconfigured",
      baseURL: normalizeOllamaBaseURL(DEFAULT_OLLAMA_BASE_URL),
      message: provider.message,
    };
  }

  if (provider.value === "gateway") {
    const model = readEnv(env, "AI_GATEWAY_MODEL") ?? DEFAULT_GATEWAY_MODEL;
    if (readEnv(env, "AI_GATEWAY_API_KEY") === null) {
      return {
        provider: "gateway",
        model,
        label: `gateway/${model}`,
        status: "misconfigured",
        message:
          "AI_GATEWAY_API_KEY is required when AGENT_MODEL_PROVIDER=gateway.",
      };
    }
    return {
      provider: "gateway",
      model,
      label: `gateway/${model}`,
      status: "ready",
    };
  }

  const model = readEnv(env, "OLLAMA_MODEL") ?? DEFAULT_OLLAMA_MODEL;
  const baseURL = normalizeOllamaBaseURL(
    readEnv(env, "OLLAMA_BASE_URL") ??
      readEnv(env, "OLLAMA_HOST") ??
      DEFAULT_OLLAMA_BASE_URL,
  );
  return {
    provider: "ollama",
    model,
    label: `ollama/${model}`,
    status: "ready",
    baseURL,
  };
}

export function resolveAuthorModel(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAuthorModel {
  const config = readAuthorModelConfig(env);
  if (config.status === "misconfigured") {
    return {
      kind: "error",
      message: config.message ?? "MEL Author model provider is misconfigured.",
      config,
    };
  }
  const readyConfig: AuthorModelConfig & { readonly status: "ready" } = {
    ...config,
    status: "ready",
  };

  if (readyConfig.provider === "gateway") {
    return {
      kind: "ok",
      model: readyConfig.model,
      config: readyConfig,
    };
  }

  const ollama = createOpenAICompatible({
    name: "ollama",
    baseURL: readyConfig.baseURL ?? DEFAULT_OLLAMA_BASE_URL,
    apiKey: readEnv(env, "OLLAMA_API_KEY") ?? undefined,
  });

  return {
    kind: "ok",
    model: ollama.chatModel(readyConfig.model),
    config: readyConfig,
  };
}

export function normalizeOllamaBaseURL(raw: string): string {
  const withoutTrailingSlash = raw.trim().replace(/\/+$/, "");
  const withProtocol = /^https?:\/\//.test(withoutTrailingSlash)
    ? withoutTrailingSlash
    : `http://${withoutTrailingSlash}`;
  if (withProtocol.endsWith("/v1")) return withProtocol;
  return `${withProtocol}/v1`;
}

function resolveAuthorModelProvider(
  env: NodeJS.ProcessEnv,
):
  | { readonly kind: "ok"; readonly value: AuthorModelProvider }
  | { readonly kind: "error"; readonly message: string } {
  const explicit = readEnv(env, "AGENT_MODEL_PROVIDER");
  if (explicit !== null) {
    if (explicit === "gateway" || explicit === "ollama") {
      return { kind: "ok", value: explicit };
    }
    return {
      kind: "error",
      message: 'AGENT_MODEL_PROVIDER must be "gateway" or "ollama".',
    };
  }

  if (
    readEnv(env, "OLLAMA_BASE_URL") !== null ||
    readEnv(env, "OLLAMA_HOST") !== null ||
    readEnv(env, "OLLAMA_MODEL") !== null
  ) {
    return { kind: "ok", value: "ollama" };
  }

  if (
    readEnv(env, "AI_GATEWAY_API_KEY") !== null ||
    readEnv(env, "AI_GATEWAY_MODEL") !== null
  ) {
    return { kind: "ok", value: "gateway" };
  }

  return { kind: "ok", value: "ollama" };
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return null;
}
