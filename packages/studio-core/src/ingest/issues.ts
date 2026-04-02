export type IngestOverlayKind = "snapshot" | "trace" | "lineage" | "governance";

export type IngestValidationIssue = {
  overlay: IngestOverlayKind;
  code: string;
  message: string;
  path?: string;
};

export type IngestResult<T> = {
  value?: T;
  issues: IngestValidationIssue[];
};

export function createIssue(
  overlay: IngestOverlayKind,
  code: string,
  message: string,
  path?: string
): IngestValidationIssue {
  return {
    overlay,
    code,
    message,
    path
  };
}

export function formatIssues(issues: IngestValidationIssue[]): string {
  return issues
    .map((issue) =>
      issue.path
        ? `[${issue.overlay}] ${issue.code} at ${issue.path}: ${issue.message}`
        : `[${issue.overlay}] ${issue.code}: ${issue.message}`
    )
    .join("\n");
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTupleEntries<T>(
  value: unknown
): value is ReadonlyArray<readonly [string, T]> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string"
    )
  );
}
