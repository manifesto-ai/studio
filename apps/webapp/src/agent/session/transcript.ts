/**
 * Agent session transcript — the append-only log that drives the
 * AgentLens UI. React-free (see `../__tests__/import-boundaries.test.ts`)
 * so this module can move into a standalone package when AG-S1 fires.
 *
 * Shape
 * -----
 * A transcript is an ordered list of `TranscriptEntry` records. Each
 * entry carries a `seq` (monotonic, per-session) and `at` (ISO-8601
 * wall time captured via an injected clock). `user`, `llm`, and `tool`
 * entries form a tree: the orchestrator turns one user prompt into a
 * series of llm/tool entries, all sharing the same `turnId`.
 *
 * Turns are useful because the Lens UI can collapse completed turns
 * into a single row + expand them on demand. The orchestrator emits
 * steps in-order via its `onStep` observer — this module glues those
 * steps into a transcript that the React side only has to subscribe
 * to, not rebuild.
 *
 * Two independence properties we preserve:
 *
 *   1. **No DOM / React.** The store is a plain subscribable value.
 *      The React side wraps it with `useSyncExternalStore`.
 *   2. **No wall-clock default.** Callers pass `now` — tests use a
 *      stepping fake, production uses `() => new Date().toISOString()`.
 */
import type {
  AssistantMessage,
  ChatResponse,
  ToolCall,
} from "../provider/types.js";
import type { OrchestratorStep } from "../agents/orchestrator.js";

export type TranscriptEntry =
  | {
      readonly kind: "user";
      readonly seq: number;
      readonly turnId: string;
      readonly at: string;
      readonly prompt: string;
    }
  | {
      readonly kind: "llm";
      readonly seq: number;
      readonly turnId: string;
      readonly at: string;
      readonly message: AssistantMessage;
      readonly reasoning?: string;
      readonly diagnostics?: ChatResponse["diagnostics"];
    }
  | {
      // In-flight streaming assistant message. Created lazily the
      // first time a content/reasoning delta arrives for a given
      // llm step, and replaced by a regular `llm` entry when the
      // step finalizes. The UI renders this as a live-typing bubble.
      readonly kind: "llm-pending";
      readonly seq: number;
      readonly turnId: string;
      readonly at: string;
      readonly stepIndex: number;
      readonly content: string;
      readonly reasoning: string;
    }
  | {
      readonly kind: "tool";
      readonly seq: number;
      readonly turnId: string;
      readonly at: string;
      readonly toolCall: ToolCall;
      readonly resultJson: string;
    }
  | {
      readonly kind: "turn-end";
      readonly seq: number;
      readonly turnId: string;
      readonly at: string;
      readonly stoppedAtCap: boolean;
      readonly toolUses: number;
    };

export type TranscriptListener = (entries: readonly TranscriptEntry[]) => void;

export type TranscriptClock = () => string;

export type TranscriptStore = {
  readonly getSnapshot: () => readonly TranscriptEntry[];
  readonly subscribe: (listener: TranscriptListener) => () => void;
  /**
   * Begin a new turn and return the id. The same id is stamped on
   * every entry appended before `endTurn(id, ...)` is called. The
   * caller also passes the user prompt so we append the seed entry.
   */
  readonly beginTurn: (prompt: string) => string;
  readonly appendStep: (turnId: string, step: OrchestratorStep) => void;
  /**
   * Apply a streaming delta to the in-flight assistant message for a
   * given (turnId, stepIndex). Creates the pending entry on first
   * delta; appends to content/reasoning on subsequent ones. Replaced
   * by the final `llm` entry when `appendStep({kind: "llm"})` fires
   * for the same stepIndex.
   */
  readonly appendStreamDelta: (
    turnId: string,
    stepIndex: number,
    patch: { readonly content?: string; readonly reasoning?: string },
  ) => void;
  readonly endTurn: (
    turnId: string,
    summary: { readonly stoppedAtCap: boolean; readonly toolUses: number },
  ) => void;
  /** Drop the entire log. Primarily for the "clear" button in the UI. */
  readonly clear: () => void;
};

function lastPendingIndexForTurn(
  entries: readonly TranscriptEntry[],
  turnId: string,
): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "llm-pending" && e.turnId === turnId) return i;
  }
  return -1;
}

export function createTranscriptStore(
  now: TranscriptClock = () => new Date().toISOString(),
): TranscriptStore {
  let entries: readonly TranscriptEntry[] = [];
  let seq = 0;
  let turnSeq = 0;
  const listeners = new Set<TranscriptListener>();

  const notify = (): void => {
    for (const l of listeners) l(entries);
  };

  const push = (entry: TranscriptEntry): void => {
    entries = [...entries, entry];
    notify();
  };

  return {
    getSnapshot: () => entries,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    beginTurn: (prompt) => {
      turnSeq += 1;
      const turnId = `turn-${turnSeq}`;
      seq += 1;
      push({
        kind: "user",
        seq,
        turnId,
        at: now(),
        prompt,
      });
      return turnId;
    },
    appendStep: (turnId, step) => {
      if (step.kind === "llm") {
        // If a pending stream entry exists for this turn, drop it —
        // the finalized llm entry supersedes it. We scan from the end
        // because the pending entry is always the most recent one for
        // a given turn.
        const pendingIdx = lastPendingIndexForTurn(entries, turnId);
        if (pendingIdx !== -1) {
          entries = [
            ...entries.slice(0, pendingIdx),
            ...entries.slice(pendingIdx + 1),
          ];
        }
        seq += 1;
        push({
          kind: "llm",
          seq,
          turnId,
          at: now(),
          message: step.message,
          reasoning: step.reasoning,
          diagnostics: step.diagnostics,
        });
        return;
      }
      seq += 1;
      push({
        kind: "tool",
        seq,
        turnId,
        at: now(),
        toolCall: step.toolCall,
        resultJson: step.resultJson,
      });
    },
    appendStreamDelta: (turnId, stepIndex, patch) => {
      const idx = entries.findIndex(
        (e) =>
          e.kind === "llm-pending" &&
          e.turnId === turnId &&
          e.stepIndex === stepIndex,
      );
      if (idx === -1) {
        seq += 1;
        push({
          kind: "llm-pending",
          seq,
          turnId,
          at: now(),
          stepIndex,
          content: patch.content ?? "",
          reasoning: patch.reasoning ?? "",
        });
        return;
      }
      const existing = entries[idx] as Extract<
        TranscriptEntry,
        { kind: "llm-pending" }
      >;
      const next: TranscriptEntry = {
        ...existing,
        content: existing.content + (patch.content ?? ""),
        reasoning: existing.reasoning + (patch.reasoning ?? ""),
      };
      entries = [...entries.slice(0, idx), next, ...entries.slice(idx + 1)];
      notify();
    },
    endTurn: (turnId, summary) => {
      seq += 1;
      push({
        kind: "turn-end",
        seq,
        turnId,
        at: now(),
        stoppedAtCap: summary.stoppedAtCap,
        toolUses: summary.toolUses,
      });
    },
    clear: () => {
      entries = [];
      seq = 0;
      turnSeq = 0;
      notify();
    },
  };
}

/**
 * Group a flat transcript into turn buckets for UI rendering. The
 * React side renders turns as collapsible cards; this helper keeps
 * the grouping logic out of components so both the web UI and any
 * future headless consumers can share it.
 */
export type TranscriptTurn = {
  readonly turnId: string;
  readonly userPrompt: string;
  readonly steps: readonly TranscriptEntry[];
  /** Final summary entry, if the turn has ended. */
  readonly end: Extract<TranscriptEntry, { kind: "turn-end" }> | null;
};

export function groupByTurn(
  entries: readonly TranscriptEntry[],
): readonly TranscriptTurn[] {
  const byId = new Map<
    string,
    {
      prompt: string;
      steps: TranscriptEntry[];
      end: Extract<TranscriptEntry, { kind: "turn-end" }> | null;
    }
  >();
  const order: string[] = [];
  for (const e of entries) {
    let bucket = byId.get(e.turnId);
    if (bucket === undefined) {
      bucket = { prompt: "", steps: [], end: null };
      byId.set(e.turnId, bucket);
      order.push(e.turnId);
    }
    if (e.kind === "user") bucket.prompt = e.prompt;
    else if (e.kind === "turn-end") bucket.end = e;
    else bucket.steps.push(e);
  }
  return order.map((id) => {
    const b = byId.get(id)!;
    return {
      turnId: id,
      userPrompt: b.prompt,
      steps: b.steps,
      end: b.end,
    };
  });
}
