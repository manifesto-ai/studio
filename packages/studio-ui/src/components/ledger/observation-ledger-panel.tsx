import type { ObservationRecord } from "@manifesto-ai/studio-core";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ScrollArea,
  cn
} from "@manifesto-ai/ui-core";

function outcomeVariant(record: ObservationRecord) {
  if (record.outcome === "committed") {
    return record.mode === "live" ? "success" : "default";
  }

  return record.outcome === "blocked" ? "warning" : "destructive";
}

function formatArgs(record: ObservationRecord): string {
  if (record.args.length === 0) {
    return "()";
  }

  return `(${record.args.map((value) => JSON.stringify(value)).join(", ")})`;
}

export type ObservationLedgerPanelProps = {
  records: ObservationRecord[];
  selectedRecordId?: string;
  onSelectRecord?: (recordId: string) => void;
};

export function ObservationLedgerPanel({
  records,
  selectedRecordId,
  onSelectRecord
}: ObservationLedgerPanelProps) {
  const ordered = [...records].sort((left, right) => right.timestamp - left.timestamp);
  const summary = {
    live: records.filter((record) => record.mode === "live").length,
    blocked: records.filter((record) => record.outcome === "blocked").length,
    failed: records.filter((record) => record.outcome === "failed").length
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Observation Ledger</CardTitle>
            <CardDescription>
              Every executed action in this session, ordered as an operational timeline.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{summary.live} live</Badge>
            <Badge variant="warning">{summary.blocked} blocked</Badge>
            <Badge variant="destructive">{summary.failed} failed</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[260px] rounded-2xl border border-border/70 bg-background/30">
          <div className="grid gap-2 p-3">
            {ordered.length === 0 ? (
              <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                No observations yet. Execute a live action to start shaping the graph.
              </p>
            ) : (
              ordered.map((record, index) => (
                <button
                  className={cn(
                    "rounded-xl border border-border/70 bg-background/40 p-3 text-left transition-colors hover:bg-background/60",
                    selectedRecordId === record.id && "border-primary/70 bg-primary/8"
                  )}
                  key={record.id}
                  onClick={() => onSelectRecord?.(record.id)}
                  type="button"
                >
                  <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background/60 text-xs font-medium text-muted-foreground">
                      {String(ordered.length - index).padStart(2, "0")}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {record.actionId}
                        {formatArgs(record)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(record.timestamp).toLocaleTimeString()} · snapshot v
                        {record.beforeSnapshot.meta.version}
                        {record.afterSnapshot ? ` → v${record.afterSnapshot.meta.version}` : ""}
                      </p>
                    </div>
                    <Badge variant={outcomeVariant(record)}>
                      {record.outcome.toUpperCase()}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
