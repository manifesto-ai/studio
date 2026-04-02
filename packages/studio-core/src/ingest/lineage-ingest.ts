import type {
  BranchSummary,
  LineageExport,
  LineageInput,
  SealAttemptSummary,
  WorldSummary
} from "../contracts/inputs.js";

import {
  createIssue,
  type IngestResult,
  type IngestValidationIssue,
  isPlainObject,
  isTupleEntries
} from "./issues.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  return value === null ? null : asString(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cloneWorlds(worlds: Map<string, WorldSummary>): Map<string, WorldSummary> {
  return new Map(
    [...worlds.entries()].map(([key, value]) => [key, { ...value }])
  );
}

function cloneAttempts(
  attempts: Map<string, SealAttemptSummary[]>
): Map<string, SealAttemptSummary[]> {
  return new Map(
    [...attempts.entries()].map(([key, value]) => [
      key,
      value.map((entry) => ({ ...entry }))
    ])
  );
}

function isLineageExport(value: LineageExport | LineageInput): value is LineageExport {
  return value.worlds instanceof Map && value.attempts instanceof Map;
}

function normalizeBranch(
  branch: unknown,
  issues: IngestValidationIssue[],
  index: number
): BranchSummary | undefined {
  if (!isPlainObject(branch)) {
    issues.push(
      createIssue(
        "lineage",
        "invalid-branch",
        "Branch entries must be objects.",
        `lineage.branches[${index}]`
      )
    );
    return undefined;
  }

  const id = asString(branch.id);
  const headWorldId = asNullableString(branch.headWorldId);
  const tipWorldId = asNullableString(branch.tipWorldId);
  const epoch = asNumber(branch.epoch);
  const headAdvancedAt =
    branch.headAdvancedAt === null ? null : asNumber(branch.headAdvancedAt);

  if (!id || headWorldId === undefined || tipWorldId === undefined || epoch === undefined || headAdvancedAt === undefined) {
    issues.push(
      createIssue(
        "lineage",
        "invalid-branch",
        "Branch summary is missing required fields.",
        `lineage.branches[${index}]`
      )
    );
    return undefined;
  }

  return {
    id,
    headWorldId,
    tipWorldId,
    epoch,
    headAdvancedAt
  };
}

function normalizeWorld(
  world: unknown,
  issues: IngestValidationIssue[],
  path: string,
  fallbackWorldId?: string
): WorldSummary | undefined {
  if (!isPlainObject(world)) {
    issues.push(
      createIssue(
        "lineage",
        "invalid-world",
        "World entries must be objects.",
        path
      )
    );
    return undefined;
  }

  const worldId = asString(world.worldId) ?? fallbackWorldId;
  const parentWorldId = asNullableString(world.parentWorldId);
  const schemaHash = asString(world.schemaHash);
  const snapshotHash = asString(world.snapshotHash);
  const createdAt = asNumber(world.createdAt);
  const terminalStatus =
    world.terminalStatus === "completed" || world.terminalStatus === "failed"
      ? world.terminalStatus
      : undefined;

  if (!worldId || parentWorldId === undefined || !schemaHash || !snapshotHash || !terminalStatus || createdAt === undefined) {
    issues.push(
      createIssue(
        "lineage",
        "invalid-world",
        "World summary is missing required fields.",
        path
      )
    );
    return undefined;
  }

  return {
    worldId,
    parentWorldId,
    schemaHash,
    snapshotHash,
    terminalStatus,
    createdAt
  };
}

function normalizeAttempt(
  attempt: unknown,
  issues: IngestValidationIssue[],
  path: string,
  fallbackWorldId?: string
): SealAttemptSummary | undefined {
  if (!isPlainObject(attempt)) {
    issues.push(
      createIssue(
        "lineage",
        "invalid-attempt",
        "Seal attempts must be objects.",
        path
      )
    );
    return undefined;
  }

  const worldId = asString(attempt.worldId) ?? fallbackWorldId;
  const branchId = asString(attempt.branchId);
  const reused = typeof attempt.reused === "boolean" ? attempt.reused : undefined;
  const createdAt = asNumber(attempt.createdAt);

  if (!worldId || !branchId || reused === undefined || createdAt === undefined) {
    issues.push(
      createIssue(
        "lineage",
        "invalid-attempt",
        "Seal attempt summary is missing required fields.",
        path
      )
    );
    return undefined;
  }

  return {
    worldId,
    branchId,
    reused,
    createdAt
  };
}

function normalizeWorlds(
  worlds: LineageInput["worlds"],
  issues: IngestValidationIssue[]
): Map<string, WorldSummary> {
  const normalized = new Map<string, WorldSummary>();

  if (worlds instanceof Map) {
    for (const [key, value] of worlds.entries()) {
      const world = normalizeWorld(value, issues, `lineage.worlds.${key}`, key);
      if (world) {
        normalized.set(world.worldId, world);
      }
    }
    return normalized;
  }

  if (Array.isArray(worlds) && !isTupleEntries<WorldSummary>(worlds)) {
    const worldEntries = worlds as ReadonlyArray<WorldSummary>;
    worldEntries.forEach((value, index) => {
      const world = normalizeWorld(value, issues, `lineage.worlds[${index}]`);
      if (world) {
        normalized.set(world.worldId, world);
      }
    });
    return normalized;
  }

  if (isTupleEntries<WorldSummary>(worlds)) {
    worlds.forEach(([key, value], index) => {
      const world = normalizeWorld(value, issues, `lineage.worlds[${index}]`, key);
      if (world) {
        normalized.set(world.worldId, world);
      }
    });
    return normalized;
  }

  if (isPlainObject(worlds)) {
    for (const [key, value] of Object.entries(worlds)) {
      const world = normalizeWorld(value, issues, `lineage.worlds.${key}`, key);
      if (world) {
        normalized.set(world.worldId, world);
      }
    }
    return normalized;
  }

  issues.push(
    createIssue(
      "lineage",
      "invalid-worlds",
      "lineage.worlds must be a Map, record, tuple entries, or array of world summaries.",
      "lineage.worlds"
    )
  );
  return normalized;
}

function normalizeAttempts(
  attempts: LineageInput["attempts"],
  issues: IngestValidationIssue[]
): Map<string, SealAttemptSummary[]> {
  const normalized = new Map<string, SealAttemptSummary[]>();

  const pushAttempt = (worldId: string, attempt: SealAttemptSummary): void => {
    const current = normalized.get(worldId) ?? [];
    current.push(attempt);
    normalized.set(worldId, current);
  };

  if (attempts instanceof Map) {
    for (const [key, value] of attempts.entries()) {
      const list = Array.isArray(value) ? value : [value];
      list.forEach((entry, index) => {
        const attempt = normalizeAttempt(
          entry,
          issues,
          `lineage.attempts.${key}[${index}]`,
          key
        );
        if (attempt) {
          pushAttempt(attempt.worldId, attempt);
        }
      });
    }
    return normalized;
  }

  if (Array.isArray(attempts) && !isTupleEntries<SealAttemptSummary | SealAttemptSummary[]>(attempts)) {
    const attemptEntries = attempts as ReadonlyArray<SealAttemptSummary>;
    attemptEntries.forEach((entry, index) => {
      const attempt = normalizeAttempt(entry, issues, `lineage.attempts[${index}]`);
      if (attempt) {
        pushAttempt(attempt.worldId, attempt);
      }
    });
    return normalized;
  }

  if (isTupleEntries<SealAttemptSummary | SealAttemptSummary[]>(attempts)) {
    attempts.forEach(([key, value], index) => {
      const list = Array.isArray(value) ? value : [value];
      list.forEach((entry, childIndex) => {
        const attempt = normalizeAttempt(
          entry,
          issues,
          `lineage.attempts[${index}][${childIndex}]`,
          key
        );
        if (attempt) {
          pushAttempt(attempt.worldId, attempt);
        }
      });
    });
    return normalized;
  }

  if (isPlainObject(attempts)) {
    for (const [key, value] of Object.entries(attempts)) {
      const list = Array.isArray(value) ? value : [value];
      list.forEach((entry, index) => {
        const attempt = normalizeAttempt(
          entry,
          issues,
          `lineage.attempts.${key}[${index}]`,
          key
        );
        if (attempt) {
          pushAttempt(attempt.worldId, attempt);
        }
      });
    }
    return normalized;
  }

  issues.push(
    createIssue(
      "lineage",
      "invalid-attempts",
      "lineage.attempts must be a Map, record, tuple entries, or array of attempts.",
      "lineage.attempts"
    )
  );
  return normalized;
}

export function ingestLineage(
  lineage: LineageExport | LineageInput
): IngestResult<LineageExport> {
  if (isLineageExport(lineage)) {
    return {
      value: {
        activeBranchId: lineage.activeBranchId,
        branches: lineage.branches.map((branch) => ({ ...branch })),
        worlds: cloneWorlds(lineage.worlds),
        attempts: cloneAttempts(lineage.attempts)
      },
      issues: []
    };
  }

  const issues: IngestValidationIssue[] = [];
  const activeBranchId = asString(lineage.activeBranchId);
  if (!activeBranchId) {
    issues.push(
      createIssue(
        "lineage",
        "invalid-active-branch",
        "lineage.activeBranchId must be a string.",
        "lineage.activeBranchId"
      )
    );
  }

  const branches = Array.isArray(lineage.branches)
    ? lineage.branches
        .map((branch, index) => normalizeBranch(branch, issues, index))
        .filter((branch): branch is BranchSummary => Boolean(branch))
    : [];
  if (!Array.isArray(lineage.branches)) {
    issues.push(
      createIssue(
        "lineage",
        "invalid-branches",
        "lineage.branches must be an array.",
        "lineage.branches"
      )
    );
  }

  const worlds = normalizeWorlds(lineage.worlds, issues);
  const attempts = normalizeAttempts(lineage.attempts, issues);

  if (!activeBranchId || !Array.isArray(lineage.branches)) {
    return { issues };
  }

  return {
    value: {
      activeBranchId,
      branches,
      worlds,
      attempts
    },
    issues
  };
}
