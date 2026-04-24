#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_INPUT = join(repoRoot, "temp", "stream.txt");

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));
const inputPath = positional[0] ? resolve(positional[0]) : DEFAULT_INPUT;
const printJson = flags.has("--json");
const printChunks = flags.has("--chunks");

if (!existsSync(inputPath)) {
  console.error(`[reconstruct-agent-response] missing input file: ${inputPath}`);
  process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const parsed = parseStreamText(raw);
const reconstructed = reconstructAssistantMessage(parsed.chunks);

if (printChunks) {
  console.log(JSON.stringify(parsed, null, 2));
} else if (printJson) {
  console.log(JSON.stringify(reconstructed.message, null, 2));
} else {
  printReport(inputPath, parsed, reconstructed);
}

function parseStreamText(text) {
  const ssePayloads = parseSsePayloads(text);
  const payloads = ssePayloads.length > 0 ? ssePayloads : parseLoosePayloads(text);
  const chunks = [];
  const errors = [];

  for (const payload of payloads) {
    const trimmed = payload.trim();
    if (trimmed === "" || trimmed === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(trimmed));
    } catch (err) {
      errors.push({
        payload: truncate(trimmed, 240),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { chunks, parseErrors: errors };
}

function parseSsePayloads(text) {
  const payloads = [];
  const dataLines = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  flush();
  return payloads;

  function flush() {
    if (dataLines.length === 0) return;
    payloads.push(dataLines.join("\n"));
    dataLines.length = 0;
  }
}

function parseLoosePayloads(text) {
  const payloads = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line === "[DONE]") continue;
    if (line.startsWith("data:")) {
      payloads.push(line.slice("data:".length).trimStart());
      continue;
    }
    if (line.startsWith("{") && line.endsWith("}")) {
      payloads.push(line);
      continue;
    }
    const start = line.indexOf("{");
    const end = line.lastIndexOf("}");
    if (start !== -1 && end > start) {
      payloads.push(line.slice(start, end + 1));
    }
  }
  return payloads;
}

function reconstructAssistantMessage(chunks) {
  const message = {
    id: "reconstructed-agent-response",
    role: "assistant",
    parts: [],
  };
  const state = {
    textById: new Map(),
    reasoningById: new Map(),
    toolById: new Map(),
    finishReason: null,
    abortReason: null,
    errors: [],
    metadata: undefined,
  };

  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    switch (chunk.type) {
      case "start":
        if (typeof chunk.messageId === "string") message.id = chunk.messageId;
        if (chunk.messageMetadata !== undefined) state.metadata = chunk.messageMetadata;
        break;
      case "message-metadata":
        state.metadata = chunk.messageMetadata;
        break;
      case "text-start":
        ensureTextPart(message, state, String(chunk.id ?? "text-0"));
        break;
      case "text-delta":
        ensureTextPart(message, state, String(chunk.id ?? "text-0")).text +=
          String(chunk.delta ?? "");
        break;
      case "text-end":
        break;
      case "reasoning-start":
        ensureReasoningPart(message, state, String(chunk.id ?? "reasoning-0"));
        break;
      case "reasoning-delta":
        ensureReasoningPart(
          message,
          state,
          String(chunk.id ?? "reasoning-0"),
        ).text += String(chunk.delta ?? "");
        break;
      case "reasoning-end":
        break;
      case "tool-input-start":
        ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        }).state = "input-streaming";
        break;
      case "tool-input-delta": {
        const part = ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        });
        part.state = "input-streaming";
        part.inputText = (part.inputText ?? "") + String(chunk.inputTextDelta ?? chunk.delta ?? "");
        break;
      }
      case "tool-input-available": {
        const part = ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        });
        part.state = "input-available";
        part.input = chunk.input;
        delete part.inputText;
        break;
      }
      case "tool-input-end": {
        const part = ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        });
        part.state = "input-available";
        part.input = parseMaybeJson(part.inputText ?? "");
        delete part.inputText;
        break;
      }
      case "tool-input-error": {
        const part = ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        });
        part.state = "input-error";
        part.input = chunk.input;
        part.errorText = String(chunk.errorText ?? "");
        delete part.inputText;
        break;
      }
      case "tool-call": {
        const part = ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        });
        part.state = "input-available";
        part.input = parseMaybeJson(chunk.input ?? chunk.args ?? {});
        delete part.inputText;
        break;
      }
      case "tool-output-available":
      case "tool-result": {
        const part = ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        });
        part.state = "output-available";
        part.output = chunk.output ?? chunk.result;
        break;
      }
      case "tool-output-error": {
        const part = ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        });
        part.state = "output-error";
        part.errorText = String(chunk.errorText ?? "");
        break;
      }
      case "tool-output-denied": {
        const part = ensureToolPart(message, state, {
          toolCallId: String(chunk.toolCallId ?? chunk.id ?? "tool-0"),
          toolName: String(chunk.toolName ?? "unknown"),
        });
        part.state = "output-denied";
        break;
      }
      case "source-url":
        message.parts.push({
          type: "source-url",
          sourceId: String(chunk.sourceId ?? ""),
          url: String(chunk.url ?? ""),
          title: chunk.title,
        });
        break;
      case "source-document":
        message.parts.push({
          type: "source-document",
          sourceId: String(chunk.sourceId ?? ""),
          mediaType: String(chunk.mediaType ?? ""),
          title: String(chunk.title ?? ""),
          filename: chunk.filename,
        });
        break;
      case "file":
        message.parts.push({
          type: "file",
          url: String(chunk.url ?? ""),
          mediaType: String(chunk.mediaType ?? ""),
        });
        break;
      case "error":
        state.errors.push(String(chunk.errorText ?? chunk.error ?? ""));
        break;
      case "finish":
        state.finishReason = chunk.finishReason ?? null;
        if (chunk.messageMetadata !== undefined) state.metadata = chunk.messageMetadata;
        break;
      case "abort":
        state.abortReason = chunk.reason ?? null;
        break;
      default:
        if (typeof chunk.type === "string" && chunk.type.startsWith("data-")) {
          message.parts.push({ type: chunk.type, data: chunk.data });
        }
        break;
    }
  }

  if (state.metadata !== undefined) message.metadata = state.metadata;

  return {
    message,
    finishReason: state.finishReason,
    abortReason: state.abortReason,
    errors: state.errors,
    warnings: deriveWarnings(message, state),
  };
}

function ensureTextPart(message, state, id) {
  const existing = state.textById.get(id);
  if (existing) return existing;
  const part = { type: "text", text: "" };
  message.parts.push(part);
  state.textById.set(id, part);
  return part;
}

function ensureReasoningPart(message, state, id) {
  const existing = state.reasoningById.get(id);
  if (existing) return existing;
  const part = { type: "reasoning", text: "" };
  message.parts.push(part);
  state.reasoningById.set(id, part);
  return part;
}

function ensureToolPart(message, state, { toolCallId, toolName }) {
  const existing = state.toolById.get(toolCallId);
  if (existing) {
    if (existing.type === "tool-unknown" && toolName !== "unknown") {
      existing.type = `tool-${toolName}`;
    }
    return existing;
  }
  const part = {
    type: `tool-${toolName}`,
    toolCallId,
    state: "input-streaming",
  };
  message.parts.push(part);
  state.toolById.set(toolCallId, part);
  return part;
}

function deriveWarnings(message, state) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
  const hasReasoning = message.parts.some((part) => part.type === "reasoning");
  const hasTool = message.parts.some((part) => part.type.startsWith("tool-"));
  const warnings = [];
  if (hasReasoning && text === "" && !hasTool) {
    warnings.push("reasoning-only assistant turn: no text output and no tool call");
  }
  if (state.errors.length > 0) {
    warnings.push(`${state.errors.length} stream error chunk(s) present`);
  }
  return warnings;
}

function printReport(inputPath, parsed, reconstructed) {
  const message = reconstructed.message;
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const reasoning = message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n\n");
  const tools = message.parts.filter((part) => part.type.startsWith("tool-"));

  console.log(`# Agent Stream Reconstruction`);
  console.log(`input: ${inputPath}`);
  console.log(`chunks: ${parsed.chunks.length}`);
  console.log(`finishReason: ${reconstructed.finishReason ?? "(none)"}`);
  if (reconstructed.abortReason) {
    console.log(`abortReason: ${reconstructed.abortReason}`);
  }
  if (parsed.parseErrors.length > 0) {
    console.log(`parseErrors: ${parsed.parseErrors.length}`);
  }
  if (reconstructed.warnings.length > 0) {
    console.log(`warnings:`);
    for (const warning of reconstructed.warnings) console.log(`- ${warning}`);
  }

  console.log(`\n## Text`);
  console.log(text.trim() === "" ? "(none)" : text);

  console.log(`\n## Reasoning`);
  console.log(reasoning.trim() === "" ? "(none)" : reasoning);

  console.log(`\n## Tool Calls`);
  if (tools.length === 0) {
    console.log("(none)");
  } else {
    for (const tool of tools) {
      console.log(`- ${tool.type.slice("tool-".length)} ${tool.state}`);
      if ("input" in tool) console.log(indent(`input: ${stringify(tool.input)}`));
      if ("output" in tool) console.log(indent(`output: ${stringify(tool.output)}`));
      if (tool.errorText) console.log(indent(`error: ${tool.errorText}`));
    }
  }

  console.log(`\n## UIMessage JSON`);
  console.log(JSON.stringify(message, null, 2));
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function indent(value) {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
