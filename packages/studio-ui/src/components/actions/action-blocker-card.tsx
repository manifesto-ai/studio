import type { ActionBlockerProjection } from "@manifesto-ai/studio-core";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@manifesto-ai/ui-core";

export type ActionBlockerCardProps = {
  projection: ActionBlockerProjection;
};

export function ActionBlockerCard({ projection }: ActionBlockerCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action Inspector</CardTitle>
        <CardDescription>
          {projection.actionId} · {projection.status}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center gap-2">
          {projection.status === "ready" ? (
            <>
              <Badge variant={projection.available ? "success" : "warning"}>
                {projection.available ? "AVAILABLE" : "BLOCKED"}
              </Badge>
              <Badge variant="outline">{projection.blockerSource}</Badge>
            </>
          ) : (
            <Badge variant="outline">{projection.status.toUpperCase()}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{projection.summary}</p>
        {projection.status === "ready" && projection.blockers.length > 0 ? (
          <div className="grid gap-2">
            {projection.blockers.map((blocker) => (
              <div
                className="rounded-lg border border-border/70 bg-background/40 px-3 py-2"
                key={`${blocker.ref.nodeId}:${blocker.subExpression}`}
              >
                <p className="text-sm font-medium text-foreground">
                  {blocker.evaluated ? "Satisfied" : "Unsatisfied"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {blocker.subExpression}
                </p>
              </div>
            ))}
          </div>
        ) : null}
        {projection.status === "ready" && projection.explanation ? (
          <div className="grid gap-2">
            <p className="text-xs uppercase tracking-[0.24em] text-primary">
              Cause chain
            </p>
            <ol className="grid gap-2">
              {projection.explanation.path.map((node, index) => (
                <li
                  className="rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-sm text-muted-foreground"
                  key={`${node.fact}:${index}`}
                >
                  <span className="font-medium text-foreground">{node.provenance}</span>{" "}
                  {node.fact}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
