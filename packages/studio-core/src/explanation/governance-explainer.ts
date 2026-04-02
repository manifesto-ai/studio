import type { Finding } from "../contracts/findings.js";

export function explainGovernance(findings: Finding[]): string {
  if (findings.length === 0) {
    return "Governance overlay has no findings.";
  }

  return findings.map((finding) => finding.message).join(" ");
}

