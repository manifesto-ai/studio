import type { ActionAvailabilityProjection } from "@manifesto-ai/studio-core";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn
} from "@manifesto-ai/ui-core";

export type ActionAvailabilityListProps = {
  availability: ActionAvailabilityProjection[];
  selectedActionId?: string;
  onSelectAction?: (actionId: string) => void;
};

export function ActionAvailabilityList({
  availability,
  selectedActionId,
  onSelectAction
}: ActionAvailabilityListProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Action Availability</CardTitle>
        <CardDescription>Runtime snapshot overlay from studio-core.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {availability.map((entry) => {
          const ready = entry.status === "ready";
          const available = ready ? Boolean(entry.available) : false;

          return (
            <button
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-3 text-left transition-colors hover:bg-background/60",
                selectedActionId === entry.actionId && "border-primary/70 bg-primary/8"
              )}
              key={entry.actionId}
              onClick={() => onSelectAction?.(entry.actionId)}
              type="button"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{entry.actionId}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ready
                    ? entry.blockers?.length
                      ? `${entry.blockers.length} blockers`
                      : "No blockers"
                    : entry.message ?? "Snapshot required"}
                </p>
              </div>
              <Badge variant={!ready ? "outline" : available ? "success" : "warning"}>
                {!ready ? "STATIC" : available ? "READY" : "BLOCKED"}
              </Badge>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
