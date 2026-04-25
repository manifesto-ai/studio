import { describe, expect, it } from "vitest";
import {
  durableSagaTurnPolicy,
  type DurableTurnState,
  type DurableTurnStateStore,
} from "../index.js";
import { makeTurnContext } from "../policy.js";

function makeStore(): DurableTurnStateStore & {
  readonly state: () => DurableTurnState;
} {
  let state: DurableTurnState = {
    id: null,
    status: null,
    prompt: null,
    conclusion: null,
    resendCount: 0,
  };
  return {
    state: () => state,
    read: () => state,
    begin: (id, prompt) => {
      state = {
        id,
        prompt,
        status: "running",
        conclusion: null,
        resendCount: 0,
      };
    },
    conclude: (summary) => {
      state = { ...state, status: "ended", conclusion: summary };
    },
    incrementResend: () => {
      state = { ...state, resendCount: state.resendCount + 1 };
    },
  };
}

describe("durableSagaTurnPolicy", () => {
  it("begins a turn and requires tools", async () => {
    const store = makeStore();
    const policy = durableSagaTurnPolicy({ store });
    const context = makeTurnContext({
      turnId: "s1",
      userInput: "work",
      step: 0,
      lastAssistant: null,
      lastToolCall: null,
      lastToolResult: null,
    });

    await policy.beforeTurn?.(context);
    expect(store.state()).toMatchObject({
      id: "s1",
      status: "running",
      prompt: "work",
    });
    expect(await policy.toolChoice?.(context)).toBe("required");
    expect(await policy.shouldContinue(context)).toBe(true);
  });

  it("force-concludes at the hard cap before another model resend", async () => {
    const store = makeStore();
    const policy = durableSagaTurnPolicy({
      store,
      hardCap: 1,
      terminalToolName: "answerAndTurnEnd",
    });
    const baseContext = {
      turnId: "s1",
      userInput: "work",
      step: 0,
      lastToolCall: null,
      lastToolResult: null,
    };

    await policy.beforeTurn?.(
      makeTurnContext({ ...baseContext, lastAssistant: null }),
    );
    await policy.onModelFinish?.(
      makeTurnContext({
        ...baseContext,
        lastAssistant: {
          text: "not a tool",
          reasoning: "",
          toolCalls: [],
          finishReason: "stop",
        },
      }),
    );

    expect(await policy.shouldContinue(contextWithTextOnlyAssistant())).toBe(
      false,
    );
    expect(store.state().status).toBe("ended");
    expect(store.state().conclusion).toContain("force-ended");

    function contextWithTextOnlyAssistant() {
      return makeTurnContext({
        ...baseContext,
        lastAssistant: {
          text: "not a tool",
          reasoning: "",
          toolCalls: [],
          finishReason: "stop",
        },
      });
    }
  });

  it("does not count a resend after a terminal tool has ended the turn", async () => {
    const store = makeStore();
    const policy = durableSagaTurnPolicy({ store });
    const context = makeTurnContext({
      turnId: "s1",
      userInput: "work",
      step: 0,
      lastAssistant: null,
      lastToolCall: null,
      lastToolResult: null,
    });

    await policy.beforeTurn?.(context);
    await store.conclude("done");

    expect(await policy.shouldContinue(context)).toBe(false);
    expect(store.state().resendCount).toBe(0);
  });

  it("forces the terminal tool when resuming an already resent saga", async () => {
    const store = makeStore();
    const policy = durableSagaTurnPolicy({ store });
    const context = makeTurnContext({
      turnId: "s1",
      userInput: "work",
      step: 0,
      lastAssistant: null,
      lastToolCall: null,
      lastToolResult: null,
    });

    await store.begin("s1", "work");
    await store.incrementResend();

    expect(await policy.toolChoice?.(context)).toEqual({
      type: "tool",
      toolName: "answerAndTurnEnd",
    });
  });
});
