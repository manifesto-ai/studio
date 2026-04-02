import {
  Badge,
  Button,
  Checkbox,
  Tabs,
  TabsList,
  TabsTrigger
} from "@manifesto-ai/ui-core";

import {
  useStudioState,
  useStudioDispatch,
  type StudioMode
} from "../../context/studio-context.js";
import { useStudioActions } from "../../hooks/use-studio.js";

export function Masthead() {
  const state = useStudioState();
  const dispatch = useStudioDispatch();
  const actions = useStudioActions();

  const activeDraftIsDirty =
    state.compiledSource !== "" && state.compiledSource !== state.source;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between rounded-2xl border border-border/70 bg-card/88 px-4 shadow-[0_18px_56px_rgba(0,0,0,0.22)] backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        {state.compileStatus === "ready" ? (
          <Badge variant="success">ready</Badge>
        ) : null}
        {state.compileStatus === "compiling" ? (
          <Badge variant="secondary">compiling</Badge>
        ) : null}
        {state.compileStatus === "error" ? (
          <Badge variant="destructive">error</Badge>
        ) : null}
        {activeDraftIsDirty ? <Badge variant="warning">changed</Badge> : null}
        <span className="truncate text-xs text-muted-foreground">
          {state.compileMessage}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Tabs
          value={state.mode}
          onValueChange={(value) =>
            dispatch({ type: "SET_MODE", mode: value as StudioMode })
          }
        >
          <TabsList>
            <TabsTrigger value="author">Author</TabsTrigger>
            <TabsTrigger value="observe">Observe</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="h-5 w-px bg-border/70" />

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={state.autoCompile}
            onCheckedChange={(checked) =>
              dispatch({ type: "SET_AUTO_COMPILE", enabled: Boolean(checked) })
            }
          />
          auto
        </label>
        <Button
          onClick={() => actions.compile(state.source, "manual")}
          size="sm"
          type="button"
        >
          compile
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
    </header>
  );
}
