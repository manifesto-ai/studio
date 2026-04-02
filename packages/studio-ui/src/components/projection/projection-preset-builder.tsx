import type { DomainSchema, ProjectionBucketRange, ProjectionPreset } from "@manifesto-ai/studio-core";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea
} from "@manifesto-ai/ui-core";

type SchemaFieldKind = "state" | "computed" | "action";

type SelectableEntry = {
  kind: SchemaFieldKind;
  key: string;
  label: string;
  typeLabel: string;
};

function describeType(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "enum" in value) {
    return "enum";
  }

  return "object";
}

function buildEntries(schema: DomainSchema): SelectableEntry[] {
  const stateEntries = Object.entries(schema.state.fields).map(([key, field]) => ({
    kind: "state" as const,
    key,
    label: key,
    typeLabel: describeType(field.type)
  }));
  const computedEntries = Object.keys(schema.computed.fields).map((key) => ({
    kind: "computed" as const,
    key,
    label: key,
    typeLabel: "computed"
  }));
  const actionEntries = Object.keys(schema.actions).map((key) => ({
    kind: "action" as const,
    key,
    label: key,
    typeLabel: "action"
  }));

  return [...stateEntries, ...computedEntries, ...actionEntries];
}

function isObserved(preset: ProjectionPreset, kind: SchemaFieldKind, key: string): boolean {
  return preset.observe.some((entry) => {
    if (entry.kind !== kind) {
      return false;
    }

    return "path" in entry ? entry.path === key : entry.id === key;
  });
}

function isGrouped(preset: ProjectionPreset, kind: SchemaFieldKind, key: string): boolean {
  return preset.groupBy.some((entry) => {
    if (kind === "action" || entry.source !== kind) {
      return false;
    }

    return "path" in entry ? entry.path === key : entry.id === key;
  });
}

function defaultTransform(typeLabel: string) {
  if (typeLabel === "boolean") {
    return { kind: "boolean" } as const;
  }

  if (typeLabel === "enum") {
    return { kind: "enum" } as const;
  }

  return { kind: "raw" } as const;
}

function bucketRangesToText(ranges: ProjectionBucketRange[]): string {
  return JSON.stringify(ranges, null, 2);
}

function parseBucketRanges(raw: string): ProjectionBucketRange[] {
  const parsed = JSON.parse(raw) as ProjectionBucketRange[];
  return Array.isArray(parsed) ? parsed : [];
}

export type ProjectionPresetBuilderProps = {
  schema: DomainSchema;
  preset: ProjectionPreset;
  onPresetChange: (preset: ProjectionPreset) => void;
};

export function ProjectionPresetBuilder({
  schema,
  preset,
  onPresetChange
}: ProjectionPresetBuilderProps) {
  const entries = buildEntries(schema);
  const grouped = {
    state: entries.filter((entry) => entry.kind === "state"),
    computed: entries.filter((entry) => entry.kind === "computed"),
    action: entries.filter((entry) => entry.kind === "action")
  };

  function toggleObserve(kind: SchemaFieldKind, key: string, typeLabel: string) {
    const willObserve = !isObserved(preset, kind, key);
    const nextObserve = willObserve
      ? [
          ...preset.observe,
          kind === "state"
            ? { kind, path: key, label: key }
            : { kind, id: key, label: key }
        ]
      : preset.observe.filter((entry) => {
          if (entry.kind !== kind) {
            return true;
          }

          return "path" in entry ? entry.path !== key : entry.id !== key;
        });

    let nextGroupBy = preset.groupBy;

    if (!willObserve && kind !== "action") {
      nextGroupBy = preset.groupBy.filter((entry) =>
        "path" in entry ? entry.path !== key : entry.id !== key
      );
    } else if (willObserve && kind !== "action" && !isGrouped(preset, kind, key)) {
      nextGroupBy = [
        ...preset.groupBy,
        kind === "state"
          ? { source: "state" as const, path: key, label: key, transform: defaultTransform(typeLabel) }
          : { source: "computed" as const, id: key, label: key, transform: defaultTransform(typeLabel) }
      ];
    }

    onPresetChange({
      ...preset,
      observe: nextObserve,
      groupBy: nextGroupBy
    });
  }

  function toggleGroup(kind: Exclude<SchemaFieldKind, "action">, key: string, typeLabel: string) {
    if (isGrouped(preset, kind, key)) {
      onPresetChange({
        ...preset,
        groupBy: preset.groupBy.filter((entry) => ("path" in entry ? entry.path !== key : entry.id !== key))
      });
      return;
    }

    onPresetChange({
      ...preset,
      observe: isObserved(preset, kind, key)
        ? preset.observe
        : [
            ...preset.observe,
            kind === "state"
              ? { kind, path: key, label: key }
              : { kind, id: key, label: key }
          ],
      groupBy: [
        ...preset.groupBy,
        kind === "state"
          ? { source: "state", path: key, label: key, transform: defaultTransform(typeLabel) }
          : { source: "computed", id: key, label: key, transform: defaultTransform(typeLabel) }
      ]
    });
  }

  function updateGroupTransform(key: string, kind: string) {
    onPresetChange({
      ...preset,
      groupBy: preset.groupBy.map((entry) => {
        const entryKey = "path" in entry ? entry.path : entry.id;
        if (entryKey !== key) {
          return entry;
        }

        if (kind === "bucket") {
          return {
            ...entry,
            transform: {
              kind: "bucket",
              ranges: [
                { label: "empty", max: 1 },
                { label: "low", min: 1, max: 10 },
                { label: "high", min: 10 }
              ]
            }
          };
        }

        return {
          ...entry,
          transform: { kind } as ProjectionPreset["groupBy"][number]["transform"]
        };
      })
    });
  }

  function updateBucketRanges(key: string, raw: string) {
    try {
      const ranges = parseBucketRanges(raw);
      onPresetChange({
        ...preset,
        groupBy: preset.groupBy.map((entry) => {
          const entryKey = "path" in entry ? entry.path : entry.id;
          if (entryKey !== key || entry.transform.kind !== "bucket") {
            return entry;
          }

          return {
            ...entry,
            transform: {
              kind: "bucket",
              ranges
            }
          };
        })
      });
    } catch {
      // Keep the current preset value until the JSON is valid.
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Observation Lens</CardTitle>
            <CardDescription>
              Define which MEL nodes shape the projected state signature.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">{preset.observe.length} observed</Badge>
            <Badge variant="secondary">{preset.groupBy.length} grouped</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 rounded-2xl border border-border/70 bg-background/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Lens name</p>
            <Badge>{preset.name}</Badge>
          </div>
          <Input
            onChange={(event) =>
              onPresetChange({
                ...preset,
                name: event.target.value
              })
            }
            value={preset.name}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Grouped fields become the visible axes of the projection graph. Observed-only
            fields stay available in the inspector without fragmenting the graph.
          </p>
        </div>

        <Tabs defaultValue="state">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="state">State</TabsTrigger>
            <TabsTrigger value="computed">Computed</TabsTrigger>
            <TabsTrigger value="action">Action</TabsTrigger>
          </TabsList>
          {(["state", "computed", "action"] as const).map((section) => (
            <TabsContent className="mt-4" key={section} value={section}>
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/30">
                <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium capitalize text-foreground">{section}</p>
                    <p className="text-xs text-muted-foreground">
                      {section === "action"
                        ? "Observe runnable actions in the current lens."
                        : "Promote important dimensions into grouped state signatures."}
                    </p>
                  </div>
                  <Badge variant="secondary">{grouped[section].length}</Badge>
                </div>
                <ScrollArea className="h-[320px]">
                  <div className="grid gap-2 p-3">
                    {grouped[section].map((entry) => {
                      const observed = isObserved(preset, entry.kind, entry.key);
                      const groupedEntry =
                        entry.kind === "action" ? false : isGrouped(preset, entry.kind, entry.key);

                      return (
                        <div
                          className="grid gap-3 rounded-xl border border-border/60 bg-background/40 p-3"
                          key={`${entry.kind}:${entry.key}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <label className="flex items-start gap-3 text-sm text-foreground">
                              <Checkbox
                                checked={observed}
                                onCheckedChange={() =>
                                  toggleObserve(entry.kind, entry.key, entry.typeLabel)
                                }
                              />
                              <span className="grid gap-1">
                                <span className="font-medium">{entry.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {entry.typeLabel}
                                </span>
                              </span>
                            </label>
                            {entry.kind !== "action" ? (
                              <Button
                                onClick={() =>
                                  toggleGroup(
                                    entry.kind as Exclude<SchemaFieldKind, "action">,
                                    entry.key,
                                    entry.typeLabel
                                  )
                                }
                                size="sm"
                                type="button"
                                variant={groupedEntry ? "secondary" : "ghost"}
                              >
                                {groupedEntry ? "Grouped" : "Group"}
                              </Button>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2 pl-7">
                            {observed ? <Badge variant="outline">Observed</Badge> : null}
                            {groupedEntry ? <Badge>Projection Axis</Badge> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <div className="grid gap-3 rounded-2xl border border-border/70 bg-background/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">Grouped dimensions</p>
              <p className="text-xs text-muted-foreground">
                These dimensions define each node signature in the projection graph.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={preset.options?.includeBlocked ?? true ? "warning" : "outline"}>
                blocked
              </Badge>
              <Badge variant="outline">live</Badge>
            </div>
          </div>
          {preset.groupBy.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add at least one state or computed field to group the transition graph.
            </p>
          ) : (
            <div className="grid gap-3">
              {preset.groupBy.map((entry) => {
                const key = "path" in entry ? entry.path : entry.id;
                return (
                  <div
                    className="grid gap-3 rounded-xl border border-border/70 bg-background/40 p-3"
                    key={`${entry.source}:${key}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{entry.label ?? key}</p>
                        <p className="text-xs text-muted-foreground">{entry.source}</p>
                      </div>
                      <Select
                        onValueChange={(value) => updateGroupTransform(key, value)}
                        value={entry.transform.kind}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="raw">raw</SelectItem>
                          <SelectItem value="boolean">boolean</SelectItem>
                          <SelectItem value="presence">presence</SelectItem>
                          <SelectItem value="enum">enum</SelectItem>
                          <SelectItem value="bucket">bucket</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {entry.transform.kind === "bucket" ? (
                      <Textarea
                        onChange={(event) => updateBucketRanges(key, event.target.value)}
                        placeholder='[{"label":"low","max":10},{"label":"high","min":10}]'
                        value={bucketRangesToText(entry.transform.ranges)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
