import type { Finding } from "../contracts/findings.js";
import type { FindingsReportProjection } from "../contracts/projections.js";

export function projectFindingsReport(findings: Finding[]): FindingsReportProjection {
  const bySeverity = {
    error: 0,
    warn: 0,
    info: 0
  };
  const byKind: Record<string, number> = {};

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
  }

  return {
    status: "ready",
    summary: {
      total: findings.length,
      bySeverity,
      byKind
    },
    findings
  };
}

