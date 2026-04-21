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
import { StudioHotkeys, StudioProvider } from "@manifesto-ai/studio-react";

import { FIXTURES, type FixtureId } from "@/fixtures";
import { TopBar } from "@/components/chrome/TopBar";
import { NowLine } from "@/components/chrome/NowLine";
import { PaneDivider } from "@/components/chrome/PaneDivider";
import { SnapshotRipple } from "@/components/motion/SnapshotRipple";
import { TimeScrubProvider } from "@/hooks/useTimeScrub";
import { FocusProvider } from "@/hooks/useFocus";
import { FocusSync } from "@/hooks/useFocusSync";
import { SourcePane } from "@/components/panes/SourcePane";
import { ObservatoryPane } from "@/components/panes/ObservatoryPane";
import { LensPane, type LensId } from "@/components/panes/LensPane";
import { PANE_LIMITS, usePaneSizes } from "@/hooks/usePaneSizes";

/**
 * Deterministic Observatory — App shell.
 *
 * Layout (top → bottom):
 *   TopBar          (brand, breadcrumb, schema hash, determinism status)
 *   Main 3-pane     (Source | Observatory | Lens) — glass panels on aurora
 *   NowLine         (snapshot beam — Manifesto's temporal dimension)
 *
 * The Monaco host div is mounted exactly once (via `SourcePane`'s
 * forwarded ref) and never re-parented; remounting detaches Monaco's
 * internal DOM and blanks the editor.
 */
export function App(): JSX.Element {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const core = useMemo(() => createStudioCore(), []);
  const [adapter, setAdapter] = useState<EditorAdapter | null>(null);
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [lens, setLens] = useState<LensId>("interact");
  const [fixtureId, setFixtureId] = useState<FixtureId>("todo");
  const fixture = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0];

  useEffect(() => {
    if (editorHostRef.current === null) return;
    if (editorInstanceRef.current !== null) return;

    registerMelLanguage(monaco);
    const ed = monaco.editor.create(editorHostRef.current, {
      value: fixture.source,
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
  }, []);

  const lastLoadedFixtureRef = useRef<FixtureId>(fixtureId);
  useEffect(() => {
    if (adapter === null) return;
    if (lastLoadedFixtureRef.current === fixtureId) return;
    lastLoadedFixtureRef.current = fixtureId;
    adapter.setSource(fixture.source);
    adapter.requestBuild();
  }, [adapter, fixtureId, fixture.source]);

  // Initial auto-build: when the adapter first becomes non-null, kick off
  // a build so the Observatory graph populates without requiring the user
  // to hit Ctrl+S first. Fires exactly once per adapter instance.
  useEffect(() => {
    if (adapter === null) return;
    adapter.requestBuild();
  }, [adapter]);

  const revealSpan = (line: number, column: number): void => {
    if (editor === null) return;
    const l = Math.max(1, line);
    const c = Math.max(1, column);
    editor.revealLineInCenterIfOutsideViewport(l);
    editor.setPosition({ lineNumber: l, column: c });
    editor.focus();
  };
  const revealMarker = useCallback(
    (marker: Marker): void => {
      revealSpan(marker.span.start.line, marker.span.start.column);
    },
    [editor],
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
      <StudioProvider core={core} adapter={adapter} historyPollMs={500}>
        <FocusProvider>
        <FocusSync editor={editor} />
        <TimeScrubProvider>
        <StudioHotkeys />

        <TopBar
          fixtureId={fixtureId}
          onFixtureChange={setFixtureId}
          fixtures={FIXTURES}
        />

        <main
          ref={mainRef}
          className="flex flex-1 min-h-0"
        >
          <div
            style={{ width: sizes.left, flex: "none" }}
            className="flex flex-col min-w-0 min-h-0"
          >
            <SourcePane ref={editorHostRef} fixture={fixture} />
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
              value={lens}
              onChange={setLens}
              onRevealMarker={revealMarker}
            />
          </div>
        </main>

        <NowLine />
        <SnapshotRipple />
        </TimeScrubProvider>
        </FocusProvider>
      </StudioProvider>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
