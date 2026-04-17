import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
  type SourceSpan,
} from "@manifesto-ai/studio-core";
import {
  createMonacoAdapter,
  MEL_LANGUAGE_ID,
  registerMelLanguage,
} from "@manifesto-ai/studio-adapter-monaco";
import {
  buildGraphModel,
  buildGraphFocusLens,
  COLORS,
  DiagnosticsPanel,
  type GraphFocusLens,
  type GraphNode,
  HistoryTimeline,
  InteractionEditor,
  PlanPanel,
  resolveFocusRoots,
  SchemaGraphView,
  SnapshotTree,
  StudioHotkeys,
  StudioProvider,
  useStudio,
} from "@manifesto-ai/studio-react";
import todoSource from "./fixtures/todo.mel?raw";
import battleshipSource from "./fixtures/battleship.mel?raw";

type FixtureId = "todo" | "battleship";
type Fixture = { readonly id: FixtureId; readonly label: string; readonly source: string };
const FIXTURES: readonly Fixture[] = [
  { id: "todo", label: "todo.mel", source: todoSource },
  { id: "battleship", label: "battleship.mel", source: battleshipSource },
];

type RightTab = "interact" | "snapshot" | "plan" | "history" | "diagnostics";

/**
 * Phase 1 W2: editor | graph placeholder | tabbed panel column.
 *
 * StudioProvider is mounted on the first render with `adapter: null` so
 * the tree position of every descendant — including the Monaco host div
 * — is stable across the adapter-ready transition. Remounting the host
 * div would detach Monaco's internal DOM and blank the editor.
 */
export function App(): JSX.Element {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const core = useMemo(() => createStudioCore(), []);
  const [adapter, setAdapter] = useState<EditorAdapter | null>(null);
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("interact");
  const [fixtureId, setFixtureId] = useState<FixtureId>("todo");
  const fixture = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0];

  useEffect(() => {
    if (editorHostRef.current === null) return;
    // Guard StrictMode's intentional double-effect-run in dev.
    if (editorInstanceRef.current !== null) return;

    registerMelLanguage(monaco);
    const ed = monaco.editor.create(editorHostRef.current, {
      value: fixture.source,
      language: MEL_LANGUAGE_ID,
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 12,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      padding: { top: 8, bottom: 8 },
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
  }, []);

  // Swap source when fixture dropdown changes. The adapter's loop-
  // suppression keeps this from echoing into a change event. We then
  // trigger a build so the graph / interaction editor pick up the new
  // schema.
  const lastLoadedFixtureRef = useRef<FixtureId>(fixtureId);
  useEffect(() => {
    if (adapter === null) return;
    if (lastLoadedFixtureRef.current === fixtureId) return;
    lastLoadedFixtureRef.current = fixtureId;
    adapter.setSource(fixture.source);
    adapter.requestBuild();
  }, [adapter, fixtureId, fixture.source]);

  const revealSpan = (line: number, column: number): void => {
    if (editor === null) return;
    const l = Math.max(1, line);
    const c = Math.max(1, column);
    editor.revealLineInCenterIfOutsideViewport(l);
    editor.setPosition({ lineNumber: l, column: c });
    editor.focus();
  };
  const revealMarker = (marker: Marker): void => {
    revealSpan(marker.span.start.line, marker.span.start.column);
  };

  const mainRef = useRef<HTMLDivElement | null>(null);
  const { sizes, setSizes: setPaneSizes, setLeft, setRight } = usePaneSizes();

  // Clamp pane sizes to the actual container width on mount + whenever
  // the window resizes. Without this, a 800px viewport with defaults
  // that sum > 800px will leave the center with 0 px.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (el === null) return;
    const clampToContainer = (): void => {
      const total = el.getBoundingClientRect().width;
      if (total <= 0) return;
      setPaneSizes((s) => {
        const leftMax = Math.max(MIN_LEFT, total - MIN_RIGHT - MIN_CENTER);
        const left = clamp(s.left, MIN_LEFT, leftMax);
        const rightMax = Math.max(MIN_RIGHT, total - left - MIN_CENTER);
        const right = clamp(s.right, MIN_RIGHT, rightMax);
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
      // Negative dx moves divider left → right pane grows.
      setRight(startSize - dx, total);
    },
    [setRight],
  );

  return (
    <div style={rootStyle}>
      <StudioProvider core={core} adapter={adapter} historyPollMs={500}>
        <StudioHotkeys />
        <TopBar
          fixtureId={fixtureId}
          onFixtureChange={setFixtureId}
        />
        <div style={mainStyle} ref={mainRef}>
          <div
            style={{
              ...editorPaneStyle,
              width: sizes.left,
              flex: "none",
            }}
          >
            <div style={editorHeaderStyle}>
              <div style={tabChipStyle}>
                <span>{fixture.label}</span>
              </div>
              <span style={{ color: COLORS.muted, fontSize: 11 }}>
                ⌘/Ctrl + S to build
              </span>
            </div>
            {/* Stable: never re-parented. */}
            <div ref={editorHostRef} style={editorHostStyle} />
            <EditorFooter />
          </div>

          <PaneDivider
            onResize={handleResizeLeft}
            getSize={() => sizes.left}
            ariaLabel="Resize editor pane"
          />

          <div style={graphPaneStyle}>
            <GraphPane editor={editor} />
          </div>

          <PaneDivider
            onResize={handleResizeRight}
            getSize={() => sizes.right}
            ariaLabel="Resize inspector pane"
            invertDelta
          />

          <div
            style={{
              ...rightPaneStyle,
              width: sizes.right,
              flex: "none",
            }}
          >
            <TabRow value={rightTab} onChange={setRightTab} />
            <div style={tabContentStyle}>
              {rightTab === "interact" ? <InteractionEditor /> : null}
              {rightTab === "snapshot" ? <SnapshotTree /> : null}
              {rightTab === "plan" ? <PlanPanel /> : null}
              {rightTab === "history" ? <HistoryTimeline /> : null}
              {rightTab === "diagnostics" ? (
                <DiagnosticsPanel onSelect={revealMarker} />
              ) : null}
            </div>
          </div>
        </div>
        <StatusBar />
      </StudioProvider>
    </div>
  );
}

const MIN_LEFT = 240;
const MIN_RIGHT = 260;
const MIN_CENTER = 260;
const LAYOUT_STORAGE_KEY = "studio.layout.v1";
const DEFAULT_SIZES: PaneSizes = { left: 420, right: 380 };

type PaneSizes = { readonly left: number; readonly right: number };

function usePaneSizes() {
  const [sizes, setSizes] = useState<PaneSizes>(() => loadSizes());

  useEffect(() => {
    saveSizes(sizes);
  }, [sizes]);

  const setLeft = useCallback(
    (next: number, totalWidth: number) => {
      setSizes((s) => {
        const upper = Math.max(MIN_LEFT, totalWidth - s.right - MIN_CENTER);
        const clamped = clamp(next, MIN_LEFT, upper);
        return clamped === s.left ? s : { ...s, left: clamped };
      });
    },
    [],
  );
  const setRight = useCallback(
    (next: number, totalWidth: number) => {
      setSizes((s) => {
        const upper = Math.max(MIN_RIGHT, totalWidth - s.left - MIN_CENTER);
        const clamped = clamp(next, MIN_RIGHT, upper);
        return clamped === s.right ? s : { ...s, right: clamped };
      });
    },
    [],
  );
  return { sizes, setSizes, setLeft, setRight };
}

function loadSizes(): PaneSizes {
  if (typeof window === "undefined") return DEFAULT_SIZES;
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === null) return DEFAULT_SIZES;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as PaneSizes).left === "number" &&
      typeof (parsed as PaneSizes).right === "number"
    ) {
      return parsed as PaneSizes;
    }
  } catch {
    // ignore
  }
  return DEFAULT_SIZES;
}

function saveSizes(s: PaneSizes): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function PaneDivider({
  onResize,
  getSize,
  ariaLabel,
  invertDelta = false,
}: {
  readonly onResize: (dx: number, startSize: number) => void;
  readonly getSize: () => number;
  readonly ariaLabel: string;
  readonly invertDelta?: boolean;
}): JSX.Element {
  const [active, setActive] = useState(false);
  const dragRef = useRef<{ startX: number; startSize: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startSize: getSize() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null) return;
    onResize(e.clientX - d.startX, d.startSize);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") {
      onResize(invertDelta ? step : -step, getSize());
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      onResize(invertDelta ? -step : step, getSize());
      e.preventDefault();
    } else if (e.key === "Home") {
      // Reset to default for this side
      const delta = invertDelta
        ? getSize() - DEFAULT_SIZES.right
        : DEFAULT_SIZES.left - getSize();
      onResize(delta, getSize());
      e.preventDefault();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      style={{
        ...dividerStyle,
        background: active ? COLORS.accent : "transparent",
      }}
    >
      <div style={dividerInnerStyle(active)} />
    </div>
  );
}

function EditorFooter(): JSX.Element {
  const { diagnostics, module } = useStudio();
  let errors = 0;
  let warnings = 0;
  for (const m of diagnostics) {
    if (m.severity === "error") errors += 1;
    else if (m.severity === "warning") warnings += 1;
  }
  return (
    <div style={editorFooterStyle}>
      <span style={{ ...dotStyle, background: errors > 0 ? COLORS.err : COLORS.muted }} />
      <span>
        {errors} error{errors === 1 ? "" : "s"}
      </span>
      <span style={{ width: 16 }} />
      <span style={{ ...dotStyle, background: warnings > 0 ? COLORS.warn : COLORS.muted }} />
      <span>
        {warnings} warning{warnings === 1 ? "" : "s"}
      </span>
      <span style={{ marginLeft: "auto", color: COLORS.muted, fontSize: 11 }}>
        {module === null ? "no module yet" : `schema ${module.schema.hash.slice(0, 8)}`}
      </span>
    </div>
  );
}

function TopBar({
  fixtureId,
  onFixtureChange,
}: {
  readonly fixtureId: FixtureId;
  readonly onFixtureChange: (next: FixtureId) => void;
}): JSX.Element {
  const fixture = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0];
  return (
    <div style={topBarStyle}>
      <span style={{ fontWeight: 600 }}>Studio</span>
      <span style={{ color: COLORS.textDim, marginLeft: 16 }}>
        manifesto-ai / studio /
      </span>
      <select
        aria-label="Fixture"
        value={fixtureId}
        onChange={(e) => onFixtureChange(e.currentTarget.value as FixtureId)}
        style={fixtureSelectStyle}
      >
        {FIXTURES.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      {fixture.id === "battleship" ? (
        <span style={fixtureBadgeStyle}>60+ nodes · layout stress</span>
      ) : null}
      <span style={{ marginLeft: "auto", color: COLORS.textDim, fontSize: 12 }}>
        studio.manifesto-ai.dev — early access
      </span>
    </div>
  );
}

function StatusBar(): JSX.Element {
  return (
    <div style={statusBarStyle}>
      <span style={{ color: COLORS.textDim }}>Phase 1 — W4 interaction editor</span>
    </div>
  );
}

function TabRow({
  value,
  onChange,
}: {
  readonly value: RightTab;
  readonly onChange: (next: RightTab) => void;
}): JSX.Element {
  const tabs: readonly { readonly id: RightTab; readonly label: string }[] = [
    { id: "interact", label: "Interact" },
    { id: "snapshot", label: "Snapshot" },
    { id: "plan", label: "Plan" },
    { id: "history", label: "History" },
    { id: "diagnostics", label: "Diagnostics" },
  ];
  return (
    <div style={tabRowStyle}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          style={{
            ...tabButtonStyle,
            color: value === t.id ? COLORS.text : COLORS.textDim,
            borderBottom:
              value === t.id
                ? `2px solid ${COLORS.accent}`
                : "2px solid transparent",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function GraphPane({
  editor,
}: {
  readonly editor: monaco.editor.IStandaloneCodeEditor | null;
}): JSX.Element {
  const { module, plan } = useStudio();
  const graphModel = useMemo(
    () => buildGraphModel(module, plan),
    [module, plan],
  );
  const [editorLens, setEditorLens] = useState<GraphFocusLens | null>(null);
  const [pinnedGraphLens, setPinnedGraphLens] = useState<GraphFocusLens | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useContainerSize(hostRef);
  const ready = width > 80 && height > 80;

  const syncEditorLens = useCallback(
    (selection: monaco.Selection | null) => {
      if (graphModel === null || selection === null) {
        setEditorLens((prev) => (prev === null ? prev : null));
        return;
      }
      const roots = resolveFocusRoots(graphModel, selectionToSpan(selection));
      const next = buildGraphFocusLens(
        graphModel,
        roots.map((node) => node.id),
        "editor",
      );
      setEditorLens((prev) => (sameLens(prev, next) ? prev : next));
    },
    [graphModel],
  );

  useEffect(() => {
    if (graphModel === null) {
      setEditorLens(null);
      setPinnedGraphLens(null);
      return;
    }
    setPinnedGraphLens(null);
  }, [graphModel?.schemaHash]);

  useEffect(() => {
    if (editor === null || graphModel === null) {
      setEditorLens(null);
      return;
    }
    let timer: number | null = null;
    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        syncEditorLens(editor.getSelection());
      }, 80);
    };
    schedule();
    const disposable = editor.onDidChangeCursorSelection(() => {
      schedule();
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      disposable.dispose();
    };
  }, [editor, graphModel, syncEditorLens]);

  useEffect(() => {
    if (pinnedGraphLens === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setPinnedGraphLens(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pinnedGraphLens]);

  const activeLens = pinnedGraphLens ?? editorLens;
  const revealNode = useCallback(
    (node: GraphNode): void => {
      if (editor === null || node.sourceSpan === null) return;
      editor.revealLineInCenterIfOutsideViewport(node.sourceSpan.start.line);
      editor.setPosition({
        lineNumber: node.sourceSpan.start.line,
        column: node.sourceSpan.start.column,
      });
      editor.focus();
    },
    [editor],
  );
  const handleNodeClick = useCallback(
    (node: GraphNode): void => {
      if (graphModel !== null) {
        const next = buildGraphFocusLens(graphModel, [node.id], "graph");
        setPinnedGraphLens((prev) => (sameLens(prev, next) ? prev : next));
      }
      revealNode(node);
    },
    [graphModel, revealNode],
  );

  return (
    <div ref={hostRef} style={graphHostStyle}>
      {ready ? (
        <SchemaGraphView
          model={graphModel}
          width={width}
          height={height}
          focusLens={activeLens}
          onNodeClick={handleNodeClick}
          onBackgroundClick={() => setPinnedGraphLens(null)}
        />
      ) : null}
    </div>
  );
}

function selectionToSpan(selection: monaco.Selection): SourceSpan {
  return {
    start: {
      line: selection.startLineNumber,
      column: selection.startColumn,
    },
    end: {
      line: selection.endLineNumber,
      column: selection.endColumn,
    },
  };
}

function sameLens(
  a: GraphFocusLens | null,
  b: GraphFocusLens | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.signature === b.signature && a.origin === b.origin;
}

function useContainerSize(
  ref: React.RefObject<HTMLElement | null>,
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const update = (): void => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: COLORS.bg,
  color: COLORS.text,
};
const topBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 16px",
  height: 48,
  background: COLORS.surface,
  borderBottom: `1px solid ${COLORS.line}`,
  fontSize: 13,
};
const fixtureSelectStyle: CSSProperties = {
  background: COLORS.panel,
  color: COLORS.text,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 12,
  fontFamily: "inherit",
};
const fixtureBadgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: COLORS.warn,
  background: `${COLORS.warn}22`,
  padding: "2px 6px",
  borderRadius: 3,
};
const mainStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
};
const editorPaneStyle: CSSProperties = {
  minWidth: 0,
  background: COLORS.panel,
  display: "flex",
  flexDirection: "column",
};
const editorHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: `1px solid ${COLORS.line}`,
  background: COLORS.panelAlt,
  color: COLORS.text,
};
const tabChipStyle: CSSProperties = {
  padding: "4px 10px",
  background: COLORS.panel,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  fontSize: 11,
  color: COLORS.text,
};
const editorHostStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
};
const editorFooterStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  borderTop: `1px solid ${COLORS.line}`,
  background: COLORS.panelAlt,
  color: COLORS.textDim,
  fontSize: 11,
};
const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 3,
  display: "inline-block",
};
const graphPaneStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: COLORS.bg,
  display: "flex",
  flexDirection: "column",
};
const graphHostStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: "relative",
  overflow: "hidden",
};
const dividerStyle: CSSProperties = {
  width: 6,
  flex: "none",
  cursor: "col-resize",
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  outline: "none",
  transition: "background 120ms ease-out",
};
function dividerInnerStyle(active: boolean): CSSProperties {
  return {
    width: 1,
    height: "100%",
    background: active ? COLORS.accent : COLORS.line,
    boxShadow: active ? `0 0 0 1px ${COLORS.accent}` : "none",
    transition: "background 120ms ease-out, box-shadow 120ms ease-out",
  };
}
const rightPaneStyle: CSSProperties = {
  minWidth: 0,
  background: COLORS.panel,
  display: "flex",
  flexDirection: "column",
};
const paneHeaderStyle: CSSProperties = {
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: `1px solid ${COLORS.line}`,
  background: COLORS.panelAlt,
};
const tabRowStyle: CSSProperties = {
  display: "flex",
  background: COLORS.panelAlt,
  borderBottom: `1px solid ${COLORS.line}`,
};
const tabButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "10px 14px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
};
const tabContentStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};
const statusBarStyle: CSSProperties = {
  padding: "0 16px",
  height: 40,
  background: COLORS.surface,
  borderTop: `1px solid ${COLORS.line}`,
  display: "flex",
  alignItems: "center",
  fontSize: 12,
};
const placeholderContentStyle: CSSProperties = {
  flex: 1,
  color: COLORS.muted,
  fontSize: 12,
  padding: 24,
};
