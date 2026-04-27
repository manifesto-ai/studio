import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as monaco from "monaco-editor";
import {
  createStudioCore,
  type EditorAdapter,
  type Marker,
} from "@manifesto-ai/studio-core";
import {
  createMonacoAdapter,
  MEL_LANGUAGE_ID,
  registerMelLanguage,
} from "@manifesto-ai/studio-adapter-monaco";
import {
  StudioHotkeys,
  StudioProvider,
  useStudio,
} from "@manifesto-ai/studio-react";
import { Analytics } from "@vercel/analytics/react";
import { StudioUiProvider, useStudioUi } from "@/domain/StudioUiRuntime";

import { TopBar } from "@/components/chrome/TopBar";
import { NowLine } from "@/components/chrome/NowLine";
import { PaneDivider } from "@/components/chrome/PaneDivider";
import { SnapshotRipple } from "@/components/motion/SnapshotRipple";
import { TimeScrubProvider } from "@/hooks/useTimeScrub";
import { FocusSync } from "@/hooks/useFocusSync";
import { ViewportProvider } from "@/hooks/useViewport";
import {
  ProjectsProvider,
  useAutosave,
  useProjects,
} from "@/hooks/useProjects";
import { SourcePane } from "@/components/panes/SourcePane";
import { ObservatoryPane } from "@/components/panes/ObservatoryPane";
import { LensPane } from "@/components/panes/LensPane";
import { PANE_LIMITS, usePaneSizes } from "@/hooks/usePaneSizes";

/**
 * Deterministic Observatory — App shell.
 *
 * Layout (top → bottom):
 *   TopBar          (brand, project switcher, determinism status)
 *   Main 3-pane     (Source | Observatory | Lens) — glass panels on aurora
 *   NowLine         (snapshot beam — Manifesto's temporal dimension)
 *
 * The Monaco host div is mounted exactly once (via `SourcePane`'s
 * forwarded ref) and never re-parented; remounting detaches Monaco's
 * internal DOM and blanks the editor.
 */
export function App(): JSX.Element {
  return (
    <ProjectsProvider>
      <AppShell />
      {/* Vercel Analytics — ships a tiny <script> that batches
        * page / route telemetry. Respects the user's Do-Not-Track.
        * No-op in non-Vercel environments. */}
      <Analytics />
    </ProjectsProvider>
  );
}

function AppShell(): JSX.Element {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const core = useMemo(() => createStudioCore(), []);
  const [adapter, setAdapter] = useState<EditorAdapter | null>(null);
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  const { ready, activeProject, saveSource } = useProjects();

  // Monaco boots exactly once and lives for the lifetime of the app.
  // Content swaps (project switch, adapter swap) go through `setValue`
  // so the editor instance — and any live Monaco state like folds /
  // selection overlays — is not torn down.
  useEffect(() => {
    if (editorHostRef.current === null) return;
    if (editorInstanceRef.current !== null) return;
    if (!ready) return;

    registerMelLanguage(monaco);
    const ed = monaco.editor.create(editorHostRef.current, {
      value: activeProject?.source ?? "",
      language: MEL_LANGUAGE_ID,
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 12.5,
      fontFamily:
        '"JetBrains Mono", "Geist Mono", ui-monospace, Menlo, monospace',
      fontLigatures: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: "all",
      smoothScrolling: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
    });
    editorInstanceRef.current = ed;

    const a = createMonacoAdapter({ editor: ed, monaco });
    setEditor(ed);
    setAdapter(a);

    return () => {
      a.dispose();
      ed.dispose();
      editorInstanceRef.current = null;
      setAdapter(null);
      setEditor(null);
    };
    // `ready` gates the first boot, `activeProject` is only read for the
    // initial value on mount — subsequent project switches go through
    // the separate swap effect below. Excluding them keeps the editor
    // instance stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Swap Monaco's buffer when the active project changes without
  // tearing down the editor. Guard against echoing our own change back
  // into the DB by comparing current buffer content.
  const lastLoadedProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (adapter === null) return;
    if (editor === null) return;
    if (activeProject === null) return;
    if (lastLoadedProjectIdRef.current === activeProject.id) return;
    lastLoadedProjectIdRef.current = activeProject.id;
    const current = editor.getValue();
    if (current !== activeProject.source) {
      editor.setValue(activeProject.source);
    }
    adapter.setSource(activeProject.source);
    adapter.requestBuild();
  }, [adapter, editor, activeProject]);

  // Initial auto-build on first adapter attach.
  useEffect(() => {
    if (adapter === null) return;
    adapter.requestBuild();
  }, [adapter]);

  // Autosave: whenever Monaco's content changes, schedule a debounced
  // write back to the active project in IndexedDB. Stale saves (user
  // switched projects mid-debounce) are dropped inside useAutosave.
  const scheduleAutosave = useAutosave(
    activeProject?.id ?? null,
    useCallback(() => editor?.getValue() ?? "", [editor]),
    saveSource,
    400,
  );
  useEffect(() => {
    if (editor === null) return;
    const disp = editor.onDidChangeModelContent(() => {
      scheduleAutosave();
    });
    return () => disp.dispose();
  }, [editor, scheduleAutosave]);

  const revealSpan = useCallback(
    (line: number, column: number): void => {
      if (editor === null) return;
      const l = Math.max(1, line);
      const c = Math.max(1, column);
      editor.revealLineInCenterIfOutsideViewport(l);
      editor.setPosition({ lineNumber: l, column: c });
      editor.focus();
    },
    [editor],
  );
  const revealMarker = useCallback(
    (marker: Marker): void => {
      revealSpan(marker.span.start.line, marker.span.start.column);
    },
    [revealSpan],
  );

  const mainRef = useRef<HTMLDivElement | null>(null);
  const { sizes, setSizes: setPaneSizes, setLeft, setRight } = usePaneSizes();

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (el === null) return;
    const clampToContainer = (): void => {
      const total = el.getBoundingClientRect().width;
      if (total <= 0) return;
      setPaneSizes((s) => {
        const leftMax = Math.max(
          PANE_LIMITS.MIN_LEFT,
          total - PANE_LIMITS.MIN_RIGHT - PANE_LIMITS.MIN_CENTER,
        );
        const left = clamp(s.left, PANE_LIMITS.MIN_LEFT, leftMax);
        const rightMax = Math.max(
          PANE_LIMITS.MIN_RIGHT,
          total - left - PANE_LIMITS.MIN_CENTER,
        );
        const right = clamp(s.right, PANE_LIMITS.MIN_RIGHT, rightMax);
        return left === s.left && right === s.right ? s : { left, right };
      });
    };
    clampToContainer();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(clampToContainer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setPaneSizes]);

  const handleResizeLeft = useCallback(
    (dx: number, startSize: number) => {
      const total = mainRef.current?.getBoundingClientRect().width ?? 0;
      if (total === 0) return;
      setLeft(startSize + dx, total);
    },
    [setLeft],
  );
  const handleResizeRight = useCallback(
    (dx: number, startSize: number) => {
      const total = mainRef.current?.getBoundingClientRect().width ?? 0;
      if (total === 0) return;
      setRight(startSize - dx, total);
    },
    [setRight],
  );

  return (
    <div className="flex flex-col h-screen relative">
      {/* StudioUiProvider must wrap StudioProvider so StudioProviderHost
       * below can read the canonical simulation view-mode from the
       * studio runtime and forward it into StudioProvider's required
       * props. See packages/studio-react/StudioProvider.tsx — simulation
       * ownership has moved out of that component; it now expects
       * `uiViewMode` and dispatch callbacks from whoever hosts it. */}
      <StudioUiProvider>
        <ProjectRuntimeSync />
        <StudioProviderHost core={core} adapter={adapter}>
          <>
            <AgentRuntimeContextSync />
            <ViewportProvider>
            <FocusSync editor={editor} />
            <TimeScrubProvider>
              <StudioHotkeys />

              <TopBar />

              <main
                ref={mainRef}
                className="flex flex-1 min-h-0"
              >
                <div
                  style={{ width: sizes.left, flex: "none" }}
                  className="flex flex-col min-w-0 min-h-0"
                >
                  <SourcePane ref={editorHostRef} />
                </div>

                <PaneDivider
                  onResize={handleResizeLeft}
                  getSize={() => sizes.left}
                  ariaLabel="Resize source pane"
                />

                <div className="flex flex-col flex-1 min-w-0 min-h-0">
                  <ObservatoryPane />
                </div>

                <PaneDivider
                  onResize={handleResizeRight}
                  getSize={() => sizes.right}
                  ariaLabel="Resize lens pane"
                  invertDelta
                />

                <div
                  style={{ width: sizes.right, flex: "none" }}
                  className="flex flex-col min-w-0 min-h-0"
                >
                  <LensPane
                    onRevealMarker={revealMarker}
                    onRevealSourceSpan={revealSpan}
                  />
                </div>
              </main>

              <NowLine />
              <SnapshotRipple />
            </TimeScrubProvider>
            </ViewportProvider>
          </>
        </StudioProviderHost>
      </StudioUiProvider>
    </div>
  );
}

function ProjectRuntimeSync(): null {
  const ui = useStudioUi();
  const { activeProject } = useProjects();

  useEffect(() => {
    if (!ui.ready) return;
    if (activeProject === null) return;
    if (ui.snapshot.activeProjectName === activeProject.name) return;
    ui.switchProject(activeProject.name);
  }, [
    activeProject,
    ui,
  ]);

  return null;
}

function AgentRuntimeContextSync(): null {
  const ui = useStudioUi();
  const studio = useStudio();
  const schemaHash = studio.module?.schema.hash ?? null;
  const userModuleReady = studio.module !== null;
  const uiRef = useRef(ui);
  uiRef.current = ui;

  useEffect(() => {
    const currentUi = uiRef.current;
    if (!currentUi.ready) return;
    if (
      currentUi.snapshot.agentUserModuleReady === userModuleReady &&
      currentUi.snapshot.agentCurrentSchemaHash === schemaHash
    ) {
      return;
    }
    currentUi.syncAgentToolContext(userModuleReady, schemaHash);
  }, [schemaHash, studio.version, ui.ready, userModuleReady]);

  return null;
}

/**
 * Bridges the Studio UI runtime's view-mode into StudioProvider's new
 * required props. Separated into its own component so the hook call
 * (`useStudioUi`) is legal — StudioProvider needs the values but the
 * provider itself must stay pure JSX below.
 */
function StudioProviderHost({
  core,
  adapter,
  children,
}: {
  readonly core: ReturnType<typeof createStudioCore>;
  readonly adapter: EditorAdapter | null;
  readonly children: JSX.Element;
}): JSX.Element {
  const ui = useStudioUi();
  return (
    <StudioProvider
      core={core}
      adapter={adapter}
      historyPollMs={500}
      uiViewMode={ui.snapshot.viewMode}
      uiSimulationActionName={ui.snapshot.simulationActionName}
      onEnterSimulationRequest={ui.enterSimulation}
      onExitSimulationRequest={ui.exitSimulation}
    >
      {children}
    </StudioProvider>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
