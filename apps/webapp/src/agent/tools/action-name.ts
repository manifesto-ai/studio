/**
 * Agent-facing tools should accept both domain action names
 * (`restoreTask`) and graph node ids (`action:restoreTask`). The UI
 * naturally talks in node ids, while Manifesto runtimes expect bare
 * action names.
 */
export function normalizeActionName(input: string): string {
  const trimmed = input.trim();
  const prefix = "action:";
  return trimmed.startsWith(prefix)
    ? trimmed.slice(prefix.length).trim()
    : trimmed;
}
