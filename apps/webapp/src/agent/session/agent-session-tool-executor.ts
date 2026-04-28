/**
 * AgentSession-shaped wrapper around the existing tool admission +
 * execution pipeline. Used by the AgentSessionDriver during the
 * `awaitingTool` phase.
 *
 * What this does, in order:
 *   1. Calls the host-supplied `syncContext()` so the studio.mel
 *      runtime has the latest user-domain readiness flags before
 *      admission gates evaluate.
 *   2. Looks up the requested tool implementation. Unknown tools
 *      route through `rejectUnavailableTool` so the model gets a
 *      structured error instead of a thrown exception.
 *   3. Dispatches the matching `admit*` MEL action via
 *      `admitToolCall`. If the runtime rejects, the executor
 *      returns the rejection as an `outcome="blocked"` result.
 *   4. If admitted, runs the bound tool through `executeToolLocally`.
 *   5. Fires `markObserved(toolName, output)` so studio.mel knows
 *      the agent has freshly inspected schema / focus / etc.
 *   6. Maps the raw result through `classifyToolOutcome` so the
 *      driver can dispatch `recordToolResult(callId, outcome,
 *      output)` cleanly.
 *
 * Boundary discipline: this lives in `agent/session/` (future-core
 * territory) but pulls from `agent/tools/` for the existing
 * admission helpers. Both directories are restricted; sibling
 * imports inside the future-core boundary are fine.
 */
import {
  admitToolCall,
  rejectUnavailableTool,
  type ToolAdmissionRuntime,
  type ToolImplementation,
} from "../tools/affordances.js";
import { createToolRegistry } from "../tools/types.js";
import { executeToolLocally } from "../adapters/ai-sdk-tools.js";
import {
  classifyToolOutcome,
} from "./agent-session-shadow.js";
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutor,
} from "./agent-session-effects.js";

export type ToolExecutorDeps = {
  /** Tools the executor may run. Same registry the agent prompt sees. */
  readonly toolImplementations: readonly ToolImplementation[];
  /**
   * Build the admission runtime on demand. Returns null when the
   * Studio UI runtime isn't ready yet — executor surfaces this as a
   * blocked outcome rather than throwing.
   */
  readonly buildAdmissionRuntime: () => ToolAdmissionRuntime | null;
  /** Flat list of user-domain action names; used when the requested tool name is unknown. */
  readonly listDomainActionNames: () => readonly string[];
  /**
   * Sync the Studio UI runtime with the latest user-domain readiness
   * flags before each tool admission. The host is best positioned to
   * decide what "context" means in its setup, so we inject.
   */
  readonly syncContext: () => Promise<void>;
  /**
   * Optional post-execution hooks for tools that observe stale state
   * (inspectSchema → markAgentSchemaObserved, inspectFocus →
   * markAgentFocusObserved, etc.). The executor calls these only on
   * successful admission + execution.
   */
  readonly markObserved?: (
    toolName: string,
    output: unknown,
  ) => Promise<void>;
};

export function createDefaultToolExecutor(
  deps: ToolExecutorDeps,
): ToolExecutor {
  return {
    execute: async (request) => runOne(deps, request),
  };
}

async function runOne(
  deps: ToolExecutorDeps,
  request: ToolExecutionRequest,
): Promise<ToolExecutionResult> {
  await safeSyncContext(deps);

  const admissionRuntime = deps.buildAdmissionRuntime();
  const toolImpl = deps.toolImplementations.find(
    (entry) => entry.tool.name === request.toolName,
  );

  const admission =
    toolImpl === undefined
      ? rejectUnavailableTool(
          deps.toolImplementations,
          request.toolName,
          admissionRuntime,
          { domainActionNames: deps.listDomainActionNames() },
        )
      : await admitToolCall(toolImpl, admissionRuntime, request.input);

  if (!admission.ok || toolImpl === undefined) {
    return {
      outcome: classifyToolOutcome(admission),
      output: admission,
    };
  }

  const result = await executeToolLocally(
    createToolRegistry([toolImpl.tool]),
    request.toolName,
    request.input,
  );

  if (result.ok && deps.markObserved !== undefined) {
    try {
      await deps.markObserved(request.toolName, result.output);
    } catch {
      // markObserved is best-effort — never fail the tool result on it.
    }
  }

  return {
    outcome: classifyToolOutcome(result),
    output: result,
  };
}

async function safeSyncContext(deps: ToolExecutorDeps): Promise<void> {
  try {
    await deps.syncContext();
  } catch {
    // syncContext failures are surfaced separately by the caller's
    // own logging; the executor keeps going so admission can still
    // run on the existing context.
  }
}
