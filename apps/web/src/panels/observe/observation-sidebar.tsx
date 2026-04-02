import { useMemo, useState } from "react";
import type { ActionBenchAction } from "@manifesto-ai/studio-ui";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
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
  Textarea,
  cn
} from "@manifesto-ai/ui-core";

import {
  useStudioState,
  useStudioDispatch
} from "../../context/studio-context.js";
import {
  useStudioActions,
  useActionSpecs,
  useBlocker
} from "../../hooks/use-studio.js";
import {
  buildInitialFieldValues,
  parseActionArgs,
  type ActionSpec,
  type ActionInputField
} from "../../authoring.js";

export function ObservationSidebar() {
  const state = useStudioState();
  const [sidebarTab, setSidebarTab] = useState("actions");

  if (!state.activeSchema) {
    return (
      <Card className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Compile a valid MEL draft first.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="pb-2">
        <Tabs onValueChange={setSidebarTab} value={sidebarTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="actions">Actions</TabsTrigger>
            <TabsTrigger value="lens">Lens</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pb-3">
        {sidebarTab === "actions" ? <ActionsPanel /> : <LensPanel />}
      </CardContent>
    </Card>
  );
}

function ActionsPanel() {
  const state = useStudioState();
  const dispatch = useStudioDispatch();
  const actions = useStudioActions();
  const actionSpecs = useActionSpecs();
  const blocker = useBlocker(state.selectedActionId);

  const selectedAction = useMemo(
    () =>
      actionSpecs.find((a) => a.id === state.selectedActionId) ??
      actionSpecs[0] ??
      null,
    [actionSpecs, state.selectedActionId]
  );

  async function handleExecute() {
    if (!selectedAction) return;
    let args: unknown[];
    try {
      args = parseActionArgs(selectedAction, state.fieldValues);
    } catch (error) {
      dispatch({
        type: "SET_RUNTIME_MESSAGE",
        message: error instanceof Error ? error.message : "Invalid action input."
      });
      return;
    }
    await actions.execute(selectedAction.id, args);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Action list */}
      <ScrollArea className="max-h-[200px] shrink-0 rounded-xl border border-border/70 bg-background/20">
        <div className="grid gap-1 p-2">
          {actionSpecs.map((action) => (
            <button
              className={cn(
                "rounded-lg px-3 py-2 text-left transition-colors",
                state.selectedActionId === action.id
                  ? "bg-primary/12 text-foreground"
                  : "text-muted-foreground hover:bg-background/40 hover:text-foreground"
              )}
              key={action.id}
              onClick={() => {
                dispatch({ type: "SELECT_ACTION", actionId: action.id });
                const spec = actionSpecs.find((a) => a.id === action.id) ?? null;
                dispatch({
                  type: "SET_FIELD_VALUES",
                  values: buildInitialFieldValues(spec)
                });
              }}
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{action.id}</span>
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
                    ? "static"
                    : action.available
                      ? "ready"
                      : "blocked"}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Selected action form */}
      {selectedAction ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {selectedAction.id}
            </p>
            <Badge
              variant={selectedAction.available ? "success" : "warning"}
            >
              {selectedAction.available ? "ready" : "blocked"}
            </Badge>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-3 pr-1">
              {selectedAction.fields.length > 0 ? (
                selectedAction.fields.map((field) => (
                  <ActionFieldInput
                    key={field.key}
                    field={field}
                    value={state.fieldValues[field.key] ?? ""}
                    onChange={(value) =>
                      dispatch({ type: "SET_FIELD_VALUE", key: field.key, value })
                    }
                  />
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No input fields</p>
              )}
            </div>
          </ScrollArea>

          <div className="shrink-0 border-t border-border/70 pt-2">
            <p className="mb-2 text-xs text-muted-foreground">
              {state.runtimeMessage !== "Compile a MEL draft to start a runtime sandbox." &&
               state.runtimeMessage !== "Runtime reset to the compiled draft."
                ? state.runtimeMessage
                : blocker.summary}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={!selectedAction || state.runtimePending}
                onClick={handleExecute}
                size="sm"
                type="button"
              >
                {state.runtimePending ? "running..." : "Execute"}
              </Button>
              <Button
                onClick={() => actions.resetRuntime()}
                size="sm"
                type="button"
                variant="outline"
              >
                reset
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LensPanel() {
  const state = useStudioState();
  const dispatch = useStudioDispatch();
  const preset = state.projectionPreset;

  if (!state.activeSchema) return null;

  const stateFields = Object.entries(state.activeSchema.state.fields);
  const computedFields = Object.keys(state.activeSchema.computed.fields);
  const actionIds = Object.keys(state.activeSchema.actions);

  function isObserved(kind: string, key: string): boolean {
    return preset.observe.some((e) => {
      if (e.kind !== kind) return false;
      return "path" in e ? e.path === key : e.id === key;
    });
  }

  function isGrouped(kind: string, key: string): boolean {
    return preset.groupBy.some((e) => {
      if (e.source !== kind) return false;
      return "path" in e ? e.path === key : e.id === key;
    });
  }

  function toggleObserve(kind: "state" | "computed" | "action", key: string) {
    const willObserve = !isObserved(kind, key);
    const nextObserve = willObserve
      ? [
          ...preset.observe,
          kind === "state"
            ? { kind, path: key, label: key }
            : { kind, id: key, label: key }
        ]
      : preset.observe.filter((e) => {
          if (e.kind !== kind) return true;
          return "path" in e ? e.path !== key : e.id !== key;
        });

    let nextGroupBy = preset.groupBy;
    if (!willObserve && kind !== "action") {
      nextGroupBy = preset.groupBy.filter((e) =>
        "path" in e ? e.path !== key : e.id !== key
      );
    } else if (willObserve && kind !== "action" && !isGrouped(kind, key)) {
      const fieldType =
        kind === "state"
          ? typeof (state.activeSchema!.state.fields as any)[key]?.type === "string"
            ? (state.activeSchema!.state.fields as any)[key].type
            : "raw"
          : "boolean";
      const transform =
        fieldType === "boolean"
          ? ({ kind: "boolean" } as const)
          : ({ kind: "raw" } as const);
      nextGroupBy = [
        ...preset.groupBy,
        kind === "state"
          ? { source: "state" as const, path: key, label: key, transform }
          : { source: "computed" as const, id: key, label: key, transform }
      ];
    }

    dispatch({
      type: "SET_PROJECTION_PRESET",
      preset: { ...preset, observe: nextObserve, groupBy: nextGroupBy }
    });
  }

  return (
    <ScrollArea className="h-full">
      <div className="grid gap-4 pr-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {preset.observe.length} observed · {preset.groupBy.length} grouped
          </span>
        </div>

        <section>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            State
          </p>
          <div className="grid gap-1">
            {stateFields.map(([key]) => (
              <LensToggle
                key={key}
                label={key}
                observed={isObserved("state", key)}
                grouped={isGrouped("state", key)}
                onToggle={() => toggleObserve("state", key)}
              />
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Computed
          </p>
          <div className="grid gap-1">
            {computedFields.map((key) => (
              <LensToggle
                key={key}
                label={key}
                observed={isObserved("computed", key)}
                grouped={isGrouped("computed", key)}
                onToggle={() => toggleObserve("computed", key)}
              />
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Actions
          </p>
          <div className="grid gap-1">
            {actionIds.map((key) => (
              <LensToggle
                key={key}
                label={key}
                observed={isObserved("action", key)}
                onToggle={() => toggleObserve("action", key)}
              />
            ))}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}

function LensToggle({
  label,
  observed,
  grouped,
  onToggle
}: {
  label: string;
  observed: boolean;
  grouped?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
        observed
          ? "bg-primary/8 text-foreground"
          : "text-muted-foreground hover:bg-background/40"
      )}
      onClick={onToggle}
      type="button"
    >
      <span className="truncate">{label}</span>
      <div className="flex gap-1.5">
        {observed ? (
          <span className="text-[10px] uppercase tracking-wider text-primary">on</span>
        ) : null}
        {grouped ? (
          <span className="text-[10px] uppercase tracking-wider text-accent-foreground">
            axis
          </span>
        ) : null}
      </div>
    </button>
  );
}

function ActionFieldInput({
  field,
  value,
  onChange
}: {
  field: ActionInputField;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {field.label}
      </label>
      {field.type === "enum" ? (
        <Select onValueChange={onChange} value={value}>
          <SelectTrigger>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "boolean" ? (
        <Select onValueChange={onChange} value={value}>
          <SelectTrigger>
            <SelectValue placeholder="Boolean" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      ) : field.type === "json" ? (
        <Textarea
          className="min-h-[80px] font-mono text-xs"
          onChange={(e) => onChange(e.target.value)}
          placeholder='{"key":"value"}'
          value={value}
        />
      ) : (
        <Input
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.type === "number" ? "0" : field.label}
          type={field.type === "number" ? "number" : "text"}
          value={value}
        />
      )}
    </div>
  );
}
