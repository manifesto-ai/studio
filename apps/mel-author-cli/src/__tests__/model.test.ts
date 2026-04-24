import { describe, expect, it } from "vitest";
import {
  normalizeOllamaBaseURL,
  readAuthorModelConfig,
} from "../model.js";

describe("MEL Author CLI model config", () => {
  it("normalizes Ollama host URLs to OpenAI-compatible /v1 URLs", () => {
    expect(normalizeOllamaBaseURL("100.84.214.42:11434")).toBe(
      "http://100.84.214.42:11434/v1",
    );
    expect(normalizeOllamaBaseURL("http://localhost:11434/")).toBe(
      "http://localhost:11434/v1",
    );
    expect(normalizeOllamaBaseURL("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("prefers explicit Ollama env and exposes a stable label", () => {
    const config = readAuthorModelConfig({
      AGENT_MODEL_PROVIDER: "ollama",
      OLLAMA_HOST: "http://example.local:11434",
      OLLAMA_MODEL: "gemma4:e4b",
    });

    expect(config).toMatchObject({
      provider: "ollama",
      model: "gemma4:e4b",
      label: "ollama/gemma4:e4b",
      status: "ready",
      baseURL: "http://example.local:11434/v1",
    });
  });

  it("marks gateway as misconfigured without an API key", () => {
    const config = readAuthorModelConfig({
      AGENT_MODEL_PROVIDER: "gateway",
      AI_GATEWAY_MODEL: "google/gemma-4-26b-a4b-it",
    });

    expect(config.status).toBe("misconfigured");
    expect(config.message).toContain("AI_GATEWAY_API_KEY");
  });
});
