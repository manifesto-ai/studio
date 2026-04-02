import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn
} from "@manifesto-ai/ui-core";

export type ActionBenchField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum" | "json";
  required: boolean;
  options?: string[];
};

export type ActionBenchAction = {
  id: string;
  description?: string;
  fields: ActionBenchField[];
  available?: boolean;
  blockerCount?: number;
};

export type ActionBenchProps = {
  actions: ActionBenchAction[];
  selectedActionId: string;
  fieldValues: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  onSelectAction: (actionId: string) => void;
  onPreflight: () => void;
  onExecute: () => void;
  statusMessage?: string;
  pending?: boolean;
};

export function ActionBench({
  actions,
  selectedActionId,
  fieldValues,
  onFieldChange,
  onSelectAction,
  onPreflight,
  onExecute,
  statusMessage,
  pending
}: ActionBenchProps) {
  const selectedAction =
    actions.find((action) => action.id === selectedActionId) ?? actions[0] ?? null;
  const readyCount = actions.filter((action) => action.available).length;
  const blockedCount = actions.filter((action) => action.available === false).length;

  return (
    <Card className="h-full">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Run Console</CardTitle>
            <CardDescription>
              Select a live action, inspect the guard path, then execute it against the
              current runtime.
            </CardDescription>
          </div>
          <Badge variant="outline">{actions.length} actions</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-2xl border border-border/70 bg-background/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Available actions</p>
            <div className="flex gap-2">
              <Badge variant="success">{readyCount} ready</Badge>
              <Badge variant="warning">{blockedCount} blocked</Badge>
            </div>
          </div>
          <ScrollArea className="h-[240px] rounded-xl border border-border/70 bg-background/35">
            <div className="grid gap-2 p-3">
              {actions.map((action) => (
                <button
                  className={cn(
                    "rounded-xl border border-border/70 bg-background/40 p-3 text-left transition-colors hover:bg-background/60",
                    action.id === selectedActionId && "border-primary/80 bg-primary/8"
                  )}
                  key={action.id}
                  onClick={() => onSelectAction(action.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <p className="text-sm font-medium text-foreground">{action.id}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {action.description ?? "No description"}
                      </p>
                    </div>
                    <Badge
                      variant={
                        action.available === undefined
                          ? "outline"
                          : action.available
                            ? "success"
                            : "warning"
                      }
                    >
                      {action.available === undefined
                        ? "STATIC"
                        : action.available
                          ? "READY"
                          : `${action.blockerCount ?? 0} blocked`}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {selectedAction ? (
          <div className="grid gap-4 rounded-2xl border border-border/70 bg-background/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <p className="text-sm font-medium text-foreground">{selectedAction.id}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {selectedAction.description ?? "No description"}
                </p>
              </div>
              <Badge
                variant={
                  selectedAction.available === undefined
                    ? "outline"
                    : selectedAction.available
                      ? "success"
                      : "warning"
                }
              >
                {selectedAction.available === undefined
                  ? "Static"
                  : selectedAction.available
                    ? "Ready"
                    : "Blocked"}
              </Badge>
            </div>
            {selectedAction.fields.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-background/35 px-3 py-4 text-sm text-muted-foreground">
                This action takes no explicit input fields.
              </div>
            ) : (
              <div className="grid gap-3">
                {selectedAction.fields.map((field) => (
                  <div className="grid gap-2" key={field.key}>
                    <label className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                      {field.label}
                      {field.required ? " · required" : ""}
                    </label>
                    {field.type === "enum" ? (
                      <Select
                        onValueChange={(value) => onFieldChange(field.key, value)}
                        value={fieldValues[field.key] ?? ""}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select value" />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options ?? []).map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field.type === "boolean" ? (
                      <Select
                        onValueChange={(value) => onFieldChange(field.key, value)}
                        value={fieldValues[field.key] ?? ""}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select boolean" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : field.type === "json" ? (
                      <Textarea
                        onChange={(event) => onFieldChange(field.key, event.target.value)}
                        placeholder='{"key":"value"}'
                        value={fieldValues[field.key] ?? ""}
                      />
                    ) : (
                      <Input
                        onChange={(event) => onFieldChange(field.key, event.target.value)}
                        placeholder={field.type === "number" ? "0" : field.label}
                        type={field.type === "number" ? "number" : "text"}
                        value={fieldValues[field.key] ?? ""}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            {statusMessage ? (
              <div className="rounded-xl border border-border/70 bg-background/40 px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.22em] text-primary">
                  Guard summary
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {statusMessage}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={onPreflight} type="button" variant="outline">
                Preflight
              </Button>
              <Button onClick={onExecute} type="button">
                {pending ? "Running…" : "Execute Live"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
