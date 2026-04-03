import type { Snapshot } from "../contracts/inputs.js";

import {
  createIssue,
  formatIssues,
  type IngestResult,
  type IngestValidationIssue,
  isPlainObject
} from "./issues.js";

const CANONICAL_SNAPSHOT_MESSAGE =
  "studio-core expects a canonical snapshot from Manifesto runtime.getCanonicalSnapshot().";

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    meta: { ...snapshot.meta },
    data: { ...snapshot.data },
    system: {
      ...snapshot.system,
      pendingRequirements: [...snapshot.system.pendingRequirements]
    },
    computed: { ...snapshot.computed }
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateSnapshot(snapshot: unknown): IngestValidationIssue[] {
  const issues: IngestValidationIssue[] = [];

  if (!isPlainObject(snapshot)) {
    return [
      createIssue(
        "snapshot",
        "invalid-snapshot",
        `Snapshot overlay must be an object. ${CANONICAL_SNAPSHOT_MESSAGE}`,
        "snapshot"
      )
    ];
  }

  if (!isPlainObject(snapshot.meta)) {
    issues.push(
      createIssue(
        "snapshot",
        "invalid-meta",
        `snapshot.meta must be an object. ${CANONICAL_SNAPSHOT_MESSAGE}`,
        "snapshot.meta"
      )
    );
  } else {
    if (!isFiniteNumber(snapshot.meta.version)) {
      issues.push(
        createIssue(
          "snapshot",
          "invalid-version",
          "snapshot.meta.version must be a finite number.",
          "snapshot.meta.version"
        )
      );
    }

    if (!isFiniteNumber(snapshot.meta.timestamp)) {
      issues.push(
        createIssue(
          "snapshot",
          "invalid-timestamp",
          "snapshot.meta.timestamp must be a finite number.",
          "snapshot.meta.timestamp"
        )
      );
    }

    if (typeof snapshot.meta.randomSeed !== "string") {
      issues.push(
        createIssue(
          "snapshot",
          "invalid-random-seed",
          "snapshot.meta.randomSeed must be a string.",
          "snapshot.meta.randomSeed"
        )
      );
    }

    if (typeof snapshot.meta.schemaHash !== "string") {
      issues.push(
        createIssue(
          "snapshot",
          "invalid-schema-hash",
          "snapshot.meta.schemaHash must be a string.",
          "snapshot.meta.schemaHash"
        )
      );
    }
  }

  if (!isPlainObject(snapshot.data)) {
    issues.push(
      createIssue(
        "snapshot",
        "invalid-data",
        "snapshot.data must be an object.",
        "snapshot.data"
      )
    );
  }

  if (!isPlainObject(snapshot.computed)) {
    issues.push(
      createIssue(
        "snapshot",
        "invalid-computed",
        "snapshot.computed must be an object.",
        "snapshot.computed"
      )
    );
  }

  if (!isPlainObject(snapshot.system)) {
    issues.push(
      createIssue(
        "snapshot",
        "invalid-system",
        "snapshot.system must be an object.",
        "snapshot.system"
      )
    );
  } else {
    if (
      snapshot.system.status !== "idle" &&
      snapshot.system.status !== "computing" &&
      snapshot.system.status !== "pending" &&
      snapshot.system.status !== "error"
    ) {
      issues.push(
        createIssue(
          "snapshot",
          "invalid-status",
          "snapshot.system.status must be one of idle, computing, pending, or error.",
          "snapshot.system.status"
        )
      );
    }

    if (
      snapshot.system.lastError !== null &&
      !isPlainObject(snapshot.system.lastError)
    ) {
      issues.push(
        createIssue(
          "snapshot",
          "invalid-last-error",
          "snapshot.system.lastError must be null or an error value object.",
          "snapshot.system.lastError"
        )
      );
    }

    if (!Array.isArray(snapshot.system.pendingRequirements)) {
      issues.push(
        createIssue(
          "snapshot",
          "invalid-pending-requirements",
          "snapshot.system.pendingRequirements must be an array.",
          "snapshot.system.pendingRequirements"
        )
      );
    }

    if (
      snapshot.system.currentAction !== null &&
      typeof snapshot.system.currentAction !== "string"
    ) {
      issues.push(
        createIssue(
          "snapshot",
          "invalid-current-action",
          "snapshot.system.currentAction must be a string or null.",
          "snapshot.system.currentAction"
        )
      );
    }
  }

  if (!("input" in snapshot)) {
    issues.push(
      createIssue(
        "snapshot",
        "missing-input",
        "snapshot.input must be present on canonical snapshots.",
        "snapshot.input"
      )
    );
  }

  return issues;
}

export function createInvalidSnapshotOverlayError(
  issues: IngestValidationIssue[]
): Error {
  const message = `Invalid snapshot overlay. ${CANONICAL_SNAPSHOT_MESSAGE}`;
  return issues.length > 0 ? new Error(`${message}\n${formatIssues(issues)}`) : new Error(message);
}

export function ingestSnapshot(snapshot: Snapshot): IngestResult<Snapshot> {
  const issues = validateSnapshot(snapshot);

  if (issues.length > 0) {
    return { issues };
  }

  return {
    value: cloneSnapshot(snapshot),
    issues
  };
}
