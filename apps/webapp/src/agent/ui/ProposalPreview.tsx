import type { AgentProposal } from "../session/proposal-buffer.js";

export type ProposalPreviewProps = {
  readonly proposal: AgentProposal;
  readonly onAccept: () => void;
  readonly onReject: () => void;
};

type DiffLineKind = "context" | "delete" | "insert";

type DiffLine = {
  readonly kind: DiffLineKind;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly text: string;
};

type DiffSkip = {
  readonly kind: "skip";
  readonly hiddenCount: number;
};

type DiffRow = DiffLine | DiffSkip;

type DiffHunk = {
  readonly header: string;
  readonly rows: readonly DiffRow[];
};

type DiffModel = {
  readonly hunks: readonly DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
  readonly changed: boolean;
};

const CONTEXT_RADIUS = 3;
const LCS_CELL_LIMIT = 90_000;

export function ProposalPreview({
  proposal,
  onAccept,
  onReject,
}: ProposalPreviewProps): JSX.Element {
  const diff = buildUnifiedDiff(proposal.originalSource, proposal.proposedSource);
  const canAccept = proposal.status === "verified";
  return (
    <section
      className="
        mx-4 mt-3 mb-1
        rounded-[14px] overflow-hidden
        border border-[color-mix(in_oklch,var(--color-violet-hot)_42%,var(--color-rule))]
        bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-violet-hot)_11%,transparent),color-mix(in_oklch,var(--color-void-hi)_78%,transparent))]
        shadow-[0_24px_70px_-42px_color-mix(in_oklch,var(--color-violet-hot)_55%,transparent)]
      "
      aria-label="Agent proposal preview"
    >
      <header className="px-3 py-2.5 border-b border-[var(--color-rule)]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill status={proposal.status} />
              <MetricPill tone="add" label={`+${diff.additions}`} />
              <MetricPill tone="delete" label={`-${diff.deletions}`} />
              {proposal.schemaHash !== null ? (
                <span
                  className="
                    px-1.5 py-[2px] rounded-md
                    border border-[var(--color-rule)]
                    text-[10px] font-mono
                    text-[var(--color-ink-mute)]
                    bg-[color-mix(in_oklch,var(--color-void)_45%,transparent)]
                  "
                  title={proposal.schemaHash}
                >
                  {proposal.schemaHash.slice(0, 8)}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 text-[13px] font-sans font-semibold text-[var(--color-ink)] truncate">
              {proposal.title}
            </div>
            {proposal.rationale !== "" ? (
              <div className="mt-1 text-[11.5px] font-sans text-[var(--color-ink-mute)] leading-relaxed line-clamp-2">
                {proposal.rationale}
              </div>
            ) : null}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onReject}
              className="
                px-2.5 py-1.5 rounded-lg
                text-[11px] font-sans
                border border-[var(--color-rule)]
                bg-[color-mix(in_oklch,var(--color-void)_32%,transparent)]
                text-[var(--color-ink-mute)]
                hover:text-[var(--color-ink)]
                hover:border-[var(--color-rule-strong)]
              "
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={!canAccept}
              className="
                px-2.5 py-1.5 rounded-lg
                text-[11px] font-sans font-semibold
                bg-[var(--color-violet-hot)]
                text-[var(--color-void)]
                shadow-[0_0_18px_-8px_var(--color-violet-hot)]
                disabled:bg-transparent
                disabled:text-[var(--color-ink-mute)]
                disabled:border disabled:border-[var(--color-rule)]
                disabled:shadow-none
                disabled:cursor-not-allowed
              "
            >
              Accept
            </button>
          </div>
        </div>
      </header>

      {proposal.diagnostics.length > 0 ? (
        <DiagnosticsPanel proposal={proposal} />
      ) : null}

      <div className="px-2.5 py-2.5">
        <div
          className="
            overflow-hidden rounded-[10px]
            border border-[var(--color-rule)]
            bg-[color-mix(in_oklch,var(--color-void)_62%,transparent)]
          "
        >
          <div
            className="
              flex items-center justify-between gap-2
              px-2.5 py-1.5
              border-b border-[var(--color-rule)]
              text-[10px] font-mono uppercase tracking-wider
              text-[var(--color-ink-mute)]
            "
          >
            <span>source diff</span>
            <span>{diff.changed ? `${diff.hunks.length} hunk${diff.hunks.length === 1 ? "" : "s"}` : "no changes"}</span>
          </div>
          <DiffView diff={diff} />
        </div>
      </div>
    </section>
  );
}

function StatusPill({
  status,
}: {
  readonly status: AgentProposal["status"];
}): JSX.Element {
  const verified = status === "verified";
  return (
    <span
      className={`
        px-1.5 py-[2px] rounded-md
        border text-[10px] font-mono uppercase tracking-wider
        ${
          verified
            ? "border-[color-mix(in_oklch,var(--color-sig-determ)_40%,var(--color-rule))] text-[var(--color-sig-determ)] bg-[color-mix(in_oklch,var(--color-sig-determ)_9%,transparent)]"
            : "border-[color-mix(in_oklch,var(--color-sig-effect)_42%,var(--color-rule))] text-[var(--color-sig-effect)] bg-[color-mix(in_oklch,var(--color-sig-effect)_9%,transparent)]"
        }
      `}
    >
      {verified ? "verified patch" : "invalid patch"}
    </span>
  );
}

function MetricPill({
  tone,
  label,
}: {
  readonly tone: "add" | "delete";
  readonly label: string;
}): JSX.Element {
  const color =
    tone === "add" ? "var(--color-sig-determ)" : "var(--color-sig-effect)";
  return (
    <span
      className="
        px-1.5 py-[2px] rounded-md
        border border-[var(--color-rule)]
        text-[10px] font-mono
        bg-[color-mix(in_oklch,var(--color-void)_40%,transparent)]
      "
      style={{ color }}
    >
      {label}
    </span>
  );
}

function DiagnosticsPanel({
  proposal,
}: {
  readonly proposal: AgentProposal;
}): JSX.Element {
  return (
    <div className="px-3 py-2 border-b border-[var(--color-rule)] bg-[color-mix(in_oklch,var(--color-sig-effect)_6%,transparent)]">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-sig-effect)]">
          diagnostics · {proposal.diagnostics.length}
        </div>
        {proposal.diagnostics.length > 5 ? (
          <div className="text-[10px] font-mono text-[var(--color-ink-mute)]">
            showing first 5
          </div>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1">
        {proposal.diagnostics.slice(0, 5).map((d, i) => (
          <li
            key={`${d.line}:${d.column}:${i}`}
            className="
              grid grid-cols-[52px_54px_minmax(0,1fr)] gap-2
              text-[11px] font-mono leading-relaxed
              text-[var(--color-ink-dim)]
            "
          >
            <span
              className={
                d.severity === "error"
                  ? "text-[var(--color-sig-effect)]"
                  : "text-[var(--color-sig-action)]"
              }
            >
              {d.severity}
            </span>
            <span className="text-[var(--color-ink-mute)]">
              {d.line}:{d.column}
            </span>
            <span className="min-w-0 truncate">{d.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffView({ diff }: { readonly diff: DiffModel }): JSX.Element {
  if (!diff.changed) {
    return (
      <div className="px-3 py-6 text-center text-[11.5px] font-mono text-[var(--color-ink-mute)]">
        No source changes in this proposal.
      </div>
    );
  }

  return (
    <div className="max-h-[360px] overflow-auto">
      {diff.hunks.map((hunk, hunkIndex) => (
        <div key={`${hunk.header}:${hunkIndex}`}>
          <div
            className="
              sticky top-0 z-[1]
              px-2.5 py-1
              border-y border-[var(--color-rule)]
              bg-[color-mix(in_oklch,var(--color-violet-deep)_20%,var(--color-void))]
              text-[10px] font-mono
              text-[var(--color-violet-hot)]
            "
          >
            {hunk.header}
          </div>
          <div className="font-mono text-[10.5px] leading-[1.45]">
            {hunk.rows.map((row, rowIndex) =>
              row.kind === "skip" ? (
                <SkipRow key={`skip:${rowIndex}`} row={row} />
              ) : (
                <DiffLineRow key={`${row.kind}:${row.oldLine}:${row.newLine}:${rowIndex}`} row={row} />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SkipRow({ row }: { readonly row: DiffSkip }): JSX.Element {
  return (
    <div
      className="
        grid grid-cols-[42px_42px_22px_minmax(0,1fr)]
        border-b border-[color-mix(in_oklch,var(--color-rule)_55%,transparent)]
        text-[var(--color-ink-faint)]
      "
    >
      <div className="px-1.5 py-[3px] text-right select-none">...</div>
      <div className="px-1.5 py-[3px] text-right select-none">...</div>
      <div className="px-1.5 py-[3px] text-center select-none">·</div>
      <div className="px-1.5 py-[3px] italic">
        {row.hiddenCount} unchanged line{row.hiddenCount === 1 ? "" : "s"} hidden
      </div>
    </div>
  );
}

function DiffLineRow({ row }: { readonly row: DiffLine }): JSX.Element {
  const tone = resolveDiffTone(row.kind);
  return (
    <div
      className={`
        grid grid-cols-[42px_42px_22px_minmax(0,1fr)]
        border-b border-[color-mix(in_oklch,var(--color-rule)_46%,transparent)]
        ${tone.rowClass}
      `}
    >
      <LineNumber value={row.oldLine} />
      <LineNumber value={row.newLine} />
      <div className={`${tone.signClass} px-1.5 py-[3px] text-center select-none`}>
        {row.kind === "insert" ? "+" : row.kind === "delete" ? "-" : ""}
      </div>
      <code className="px-1.5 py-[3px] whitespace-pre min-w-0 overflow-visible text-[var(--color-ink-dim)]">
        {row.text === "" ? " " : row.text}
      </code>
    </div>
  );
}

function LineNumber({ value }: { readonly value: number | null }): JSX.Element {
  return (
    <div
      className="
        px-1.5 py-[3px]
        text-right tabular-nums select-none
        text-[var(--color-ink-faint)]
        border-r border-[color-mix(in_oklch,var(--color-rule)_50%,transparent)]
      "
    >
      {value ?? ""}
    </div>
  );
}

function resolveDiffTone(kind: DiffLineKind): {
  readonly rowClass: string;
  readonly signClass: string;
} {
  if (kind === "insert") {
    return {
      rowClass:
        "bg-[color-mix(in_oklch,var(--color-sig-determ)_10%,transparent)]",
      signClass: "text-[var(--color-sig-determ)]",
    };
  }
  if (kind === "delete") {
    return {
      rowClass:
        "bg-[color-mix(in_oklch,var(--color-sig-effect)_10%,transparent)]",
      signClass: "text-[var(--color-sig-effect)]",
    };
  }
  return {
    rowClass: "bg-transparent",
    signClass: "text-[var(--color-ink-faint)]",
  };
}

function buildUnifiedDiff(original: string, proposed: string): DiffModel {
  const before = splitLines(original);
  const after = splitLines(proposed);
  const raw =
    before.length * after.length <= LCS_CELL_LIMIT
      ? buildLcsDiff(before, after)
      : buildWindowDiff(before, after);
  const additions = raw.filter((line) => line.kind === "insert").length;
  const deletions = raw.filter((line) => line.kind === "delete").length;
  const changed = additions > 0 || deletions > 0;
  return {
    hunks: changed ? buildHunks(raw) : [],
    additions,
    deletions,
    changed,
  };
}

function splitLines(source: string): readonly string[] {
  if (source === "") return [];
  const lines = source.split(/\r?\n/);
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function buildLcsDiff(
  before: readonly string[],
  after: readonly string[],
): readonly DiffLine[] {
  const width = after.length + 1;
  const dp = new Uint16Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      const idx = i * width + j;
      dp[idx] =
        before[i] === after[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const rows: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({
        kind: "context",
        oldLine: i + 1,
        newLine: j + 1,
        text: before[i] ?? "",
      });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      rows.push({
        kind: "delete",
        oldLine: i + 1,
        newLine: null,
        text: before[i] ?? "",
      });
      i += 1;
    } else {
      rows.push({
        kind: "insert",
        oldLine: null,
        newLine: j + 1,
        text: after[j] ?? "",
      });
      j += 1;
    }
  }
  while (i < before.length) {
    rows.push({
      kind: "delete",
      oldLine: i + 1,
      newLine: null,
      text: before[i] ?? "",
    });
    i += 1;
  }
  while (j < after.length) {
    rows.push({
      kind: "insert",
      oldLine: null,
      newLine: j + 1,
      text: after[j] ?? "",
    });
    j += 1;
  }
  return rows;
}

function buildWindowDiff(
  before: readonly string[],
  after: readonly string[],
): readonly DiffLine[] {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start += 1;
  }
  let beforeEnd = before.length - 1;
  let afterEnd = after.length - 1;
  while (
    beforeEnd >= start &&
    afterEnd >= start &&
    before[beforeEnd] === after[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const rows: DiffLine[] = [];
  for (let i = 0; i < start; i++) {
    rows.push({ kind: "context", oldLine: i + 1, newLine: i + 1, text: before[i] ?? "" });
  }
  for (let i = start; i <= beforeEnd; i++) {
    rows.push({ kind: "delete", oldLine: i + 1, newLine: null, text: before[i] ?? "" });
  }
  for (let i = start; i <= afterEnd; i++) {
    rows.push({ kind: "insert", oldLine: null, newLine: i + 1, text: after[i] ?? "" });
  }
  const tailOldStart = beforeEnd + 1;
  const tailNewStart = afterEnd + 1;
  for (
    let oldIndex = tailOldStart, newIndex = tailNewStart;
    oldIndex < before.length && newIndex < after.length;
    oldIndex++, newIndex++
  ) {
    rows.push({
      kind: "context",
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
      text: before[oldIndex] ?? "",
    });
  }
  return rows;
}

function buildHunks(raw: readonly DiffLine[]): readonly DiffHunk[] {
  const changedIndexes = raw
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - CONTEXT_RADIUS);
    const end = Math.min(raw.length - 1, changedIndex + CONTEXT_RADIUS);
    const last = ranges.at(-1);
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((range, index) => {
    const rows: DiffRow[] = [];
    if (index === 0 && range.start > 0) {
      rows.push({ kind: "skip", hiddenCount: range.start });
    }
    rows.push(...raw.slice(range.start, range.end + 1));
    const next = ranges[index + 1];
    if (next !== undefined) {
      const hiddenCount = next.start - range.end - 1;
      if (hiddenCount > 0) rows.push({ kind: "skip", hiddenCount });
    } else if (range.end < raw.length - 1) {
      rows.push({ kind: "skip", hiddenCount: raw.length - 1 - range.end });
    }
    return {
      header: formatHunkHeader(raw.slice(range.start, range.end + 1)),
      rows,
    };
  });
}

function formatHunkHeader(lines: readonly DiffLine[]): string {
  const oldLines = lines
    .map((line) => line.oldLine)
    .filter((line): line is number => line !== null);
  const newLines = lines
    .map((line) => line.newLine)
    .filter((line): line is number => line !== null);
  const oldStart = oldLines[0] ?? 0;
  const newStart = newLines[0] ?? 0;
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}
