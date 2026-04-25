import type { AgentMessage } from "./model.js";

type AssistantMessage = Extract<AgentMessage, { readonly role: "assistant" }>;

export type TranscriptStore = {
  readonly read: () => readonly AgentMessage[];
  readonly append: (message: AgentMessage) => Promise<void> | void;
  readonly clear?: () => Promise<void> | void;
};

export function createMemoryTranscriptStore(
  initialMessages: readonly AgentMessage[] = [],
): TranscriptStore {
  const messages: AgentMessage[] = [...initialMessages];
  return {
    read: () => [...messages],
    append: (message) => {
      messages.push(message);
    },
    clear: () => {
      messages.length = 0;
    },
  };
}

export type RecentTurnProjection = {
  readonly turnId: string;
  readonly userPrompt: string;
  readonly assistantExcerpt: string;
  readonly toolCount: number;
};

export type ProjectRecentTurnsOptions = {
  readonly limit?: number;
  readonly excerptCap?: number;
};

const DEFAULT_LIMIT = 5;
const DEFAULT_EXCERPT_CAP = 280;

export function projectRecentTurns(
  messages: readonly AgentMessage[],
  options: ProjectRecentTurnsOptions = {},
): readonly RecentTurnProjection[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const excerptCap = options.excerptCap ?? DEFAULT_EXCERPT_CAP;
  if (limit <= 0) return [];

  const chronological: RecentTurnProjection[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    const nextUserIndex = messages
      .slice(i + 1)
      .findIndex((candidate) => candidate.role === "user");
    const endIndex =
      nextUserIndex === -1 ? messages.length : i + 1 + nextUserIndex;
    const turnMessages = messages.slice(i + 1, endIndex);
    const assistantMessages = turnMessages.filter(
      (candidate): candidate is AssistantMessage =>
        candidate.role === "assistant",
    );
    const assistant = assistantMessages.at(-1);
    if (assistant === undefined) continue;
    chronological.push({
      turnId: `turn-${chronological.length + 1}`,
      userPrompt: message.content,
      assistantExcerpt: capExcerpt(assistant.content, excerptCap),
      toolCount: assistantMessages.reduce(
        (count, assistantMessage) =>
          count + (assistantMessage.toolCalls?.length ?? 0),
        0,
      ),
    });
  }

  return chronological.slice(-limit).reverse();
}

function capExcerpt(value: string, cap: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= cap) return collapsed;
  if (cap <= 0) return "";
  if (cap <= 3) return ".".repeat(cap);
  return `${collapsed.slice(0, cap - 3)}...`;
}
