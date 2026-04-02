import type { Finding } from "../contracts/findings.js";

export function explainLineage(findings: Finding[]): string {
  if (findings.length === 0) {
    return "Lineage overlay has no findings.";
  }

  return findings.map((finding) => finding.message).join(" ");
}

