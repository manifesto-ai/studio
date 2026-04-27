/**
 * ToolActivityRow — meaningful, glance-able rendering of every agent
 * tool call. Replaces the previous JSON-dump `<details>` row.
 *
 * Each tool maps to:
 *   1. A category (read | computed | action) → signal colour.
 *   2. A short `category · target` mono summary line, visible while
 *      collapsed. The user sees what the agent did without expanding.
 *   3. A structured expanded view built from four primitives
 *      (`DiffRow`, `ChipCluster`, `VerdictBlock`, `MiniTimeline`).
 *   4. A `raw` toggle that reveals the JSON dump for debugging.
 *
 * If the tool failed (admission rejection, runtime error, blocked
 * dispatch), the row switches to `effect` (coral) regardless of the
 * tool's natural category.
 */
import { useState, type JSX } from "react";
import { motion } from "motion/react";
import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import {
  ChipCluster,
  DiffRow,
  MiniTimeline,
  VerdictBlock,
  formatScalar,
  type Chip,
  type ChipTone,
  type TimelineEntry,
} from "./tool-primitives.js";

type ToolPart = Extract<
  UIMessagePart<UIDataTypes, UITools>,
  { readonly type: `tool-${string}` }
>;

type ToolCategory = "read" | "computed" | "action";

const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  inspectFocus: "read",
  inspectSnapshot: "read",
  inspectAvailability: "read",
  inspectSchema: "read",
  inspectNeighbors: "read",
  inspectConversation: "read",
  inspectToolAffordances: "read",
  explainLegality: "computed",
  simulateIntent: "computed",
  inspectLineage: "computed",
  generateMock: "computed",
  seedMock: "action",
  dispatch: "action",
  studioDispatch: "action",
};

const CATEGORY_TONE: Record<ToolCategory, ChipTone> = {
  read: "state",
  computed: "computed",
  action: "action",
};

const CATEGORY_LABEL: Record<string, string> = {
  inspectFocus: "focus",
  inspectSnapshot: "state",
  inspectAvailability: "actions",
  inspectSchema: "schema",
  inspectNeighbors: "neighbors",
  inspectConversation: "convo",
  inspectToolAffordances: "tools",
  explainLegality: "legality",
  simulateIntent: "simulate",
  inspectLineage: "lineage",
  generateMock: "mock",
  seedMock: "seed",
  dispatch: "dispatch",
  studioDispatch: "studio",
};

export function isToolPart(
  part: UIMessagePart<UIDataTypes, UITools>,
): part is ToolPart {
  return typeof part.type === "string" && part.type.startsWith("tool-");
}

export function ToolActivityRow({
  part,
}: {
  readonly part: ToolPart;
}): JSX.Element {
  const toolName = part.type.slice("tool-".length);
  const state = (part as { readonly state: string }).state;
  const input = (part as { readonly input?: unknown }).input;
  const output = (part as { readonly output?: unknown }).output;
  const errorText = (part as { readonly errorText?: string }).errorText;

  const failed = state === "output-error" || isToolOutputFailure(output);
  const done = state === "output-available" || state === "output-error";
  const running = !done && !failed;

  const category = CATEGORY_BY_TOOL[toolName] ?? "read";
  const tone: ChipTone = failed ? "effect" : CATEGORY_TONE[category];
  const label = CATEGORY_LABEL[toolName] ?? toolName;
  const summary = describeToolSummary(toolName, input, output, errorText);

  return (
    <motion.details
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="group pl-1 font-mono"
    >
      <summary className="cursor-pointer list-none flex items-center gap-2 rounded-[6px] px-1.5 py-1 hover:bg-[color-mix(in_oklch,var(--color-rule)_35%,transparent)]">
        <Dot tone={tone} pulsing={running} />
        <span
          className="text-[10.5px] uppercase tracking-wider"
          style={{ color: toneFg(tone) }}
        >
          {label}
        </span>
        <span className="text-[var(--color-ink-faint)]">·</span>
        <span className="min-w-0 truncate text-[11.5px] text-[var(--color-ink-dim)]">
          {summary}
        </span>
        {failed ? (
          <span className="ml-auto text-[10.5px] text-[var(--color-sig-effect)] uppercase tracking-wider">
            blocked
          </span>
        ) : running ? (
          <span className="ml-auto text-[10.5px] text-[var(--color-ink-mute)]">
            running
          </span>
        ) : null}
      </summary>
      <div className="ml-5 mt-2 mb-1 flex flex-col gap-2 border-l border-[var(--color-rule)] pl-3">
        <ToolBody
          toolName={toolName}
          input={input}
          output={output}
          errorText={errorText}
          failed={failed}
          done={done}
        />
        <RawToggle input={input} output={output} errorText={errorText} />
      </div>
    </motion.details>
  );
}

function Dot({
  tone,
  pulsing,
}: {
  readonly tone: ChipTone;
  readonly pulsing: boolean;
}): JSX.Element {
  return (
    <motion.span
      animate={
        pulsing
          ? { opacity: [0.45, 1, 0.45], scale: [0.9, 1.35, 0.9] }
          : { opacity: 1, scale: 1 }
      }
      transition={
        pulsing
          ? { duration: 1.05, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.14, ease: "easeOut" }
      }
      className="h-1.5 w-1.5 rounded-full shrink-0"
      style={{
        background: toneFg(tone),
        boxShadow: `0 0 6px ${toneFg(tone)}`,
      }}
    />
  );
}

function ToolBody({
  toolName,
  input,
  output,
  errorText,
  failed,
  done,
}: {
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly errorText: string | undefined;
  readonly failed: boolean;
  readonly done: boolean;
}): JSX.Element {
  if (!done) {
    return (
      <div className="text-[11px] text-[var(--color-ink-mute)]">
        running…
      </div>
    );
  }
  const rawBody = unwrap(output);
  if (failed) {
    return (
      <FailureView
        toolName={toolName}
        body={rawBody}
        output={output}
        errorText={errorText}
      />
    );
  }
  const body: Record<string, unknown> = rawBody ?? {};
  switch (toolName) {
    case "inspectFocus":
      return <FocusBody body={body} />;
    case "inspectSnapshot":
      return <SnapshotBody body={body} />;
    case "inspectAvailability":
      return <AvailabilityBody body={body} />;
    case "inspectSchema":
      return <SchemaBody body={body} />;
    case "inspectNeighbors":
      return <NeighborsBody body={body} />;
    case "inspectLineage":
      return <LineageBody body={body} />;
    case "inspectConversation":
      return <ConversationBody body={body} />;
    case "inspectToolAffordances":
      return <ToolAffordancesBody body={body} />;
    case "explainLegality":
      return <LegalityBody body={body} />;
    case "simulateIntent":
      return <SimulateBody body={body} />;
    case "generateMock":
      return <GenerateMockBody body={body} input={input} />;
    case "seedMock":
      return <SeedMockBody body={body} />;
    case "dispatch":
    case "studioDispatch":
      return <DispatchBody body={body} />;
    default:
      return <FallbackBody body={body} />;
  }
}

// ---------- Per-tool bodies -------------------------------------------------

function FocusBody({ body }: { readonly body: Record<string, unknown> }) {
  const focus = asRecord(body.focus);
  const entity = asRecord(body.entity);
  const status = body.status;
  if (status === "none" || focus === null) {
    return (
      <p className="text-[11.5px] text-[var(--color-ink-dim)]">
        No MEL entity is focused.
      </p>
    );
  }
  const label = strOrNull(entity?.label) ?? strOrNull(focus.nodeId) ?? "(unknown)";
  const kind = strOrNull(focus.kind);
  const type = strOrNull(entity?.type);
  const value = entity?.value;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11.5px]">
        <span className="text-[var(--color-ink)] font-medium">{label}</span>
        {kind !== null ? (
          <ChipCluster chips={[{ label: kind, tone: "state" }]} />
        ) : null}
        {type !== null ? (
          <span className="text-[var(--color-ink-mute)]">: {type}</span>
        ) : null}
      </div>
      {value !== undefined && value !== null ? (
        <div className="text-[11px] text-[var(--color-ink-dim)]">
          value <span className="text-[var(--color-sig-state)]">{formatScalar(value)}</span>
        </div>
      ) : null}
      {strOrNull(body.summary) !== null ? (
        <div className="text-[11px] text-[var(--color-ink-mute)] leading-relaxed">
          {strOrNull(body.summary)}
        </div>
      ) : null}
    </div>
  );
}

function SnapshotBody({ body }: { readonly body: Record<string, unknown> }) {
  const data = asRecord(body.data);
  const computed = asRecord(body.computed);
  const dataChips = data === null ? [] : digestRecordToChips(data, "state");
  const computedChips =
    computed === null ? [] : digestRecordToChips(computed, "computed");
  if (dataChips.length === 0 && computedChips.length === 0) {
    return <p className="text-[11.5px] text-[var(--color-ink-mute)]">(empty snapshot)</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {dataChips.length > 0 ? (
        <Section label="state">
          <ChipCluster chips={dataChips} />
        </Section>
      ) : null}
      {computedChips.length > 0 ? (
        <Section label="computed">
          <ChipCluster chips={computedChips} />
        </Section>
      ) : null}
    </div>
  );
}

function AvailabilityBody({ body }: { readonly body: Record<string, unknown> }) {
  const actions = Array.isArray(body.actions)
    ? (body.actions as readonly Record<string, unknown>[])
    : [];
  if (actions.length === 0) {
    return <p className="text-[11.5px] text-[var(--color-ink-mute)]">(no actions)</p>;
  }
  const live = actions.filter((a) => a.available === true);
  const blocked = actions.filter((a) => a.available !== true);
  return (
    <div className="flex flex-col gap-2">
      {live.length > 0 ? (
        <Section label={`live · ${live.length}`}>
          <ChipCluster
            chips={live.map((a) => ({
              label: strOrNull(a.name) ?? "?",
              tone: "action" as ChipTone,
            }))}
          />
        </Section>
      ) : null}
      {blocked.length > 0 ? (
        <Section label={`blocked · ${blocked.length}`}>
          <ChipCluster
            chips={blocked.map((a) => ({
              label: strOrNull(a.name) ?? "?",
              tone: "neutral" as ChipTone,
            }))}
          />
        </Section>
      ) : null}
    </div>
  );
}

function SchemaBody({ body }: { readonly body: Record<string, unknown> }) {
  const schemaHash = strOrNull(body.schemaHash);
  const stateFields = readArrayOfStrings(body.stateFields);
  const computedFields = readArrayOfStrings(body.computedFields);
  const actions = Array.isArray(body.actions)
    ? (body.actions as readonly Record<string, unknown>[])
    : [];
  const graph = asRecord(body.graph);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2 text-[11px] text-[var(--color-ink-dim)]">
        {schemaHash !== null ? (
          <span className="hash-chip">{schemaHash.slice(0, 10)}</span>
        ) : null}
        {graph !== null ? (
          <span>
            {numOrZero(graph.nodeCount)} nodes · {numOrZero(graph.edgeCount)} edges
          </span>
        ) : null}
      </div>
      {stateFields.length > 0 ? (
        <Section label={`state · ${stateFields.length}`}>
          <ChipCluster
            chips={stateFields.map((name) => ({ label: name, tone: "state" }))}
          />
        </Section>
      ) : null}
      {computedFields.length > 0 ? (
        <Section label={`computed · ${computedFields.length}`}>
          <ChipCluster
            chips={computedFields.map((name) => ({ label: name, tone: "computed" }))}
          />
        </Section>
      ) : null}
      {actions.length > 0 ? (
        <Section label={`actions · ${actions.length}`}>
          <ChipCluster
            chips={actions.map((a) => ({
              label: strOrNull(a.name) ?? "?",
              tone: "action",
            }))}
          />
        </Section>
      ) : null}
    </div>
  );
}

function NeighborsBody({ body }: { readonly body: Record<string, unknown> }) {
  const incoming = Array.isArray(body.incoming)
    ? (body.incoming as readonly Record<string, unknown>[])
    : [];
  const outgoing = Array.isArray(body.outgoing)
    ? (body.outgoing as readonly Record<string, unknown>[])
    : [];
  const nodeId = strOrNull(body.nodeId) ?? "?";
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-[var(--color-ink-dim)]">
        center: <span className="text-[var(--color-ink)]">{nodeId}</span>
      </div>
      {incoming.length > 0 ? (
        <Section label={`incoming · ${incoming.length}`}>
          <ChipCluster
            chips={incoming.map((e) => ({
              label: `${strOrNull(e.peerId) ?? "?"} → ${strOrNull(e.relation) ?? "?"}`,
              tone: edgeRelationTone(strOrNull(e.relation)),
            }))}
          />
        </Section>
      ) : null}
      {outgoing.length > 0 ? (
        <Section label={`outgoing · ${outgoing.length}`}>
          <ChipCluster
            chips={outgoing.map((e) => ({
              label: `${strOrNull(e.relation) ?? "?"} → ${strOrNull(e.peerId) ?? "?"}`,
              tone: edgeRelationTone(strOrNull(e.relation)),
            }))}
          />
        </Section>
      ) : null}
      {incoming.length === 0 && outgoing.length === 0 ? (
        <p className="text-[11.5px] text-[var(--color-ink-mute)]">No edges touch this node.</p>
      ) : null}
    </div>
  );
}

function LineageBody({ body }: { readonly body: Record<string, unknown> }) {
  const entries = Array.isArray(body.entries)
    ? (body.entries as readonly Record<string, unknown>[])
    : [];
  if (entries.length === 0) {
    return <p className="text-[11.5px] text-[var(--color-ink-mute)]">(no lineage)</p>;
  }
  const items: TimelineEntry[] = entries.map((entry) => {
    const origin = asRecord(entry.origin);
    const kind = strOrNull(origin?.kind);
    const intentType =
      kind === "dispatch" ? strOrNull(origin?.intentType) : null;
    const worldId = strOrNull(entry.worldId) ?? "?";
    const tone: ChipTone = kind === "dispatch" ? "action" : "computed";
    return {
      id: worldId,
      label: intentType ?? (kind === "build" ? "build" : kind ?? "?"),
      hint: `#${worldId.slice(0, 8)}`,
      tone,
    };
  });
  const totalMatched = numOrNull(body.totalMatched);
  const totalWorlds = numOrNull(body.totalWorlds);
  return (
    <div className="flex flex-col gap-2">
      {totalMatched !== null && totalWorlds !== null ? (
        <div className="text-[11px] text-[var(--color-ink-mute)]">
          showing {entries.length} of {totalMatched} matched · {totalWorlds} total worlds
        </div>
      ) : null}
      <MiniTimeline entries={items} />
    </div>
  );
}

function ConversationBody({ body }: { readonly body: Record<string, unknown> }) {
  const turns = Array.isArray(body.turns)
    ? (body.turns as readonly Record<string, unknown>[])
    : [];
  if (turns.length === 0) {
    return <p className="text-[11.5px] text-[var(--color-ink-mute)]">(no turns)</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {turns.map((turn, i) => {
        const userPrompt = strOrNull(turn.userPrompt) ?? "";
        const excerpt = strOrNull(turn.assistantExcerpt) ?? "";
        const toolCount = numOrZero(turn.toolCount);
        return (
          <div
            key={strOrNull(turn.turnId) ?? `turn-${i}`}
            className="rounded-[6px] border border-[var(--color-rule)] px-2 py-1.5"
          >
            <div className="text-[11px] text-[var(--color-ink-dim)] truncate">
              <span className="text-[var(--color-violet-hot)]">›</span> {userPrompt}
            </div>
            {excerpt !== "" ? (
              <div className="mt-0.5 text-[11px] text-[var(--color-ink-mute)] line-clamp-2">
                {excerpt}
              </div>
            ) : null}
            {toolCount > 0 ? (
              <div className="mt-1 text-[10.5px] text-[var(--color-ink-faint)]">
                {toolCount} tool call{toolCount === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ToolAffordancesBody({ body }: { readonly body: Record<string, unknown> }) {
  const available = Array.isArray(body.availableTools)
    ? (body.availableTools as readonly string[])
    : [];
  const unavailable = Array.isArray(body.unavailableTools)
    ? (body.unavailableTools as readonly Record<string, unknown>[])
    : [];
  return (
    <div className="flex flex-col gap-2">
      {available.length > 0 ? (
        <Section label={`available · ${available.length}`}>
          <ChipCluster
            chips={available.map((name) => ({ label: name, tone: "state" }))}
          />
        </Section>
      ) : null}
      {unavailable.length > 0 ? (
        <Section label={`blocked · ${unavailable.length}`}>
          <ChipCluster
            chips={unavailable.map((entry) => ({
              label: strOrNull(entry.name) ?? "?",
              tone: "neutral" as ChipTone,
              title: strOrNull(entry.reason) ?? undefined,
            }))}
          />
        </Section>
      ) : null}
    </div>
  );
}

function LegalityBody({ body }: { readonly body: Record<string, unknown> }) {
  const action = strOrNull(body.action) ?? "?";
  const dispatchable = body.dispatchable === true;
  const inputValid = body.inputValid !== false;
  const blockers = Array.isArray(body.blockers)
    ? (body.blockers as readonly Record<string, unknown>[])
    : [];
  const summary = strOrNull(body.summary) ?? undefined;
  if (dispatchable) {
    return (
      <VerdictBlock
        verdict="PASS"
        title={action}
        reason={summary}
      />
    );
  }
  if (!inputValid) {
    return (
      <VerdictBlock
        verdict="INVALID"
        title={action}
        reason={summary}
      />
    );
  }
  const top = blockers[0];
  return (
    <VerdictBlock
      verdict="BLOCKED"
      title={action}
      guardExpression={strOrNull(top?.expression) ?? undefined}
      evaluatedResult={top?.evaluatedResult}
      reason={strOrNull(top?.description) ?? summary}
    />
  );
}

function SimulateBody({ body }: { readonly body: Record<string, unknown> }) {
  const action = strOrNull(body.action) ?? "?";
  const status = strOrNull(body.status);
  const changedPaths = readArrayOfStrings(body.changedPaths);
  const newAvailable = readArrayOfStrings(body.newAvailableActions);
  const blockers = Array.isArray(body.blockers)
    ? (body.blockers as readonly Record<string, unknown>[])
    : [];
  if (status === "blocked") {
    const top = blockers[0];
    return (
      <VerdictBlock
        verdict="BLOCKED"
        title={`${action} (preview)`}
        guardExpression={strOrNull(top?.description) ?? undefined}
        evaluatedResult={top?.evaluatedResult}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-[var(--color-ink-dim)]">
        preview: <span className="text-[var(--color-ink)]">{action}</span>
      </div>
      {changedPaths.length === 0 ? (
        <p className="text-[11.5px] text-[var(--color-ink-mute)]">
          no projected snapshot changes
        </p>
      ) : (
        <Section label={`would change · ${changedPaths.length}`}>
          <div className="flex flex-col gap-0.5">
            {changedPaths.slice(0, 12).map((path) => (
              <DiffRow key={path} path={path} pathOnly />
            ))}
            {changedPaths.length > 12 ? (
              <span className="text-[10.5px] text-[var(--color-ink-faint)]">
                +{changedPaths.length - 12} more
              </span>
            ) : null}
          </div>
        </Section>
      )}
      {newAvailable.length > 0 ? (
        <Section label={`unlocks · ${newAvailable.length}`}>
          <ChipCluster
            chips={newAvailable.map((name) => ({ label: name, tone: "action" }))}
          />
        </Section>
      ) : null}
    </div>
  );
}

function GenerateMockBody({
  body,
  input,
}: {
  readonly body: Record<string, unknown>;
  readonly input: unknown;
}) {
  const action = strOrNull(body.action) ?? strOrNull(asRecord(input)?.action) ?? "?";
  const paramNames = readArrayOfStrings(body.paramNames);
  const samples: readonly (readonly unknown[])[] = Array.isArray(body.samples)
    ? (body.samples as readonly (readonly unknown[])[])
    : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-[var(--color-ink-dim)]">
        generated <span className="text-[var(--color-ink)]">{samples.length}</span> sample
        {samples.length === 1 ? "" : "s"} for{" "}
        <span className="text-[var(--color-ink)]">{action}</span>
      </div>
      {samples.slice(0, 4).map((sample, i) => (
        <div
          key={i}
          className="rounded-[6px] border border-[var(--color-rule)] px-2 py-1.5 text-[11px]"
        >
          <span className="text-[var(--color-ink-faint)]">#{i + 1}</span>{" "}
          {paramNames.length > 0
            ? paramNames.map((name, j) => (
                <span key={name}>
                  {j > 0 ? <span className="text-[var(--color-ink-faint)]">, </span> : null}
                  <span className="text-[var(--color-ink-mute)]">{name}=</span>
                  <span className="text-[var(--color-sig-action)]">
                    {formatScalar(sample[j])}
                  </span>
                </span>
              ))
            : sample.map((v, j) => (
                <span key={j}>
                  {j > 0 ? <span className="text-[var(--color-ink-faint)]">, </span> : null}
                  <span className="text-[var(--color-sig-action)]">{formatScalar(v)}</span>
                </span>
              ))}
        </div>
      ))}
      {samples.length > 4 ? (
        <span className="text-[10.5px] text-[var(--color-ink-faint)]">
          +{samples.length - 4} more samples
        </span>
      ) : null}
    </div>
  );
}

function SeedMockBody({ body }: { readonly body: Record<string, unknown> }) {
  const action = strOrNull(body.action) ?? "?";
  const completed = numOrZero(body.completed);
  const rejected = numOrZero(body.rejected);
  const failed = numOrZero(body.failed);
  const errored = numOrZero(body.errored);
  const attempted = numOrZero(body.attempted);
  const chips: Chip[] = [];
  if (completed > 0)
    chips.push({ label: `completed ${completed}`, tone: "action" });
  if (rejected > 0) chips.push({ label: `rejected ${rejected}`, tone: "effect" });
  if (failed > 0) chips.push({ label: `failed ${failed}`, tone: "effect" });
  if (errored > 0) chips.push({ label: `errored ${errored}`, tone: "effect" });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-[var(--color-ink-dim)]">
        seeded <span className="text-[var(--color-ink)]">{action}</span> ·
        attempted <span className="text-[var(--color-ink)]">{attempted}</span>
      </div>
      <ChipCluster chips={chips} />
    </div>
  );
}

function DispatchBody({ body }: { readonly body: Record<string, unknown> }) {
  const action = strOrNull(body.action) ?? "?";
  const status = strOrNull(body.status) ?? "?";
  const changedPaths = readArrayOfStrings(body.changedPaths);
  if (status !== "completed") {
    return (
      <VerdictBlock
        verdict={status === "unavailable" || status === "rejected" ? "BLOCKED" : "INVALID"}
        title={action}
        reason={strOrNull(body.summary) ?? strOrNull(body.error) ?? undefined}
      />
    );
  }
  if (changedPaths.length === 0) {
    return (
      <p className="text-[11.5px] text-[var(--color-ink-dim)]">
        {action} dispatched · no state paths changed
      </p>
    );
  }
  return (
    <Section label={`changed · ${changedPaths.length}`}>
      <div className="flex flex-col gap-0.5">
        {changedPaths.slice(0, 16).map((path) => (
          <DiffRow key={path} path={path} pathOnly />
        ))}
        {changedPaths.length > 16 ? (
          <span className="text-[10.5px] text-[var(--color-ink-faint)]">
            +{changedPaths.length - 16} more
          </span>
        ) : null}
      </div>
    </Section>
  );
}

function FailureView({
  toolName,
  body,
  output,
  errorText,
}: {
  readonly toolName: string;
  readonly body: Record<string, unknown> | null;
  readonly output: unknown;
  readonly errorText: string | undefined;
}) {
  const top = asRecord(output);
  const message =
    errorText ??
    strOrNull(top?.message) ??
    strOrNull(body?.summary) ??
    strOrNull(body?.error) ??
    "blocked";
  const status = strOrNull(top?.kind) ?? strOrNull(body?.status) ?? "blocked";
  return (
    <VerdictBlock
      verdict={status === "unavailable" || status === "rejected" || status === "blocked" ? "BLOCKED" : "INVALID"}
      title={toolName}
      reason={message}
    />
  );
}

function FallbackBody({ body }: { readonly body: Record<string, unknown> | null }) {
  if (body === null) return null;
  const summary = strOrNull(body.summary);
  if (summary !== null) {
    return (
      <p className="text-[11.5px] text-[var(--color-ink-dim)] leading-relaxed">
        {summary}
      </p>
    );
  }
  return null;
}

// ---------- Section + RawToggle ---------------------------------------------

function Section({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-wider text-[var(--color-ink-mute)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function RawToggle({
  input,
  output,
  errorText,
}: {
  readonly input: unknown;
  readonly output: unknown;
  readonly errorText: string | undefined;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-ink-mute)]"
      >
        {open ? "− raw" : "+ raw"}
      </button>
      {open ? (
        <pre className="mt-1.5 px-2 py-2 border-l border-[var(--color-rule)] text-[10.5px] text-[var(--color-ink-mute)] whitespace-pre-wrap break-all">
          {formatToolData(input, output, errorText)}
        </pre>
      ) : null}
    </div>
  );
}

// ---------- Summary line (collapsed state) ---------------------------------

function describeToolSummary(
  toolName: string,
  input: unknown,
  output: unknown,
  errorText: string | undefined,
): string {
  if (errorText !== undefined && errorText !== "") return errorText;
  const top = asRecord(output);
  const body = unwrap(output);
  if (body === null) return "(no output)";
  switch (toolName) {
    case "inspectFocus": {
      const focus = asRecord(body.focus);
      const entity = asRecord(body.entity);
      const label = strOrNull(entity?.label);
      const nodeId = strOrNull(focus?.nodeId);
      if (body.status === "none") return "no focus";
      return label ?? nodeId ?? strOrNull(body.summary) ?? "?";
    }
    case "inspectSnapshot": {
      const data = asRecord(body.data);
      if (data === null) return "(empty)";
      const keys = Object.keys(data);
      if (keys.length === 0) return "(empty)";
      const counts = keys
        .slice(0, 2)
        .map((k) => `${k} ${describeFieldShape(data[k])}`)
        .join(" · ");
      return keys.length > 2 ? `${counts} · +${keys.length - 2}` : counts;
    }
    case "inspectAvailability": {
      const actions = Array.isArray(body.actions) ? body.actions : [];
      const live = actions.filter(
        (a) => asRecord(a)?.available === true,
      ).length;
      return `${live}/${actions.length} live`;
    }
    case "inspectSchema": {
      const hash = strOrNull(body.schemaHash);
      const actions = Array.isArray(body.actions) ? body.actions.length : 0;
      return hash !== null
        ? `${hash.slice(0, 8)} · ${actions} actions`
        : `${actions} actions`;
    }
    case "inspectNeighbors": {
      const node = strOrNull(body.nodeId) ?? "?";
      const inc = Array.isArray(body.incoming) ? body.incoming.length : 0;
      const out = Array.isArray(body.outgoing) ? body.outgoing.length : 0;
      return `${node} · ${inc} in · ${out} out`;
    }
    case "inspectLineage": {
      const entries = Array.isArray(body.entries)
        ? (body.entries as readonly Record<string, unknown>[])
        : [];
      const total = numOrNull(body.totalWorlds);
      const head = entries[0];
      const headOrigin = asRecord(head?.origin);
      const headIntent = strOrNull(headOrigin?.intentType);
      const totalLabel = total !== null ? `${total} worlds` : `${entries.length} worlds`;
      return headIntent !== null ? `${totalLabel} · head: ${headIntent}` : totalLabel;
    }
    case "inspectConversation": {
      const turns = Array.isArray(body.turns) ? body.turns.length : 0;
      const total = numOrNull(body.totalTurns);
      return total !== null ? `${turns}/${total} turns` : `${turns} turns`;
    }
    case "inspectToolAffordances": {
      const a = Array.isArray(body.availableTools) ? body.availableTools.length : 0;
      const b = numOrZero(body.unavailableToolCount);
      return `${a} ready · ${b} blocked`;
    }
    case "explainLegality": {
      const action = strOrNull(body.action) ?? "?";
      if (body.dispatchable === true) return `${action} · ready`;
      const blockers = Array.isArray(body.blockers) ? body.blockers : [];
      const top = asRecord(blockers[0]);
      const expr = strOrNull(top?.expression);
      const evald = top?.evaluatedResult;
      if (expr !== null) {
        return `${action} · BLOCKED — ${expr} = ${formatScalar(evald)}`;
      }
      return `${action} · BLOCKED`;
    }
    case "simulateIntent": {
      const action = strOrNull(body.action) ?? "?";
      const status = strOrNull(body.status);
      if (status === "blocked") return `${action} · blocked`;
      const paths = readArrayOfStrings(body.changedPaths);
      if (paths.length === 0) return `${action} · no changes`;
      return `${action} · ${paths[0]}${paths.length > 1 ? ` +${paths.length - 1}` : ""}`;
    }
    case "generateMock": {
      const action = strOrNull(body.action) ?? strOrNull(asRecord(input)?.action) ?? "?";
      const samples = Array.isArray(body.samples) ? body.samples.length : 0;
      return `${action} · ${samples} sample${samples === 1 ? "" : "s"}`;
    }
    case "seedMock": {
      const action = strOrNull(body.action) ?? "?";
      const completed = numOrZero(body.completed);
      const attempted = numOrZero(body.attempted);
      return `${action} · ${completed}/${attempted} seeded`;
    }
    case "dispatch":
    case "studioDispatch": {
      const action = strOrNull(body.action) ?? "?";
      const status = strOrNull(body.status);
      if (status !== "completed") return `${action} · ${status ?? "?"}`;
      const paths = readArrayOfStrings(body.changedPaths);
      if (paths.length === 0) return `${action} · ok`;
      return `${action} · ${paths[0]}${paths.length > 1 ? ` +${paths.length - 1}` : ""}`;
    }
    default: {
      const summary = strOrNull(body.summary);
      if (summary !== null) return summary.slice(0, 96);
      return strOrNull(top?.message) ?? "(done)";
    }
  }
}

// ---------- Helpers ---------------------------------------------------------

function unwrap(output: unknown): Record<string, unknown> | null {
  const top = asRecord(output);
  if (top === null) return null;
  if ("output" in top && asRecord(top.output) !== null) {
    return asRecord(top.output);
  }
  return top;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numOrZero(v: unknown): number {
  return numOrNull(v) ?? 0;
}

function readArrayOfStrings(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function describeFieldShape(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).length}}`;
  }
  return formatScalar(value);
}

function digestRecordToChips(
  record: Record<string, unknown>,
  tone: ChipTone,
): readonly Chip[] {
  const keys = Object.keys(record).slice(0, 8);
  return keys.map((key) => ({
    label: `${key} ${describeFieldShape(record[key])}`,
    tone,
  }));
}

function edgeRelationTone(relation: string | null): ChipTone {
  if (relation === "mutates") return "action";
  if (relation === "feeds") return "computed";
  if (relation === "unlocks") return "state";
  return "neutral";
}

function toneFg(tone: ChipTone): string {
  switch (tone) {
    case "state":
      return "var(--color-sig-state)";
    case "action":
      return "var(--color-sig-action)";
    case "computed":
      return "var(--color-sig-computed)";
    case "effect":
      return "var(--color-sig-effect)";
    case "neutral":
      return "var(--color-ink-mute)";
  }
}

function isToolOutputFailure(output: unknown): boolean {
  const top = asRecord(output);
  if (top?.ok === false) return true;
  const body = unwrap(output);
  const status = body?.status;
  return (
    status === "unavailable" ||
    status === "rejected" ||
    status === "failed" ||
    status === "blocked"
  );
}

function formatToolData(
  input: unknown,
  output: unknown,
  errorText: string | undefined,
): string {
  const chunks: string[] = [];
  if (input !== undefined) chunks.push(`input\n${stringifySafe(input)}`);
  if (errorText !== undefined && errorText !== "") {
    chunks.push(`error\n${errorText}`);
  } else if (output !== undefined) {
    chunks.push(`output\n${stringifySafe(output)}`);
  }
  return chunks.join("\n\n") || "(no data)";
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
