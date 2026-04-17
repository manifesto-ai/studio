import type {
  IdentityFate,
  LocalTargetKey,
  ReconciliationPlan,
} from "../types/reconciliation.js";

export type FormatPlanOptions = {
  /**
   * Maximum number of target entries shown per bucket. Use Infinity to show
   * everything. Defaults to 20 (enough for Phase 0 domains; stress fixtures
   * truncate with a trailing ellipsis).
   */
  readonly maxPerBucket?: number;
};

const DEFAULT_OPTIONS: Required<FormatPlanOptions> = { maxPerBucket: 20 };

function hashSummary(hash: string | null): string {
  if (hash === null) return "∅";
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 8)}…`;
}

function fateGlyph(fate: IdentityFate): string {
  switch (fate.kind) {
    case "preserved":
      return "=";
    case "initialized":
      return fate.reason === "new" ? "+" : "↻";
    case "discarded":
      return fate.reason === "removed" ? "-" : "≠";
    case "renamed":
      return "↦";
  }
}

function fateLabel(fate: IdentityFate): string {
  switch (fate.kind) {
    case "preserved":
      return "preserved";
    case "initialized":
      return `initialized (${fate.reason})`;
    case "discarded":
      return `discarded (${fate.reason})`;
    case "renamed":
      return `renamed (from ${fate.from})`;
  }
}

function truncate<T>(values: readonly T[], limit: number): readonly T[] {
  if (values.length <= limit) return values;
  return values.slice(0, limit);
}

function bucketSection(
  title: string,
  items: readonly LocalTargetKey[],
  limit: number,
): readonly string[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort();
  const shown = truncate(sorted, limit);
  const lines = [`  ${title} (${items.length}):`];
  for (const key of shown) lines.push(`    • ${key}`);
  if (shown.length < sorted.length) {
    lines.push(`    … (+${sorted.length - shown.length} more)`);
  }
  return lines;
}

/**
 * Render a ReconciliationPlan as a human-readable text block. Stable ordering
 * (lexicographic per bucket) so diffing two plans is meaningful.
 */
export function formatPlan(
  plan: ReconciliationPlan,
  options?: FormatPlanOptions,
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  lines.push(
    `ReconciliationPlan  ${hashSummary(plan.prevSchemaHash)} → ${hashSummary(plan.nextSchemaHash)}`,
  );
  lines.push(`  identity entries: ${plan.identityMap.size}`);

  const entries = [...plan.identityMap.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  if (entries.length > 0) {
    lines.push("  identity breakdown:");
    const shown = truncate(entries, opts.maxPerBucket);
    for (const [key, fate] of shown) {
      lines.push(`    ${fateGlyph(fate)} ${key}  [${fateLabel(fate)}]`);
    }
    if (shown.length < entries.length) {
      lines.push(`    … (+${entries.length - shown.length} more)`);
    }
  }

  lines.push("  snapshot:");
  lines.push(...bucketSection("preserved", plan.snapshotPlan.preserved, opts.maxPerBucket));
  lines.push(
    ...bucketSection("initialized", plan.snapshotPlan.initialized, opts.maxPerBucket),
  );
  lines.push(
    ...bucketSection("discarded", plan.snapshotPlan.discarded, opts.maxPerBucket),
  );
  if (plan.snapshotPlan.warned.length > 0) {
    lines.push(`    warnings (${plan.snapshotPlan.warned.length}):`);
    for (const w of truncate(plan.snapshotPlan.warned, opts.maxPerBucket)) {
      lines.push(`      ! ${w.target}: ${w.message}`);
    }
  }
  if (
    plan.snapshotPlan.preserved.length === 0 &&
    plan.snapshotPlan.initialized.length === 0 &&
    plan.snapshotPlan.discarded.length === 0 &&
    plan.snapshotPlan.warned.length === 0
  ) {
    lines.push("    (no state fields in plan)");
  }

  const { stillValid, obsolete, renamed } = plan.traceTag;
  lines.push("  traces:");
  lines.push(`    stillValid: ${stillValid.length}`);
  lines.push(`    obsolete:   ${obsolete.length}`);
  lines.push(`    renamed:    ${renamed.length}`);

  return lines.join("\n");
}
