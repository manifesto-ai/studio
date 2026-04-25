import type { AgentEvent } from "./events.js";
import type { IdentityProvider } from "./identity.js";
import type {
  AgentMessage,
  AgentToolCall,
  AssistantStep,
  ModelAdapter,
} from "./model.js";
import { makeTurnContext, type TurnContext, type TurnPolicy } from "./policy.js";
import {
  createMemoryTranscriptStore,
  type TranscriptStore,
} from "./transcript.js";
import {
  createToolRegistry,
  executeToolLocally,
  type ToolRegistry,
  type ToolRunResult,
} from "./tools.js";

export type AgentRunnerConfig = {
  readonly id: string;
  readonly identity: IdentityProvider;
  readonly tools: ToolRegistry;
  readonly model: ModelAdapter;
  readonly turnPolicy: TurnPolicy;
  readonly transcript?: TranscriptStore;
  readonly defaultMaxSteps?: number;
  readonly temperature?: number;
  readonly createTurnId?: () => string;
};

export type RunAgentTurnInput = {
  readonly input: string;
  readonly abortSignal?: AbortSignal;
  readonly maxSteps?: number;
  readonly temperature?: number;
};

export type AgentRunner = {
  readonly runTurn: (input: RunAgentTurnInput) => AsyncIterable<AgentEvent>;
};

export function createAgentRunner(config: AgentRunnerConfig): AgentRunner {
  const transcript = config.transcript ?? createMemoryTranscriptStore();
  const tools = createToolRegistry([
    ...config.tools.list(),
    ...(config.turnPolicy.terminalTools ?? []),
  ]);
  let nextTurnOrdinal = 0;
  const createTurnId = (): string =>
    config.createTurnId?.() ?? `${config.id}-turn-${++nextTurnOrdinal}`;

  return {
    runTurn: (input) =>
      runTurn(config, tools, transcript, createTurnId(), input),
  };
}

async function* runTurn(
  config: AgentRunnerConfig,
  tools: ToolRegistry,
  transcript: TranscriptStore,
  turnId: string,
  input: RunAgentTurnInput,
): AsyncIterable<AgentEvent> {
  let step = 0;
  let lastAssistant: AssistantStep | null = null;
  let lastToolCall: AgentToolCall | null = null;
  let lastToolResult: ToolRunResult<unknown> | null = null;
  let endReason: Extract<AgentEvent, { readonly type: "turn_end" }>["reason"] =
    "completed";

  const context = (): TurnContext =>
    makeTurnContext({
      turnId,
      userInput: input.input,
      step,
      lastAssistant,
      lastToolCall,
      lastToolResult,
    });

  try {
    yield { type: "turn_start", turnId, input: input.input };
    await config.turnPolicy.beforeTurn?.(context());
    await transcript.append({ role: "user", content: input.input });

    const maxSteps =
      input.maxSteps ??
      config.turnPolicy.maxSteps ??
      config.defaultMaxSteps ??
      10;

    for (step = 0; step < maxSteps; step++) {
      const system = await config.identity.build({
        input: input.input,
        turnId,
        step,
        messages: transcript.read(),
      });
      const toolChoice = await config.turnPolicy.toolChoice?.(context());
      let text = "";
      let reasoning = "";
      let finishReason: string | null = null;
      let usage: AssistantStep["usage"] | undefined;
      const toolCalls: AgentToolCall[] = [];
      for await (const event of config.model.stream({
        system,
        messages: transcript.read(),
        tools: tools.toToolSpecs(),
        toolChoice,
        temperature: input.temperature ?? config.temperature,
        abortSignal: input.abortSignal,
      })) {
        yield { type: "model_event", event };
        if (event.type === "text_delta") {
          text += event.text;
        } else if (event.type === "reasoning_delta") {
          reasoning += event.text;
        } else if (event.type === "tool_call") {
          toolCalls.push(event.call);
        } else if (event.type === "finish") {
          finishReason = event.reason;
          usage = event.usage;
        } else if (event.type === "error") {
          throw event.error instanceof Error
            ? event.error
            : new Error(String(event.error));
        }
      }
      const assistant: AssistantStep = {
        text,
        reasoning,
        toolCalls,
        finishReason,
        usage,
      };

      lastAssistant = assistant;
      await transcript.append(assistantToMessage(assistant));
      yield { type: "assistant_step", step, assistant };
      await config.turnPolicy.onModelFinish?.(context());

      for (const call of assistant.toolCalls) {
        lastToolCall = call;
        yield { type: "tool_start", step, call };
        const result = await executeToolLocally(tools, call.name, call.input);
        lastToolResult = result;
        await transcript.append(toolResultToMessage(call, result));
        yield { type: "tool_result", step, call, result };
        await config.turnPolicy.onToolResult?.(context());
      }

      if (!(await config.turnPolicy.shouldContinue(context()))) {
        break;
      }
    }

    if (step >= maxSteps) endReason = "max_steps";
    await config.turnPolicy.afterTurn?.(context());
    yield { type: "turn_end", turnId, reason: endReason };
  } catch (err) {
    endReason =
      input.abortSignal?.aborted === true ? "aborted" : "error";
    yield { type: "error", error: err };
    yield { type: "turn_end", turnId, reason: endReason };
  }
}

function assistantToMessage(assistant: AssistantStep): AgentMessage {
  return {
    role: "assistant",
    content: assistant.text,
    reasoning: assistant.reasoning === "" ? undefined : assistant.reasoning,
    toolCalls: assistant.toolCalls,
  };
}

function toolResultToMessage(
  call: AgentToolCall,
  result: ToolRunResult<unknown>,
): AgentMessage {
  return {
    role: "tool",
    toolCallId: call.id,
    toolName: call.name,
    output: result,
  };
}
