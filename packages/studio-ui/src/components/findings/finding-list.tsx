import type { FindingsReportProjection } from "@manifesto-ai/studio-core";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn
} from "@manifesto-ai/ui-core";

function severityVariant(severity: "error" | "warn" | "info") {
  switch (severity) {
    case "error":
      return "destructive";
    case "warn":
      return "warning";
    default:
      return "secondary";
  }
}

export type FindingListProps = {
  report: FindingsReportProjection;
  selectedFindingId?: string;
  onSelectFinding?: (findingId: string) => void;
};

export function FindingList({
  report,
  selectedFindingId,
  onSelectFinding
}: FindingListProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Findings</CardTitle>
        <CardDescription>
          {report.summary.bySeverity.error} errors, {report.summary.bySeverity.warn} warnings,{" "}
          {report.summary.bySeverity.info} info
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {report.findings.map((finding) => (
          <button
            className={cn(
              "grid gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-3 text-left transition-colors hover:bg-background/60",
              selectedFindingId === finding.id && "border-primary/70 bg-primary/8"
            )}
            key={finding.id}
            onClick={() => onSelectFinding?.(finding.id)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <Badge variant={severityVariant(finding.severity)}>
                {finding.severity.toUpperCase()}
              </Badge>
              <span className="text-xs text-muted-foreground">{finding.kind}</span>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{finding.subject.nodeId}</p>
              <p className="mt-1 text-sm text-muted-foreground">{finding.message}</p>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
