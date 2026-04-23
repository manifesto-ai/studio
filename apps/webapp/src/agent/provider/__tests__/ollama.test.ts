/**
 * Ollama provider adapter tests — run against a stub `fetch` so we
 * don't need a real server. Covers the three paths the orchestrator
 * relies on:
 *
 *   1. Plain assistant text reply from the OpenAI-compat endpoint.
 *   2. Tool-call reply translated from OpenAI-compat → `ToolCall[]`.
 *   3. Native `/api/chat` fallback when OpenAI-compat is 404.
 *
 * Everything else (timeout handling, HTTP errors) is covered by
 * smoke tests at the edges to keep the spec size manageable.
 */
import { describe, expect, it } from "vitest";
import { createOllamaProvider } from "../ollama.js";

type FetchCall = {
  readonly url: string;
  readonly body: Record<string, unknown>;
};

function fakeFetch(
  plan: readonly {
    readonly match: (url: string) => boolean;
    readonly respond: () => Response;
  }[],
  calls: FetchCall[],
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body =
      init?.body !== undefined ? JSON.parse(init.body as string) : {};
    calls.push({ url, body });
    for (const p of plan) {
      if (p.match(url)) return p.respond();
    }
    throw new Error(`fakeFetch: no plan for ${url}`);
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createOllamaProvider — OpenAI-compat happy path", () => {
  it("returns plain assistant text", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "gemma4:e4b",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              jsonResponse({
                choices: [
                  { message: { content: "hello, snapshot is empty." } },
                ],
                usage: { total_tokens: 42 },
              }),
          },
        ],
        calls,
      ),
    });

    const res = await provider.chat({
      system: "you are a helpful agent",
      messages: [{ role: "user", content: "what's happening?" }],
    });

    expect(res.message.role).toBe("assistant");
    expect(res.message.content).toBe("hello, snapshot is empty.");
    expect(res.message.toolCalls).toBeUndefined();
    expect(res.diagnostics?.totalTokens).toBe(42);
    expect(calls[0].body.model).toBe("gemma4:e4b");
    expect(calls[0].body.messages).toEqual([
      { role: "system", content: "you are a helpful agent" },
      { role: "user", content: "what's happening?" },
    ]);
    expect(calls[0].body.stream).toBe(false);
  });

  it("emits `tools` + `tool_choice: auto` when tools are provided", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "gemma4:e4b",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              jsonResponse({
                choices: [{ message: { content: "ok" } }],
              }),
          },
        ],
        calls,
      ),
    });

    await provider.chat({
      messages: [{ role: "user", content: "check" }],
      tools: [
        {
          type: "function",
          function: {
            name: "legalityInspect",
            description: "Query intent legality",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });

    expect(calls[0].body.tools).toHaveLength(1);
    expect((calls[0].body.tools as unknown[])[0]).toMatchObject({
      type: "function",
      function: { name: "legalityInspect" },
    });
    expect(calls[0].body.tool_choice).toBe("auto");
  });
});

describe("createOllamaProvider — tool-call response shape", () => {
  it("translates OpenAI `tool_calls` into the provider-neutral ToolCall[]", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "gemma4:e4b",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              jsonResponse({
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: "call_abc",
                          function: {
                            name: "legalityInspect",
                            arguments: '{"action":"shoot"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
          },
        ],
        calls,
      ),
    });

    const res = await provider.chat({
      messages: [{ role: "user", content: "why is shoot blocked?" }],
    });
    expect(res.message.content).toBeUndefined();
    expect(res.message.toolCalls).toEqual([
      { id: "call_abc", name: "legalityInspect", argumentsJson: '{"action":"shoot"}' },
    ]);
  });
});

describe("createOllamaProvider — num_ctx / think forwarding", () => {
  it("puts num_ctx into options and think at top-level on OpenAI-compat", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "qwen3:8b-thinking",
      numCtx: 16384,
      think: "medium",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              jsonResponse({
                choices: [{ message: { content: "ok" } }],
              }),
          },
        ],
        calls,
      ),
    });
    await provider.chat({
      messages: [{ role: "user", content: "q" }],
    });
    expect(calls[0].body.options).toEqual({ num_ctx: 16384 });
    expect(calls[0].body.think).toBe("medium");
  });

  it("merges num_ctx with temperature into options on native fallback", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "qwen3:8b-thinking",
      numCtx: 32768,
      think: true,
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () => new Response("", { status: 404 }),
          },
          {
            match: (u) => u.endsWith("/api/chat"),
            respond: () =>
              jsonResponse({ message: { content: "ok" } }),
          },
        ],
        calls,
      ),
    });
    await provider.chat({
      messages: [{ role: "user", content: "q" }],
      temperature: 0.2,
    });
    expect(calls[1].body.options).toEqual({
      temperature: 0.2,
      num_ctx: 32768,
    });
    expect(calls[1].body.think).toBe(true);
  });

  it("prepends <|think|> to system prompt on gemma4 instead of API flag", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "gemma4:e4b",
      think: true,
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              jsonResponse({
                choices: [{ message: { content: "ok" } }],
              }),
          },
        ],
        calls,
      ),
    });
    await provider.chat({
      system: "grounded prompt here",
      messages: [{ role: "user", content: "q" }],
    });
    // `think` API flag MUST NOT be on the payload — gemma4 doesn't accept it.
    expect(calls[0].body.think).toBeUndefined();
    // System prompt was rewritten with the thinking token prefix.
    const messages = calls[0].body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({
      role: "system",
      content: "<|think|>\ngrounded prompt here",
    });
  });

  it("sends Ollama think flag for non-gemma4 thinking models", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "qwen3:8b-thinking",
      think: "high",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              jsonResponse({
                choices: [{ message: { content: "ok" } }],
              }),
          },
        ],
        calls,
      ),
    });
    await provider.chat({
      system: "grounded prompt here",
      messages: [{ role: "user", content: "q" }],
    });
    expect(calls[0].body.think).toBe("high");
    const messages = calls[0].body.messages as { role: string; content: string }[];
    expect(messages[0].content).toBe("grounded prompt here");
  });

  it("omits options and think when unset", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "gemma4:e4b",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              jsonResponse({
                choices: [{ message: { content: "ok" } }],
              }),
          },
        ],
        calls,
      ),
    });
    await provider.chat({
      messages: [{ role: "user", content: "q" }],
    });
    expect(calls[0].body.options).toBeUndefined();
    expect(calls[0].body.think).toBeUndefined();
  });
});

describe("createOllamaProvider — streaming", () => {
  function sseResponse(chunks: readonly string[]): Response {
    const body = chunks
      .map((c) => `data: ${c}\n\n`)
      .concat(["data: [DONE]\n\n"])
      .join("");
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  function ndjsonResponse(lines: readonly string[]): Response {
    return new Response(lines.join("\n") + "\n", {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  it("parses SSE content deltas and fires onStream events in order", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "qwen3:8b-thinking",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              sseResponse([
                JSON.stringify({
                  choices: [{ delta: { content: "hel" } }],
                }),
                JSON.stringify({
                  choices: [{ delta: { content: "lo" } }],
                }),
                JSON.stringify({
                  choices: [{ delta: { content: " world" } }],
                  usage: { total_tokens: 9 },
                }),
              ]),
          },
        ],
        calls,
      ),
    });

    const events: string[] = [];
    const res = await provider.chat({
      messages: [{ role: "user", content: "greet" }],
      onStream: (e) => {
        if (e.kind === "content") events.push(e.delta);
      },
    });

    expect(calls[0].body.stream).toBe(true);
    expect(events).toEqual(["hel", "lo", " world"]);
    expect(res.message.content).toBe("hello world");
    expect(res.diagnostics?.totalTokens).toBe(9);
  });

  it("buffers streamed tool_call deltas into a complete ToolCall", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "qwen3:8b-thinking",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              sseResponse([
                JSON.stringify({
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: "call_xyz",
                            function: { name: "explainLegality" },
                          },
                        ],
                      },
                    },
                  ],
                }),
                JSON.stringify({
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            function: { arguments: '{"action":' },
                          },
                        ],
                      },
                    },
                  ],
                }),
                JSON.stringify({
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            function: { arguments: '"toggleTodo"}' },
                          },
                        ],
                      },
                    },
                  ],
                }),
              ]),
          },
        ],
        calls,
      ),
    });

    const toolEvents: { name: string; argumentsJson: string }[] = [];
    const res = await provider.chat({
      messages: [{ role: "user", content: "why blocked?" }],
      onStream: (e) => {
        if (e.kind === "tool_call") {
          toolEvents.push({
            name: e.toolCall.name,
            argumentsJson: e.toolCall.argumentsJson,
          });
        }
      },
    });
    expect(toolEvents).toEqual([
      { name: "explainLegality", argumentsJson: '{"action":"toggleTodo"}' },
    ]);
    expect(res.message.toolCalls?.[0]).toEqual({
      id: "call_xyz",
      name: "explainLegality",
      argumentsJson: '{"action":"toggleTodo"}',
    });
  });

  it("forwards reasoning deltas separately from content on OpenAI-compat", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "qwen3:8b-thinking",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () =>
              sseResponse([
                JSON.stringify({
                  choices: [{ delta: { reasoning: "let me think" } }],
                }),
                JSON.stringify({
                  choices: [{ delta: { content: "answer" } }],
                }),
              ]),
          },
        ],
        calls,
      ),
    });
    const byKind: Record<string, string> = {};
    const res = await provider.chat({
      messages: [{ role: "user", content: "q" }],
      onStream: (e) => {
        if (e.kind === "content" || e.kind === "reasoning") {
          byKind[e.kind] = (byKind[e.kind] ?? "") + e.delta;
        }
      },
    });
    expect(byKind.content).toBe("answer");
    expect(byKind.reasoning).toBe("let me think");
    expect(res.reasoning).toBe("let me think");
  });

  it("parses native NDJSON stream on fallback", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "gemma4:e4b",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () => new Response("", { status: 404 }),
          },
          {
            match: (u) => u.endsWith("/api/chat"),
            respond: () =>
              ndjsonResponse([
                JSON.stringify({
                  message: { content: "hel", thinking: "hmm" },
                  done: false,
                }),
                JSON.stringify({
                  message: { content: "lo" },
                  done: true,
                  eval_count: 42,
                }),
              ]),
          },
        ],
        calls,
      ),
    });
    const content: string[] = [];
    const reasoning: string[] = [];
    const res = await provider.chat({
      messages: [{ role: "user", content: "q" }],
      onStream: (e) => {
        if (e.kind === "content") content.push(e.delta);
        if (e.kind === "reasoning") reasoning.push(e.delta);
      },
    });
    expect(content.join("")).toBe("hello");
    expect(reasoning.join("")).toBe("hmm");
    expect(res.message.content).toBe("hello");
    expect(res.diagnostics?.totalTokens).toBe(42);
  });

  it("propagates AbortSignal so users can stop a stream", async () => {
    const calls: FetchCall[] = [];
    const controller = new AbortController();
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "qwen3:8b-thinking",
      fetch: (input, init) => {
        calls.push({
          url: typeof input === "string" ? input : input.toString(),
          body:
            init?.body !== undefined
              ? JSON.parse(init.body as string)
              : {},
        });
        // Simulate aborting before the server responds.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            (err as { name: string }).name = "AbortError";
            reject(err);
          });
        });
      },
    });

    const pending = provider.chat({
      messages: [{ role: "user", content: "q" }],
      signal: controller.signal,
      onStream: () => {},
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted by user/);
  });
});

describe("createOllamaProvider — native /api/chat fallback", () => {
  it("falls back on 404 and translates native tool_calls (args may be object)", async () => {
    const calls: FetchCall[] = [];
    const provider = createOllamaProvider({
      baseUrl: "http://host:11434",
      model: "gemma4:e4b",
      fetch: fakeFetch(
        [
          {
            match: (u) => u.endsWith("/v1/chat/completions"),
            respond: () => new Response("", { status: 404 }),
          },
          {
            match: (u) => u.endsWith("/api/chat"),
            respond: () =>
              jsonResponse({
                message: {
                  content: "",
                  tool_calls: [
                    {
                      function: {
                        name: "legalityInspect",
                        // native returns args as a parsed object
                        arguments: { action: "shoot" },
                      },
                    },
                  ],
                },
                eval_count: 17,
              }),
          },
        ],
        calls,
      ),
    });

    const res = await provider.chat({
      messages: [{ role: "user", content: "why blocked?" }],
    });
    expect(calls.map((c) => c.url)).toEqual([
      "http://host:11434/v1/chat/completions",
      "http://host:11434/api/chat",
    ]);
    expect(res.message.toolCalls).toEqual([
      { id: "call-0", name: "legalityInspect", argumentsJson: '{"action":"shoot"}' },
    ]);
    expect(res.diagnostics?.totalTokens).toBe(17);
    expect(res.diagnostics?.endpoint).toBe("http://host:11434/api/chat");
  });
});
