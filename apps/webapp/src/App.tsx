import { type CSSProperties, useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import {
  createStudioCore,
  type EditorAdapter,
  type Marker,
  type StudioCore,
} from "@manifesto-ai/studio-core";
import { createMonacoAdapter } from "@manifesto-ai/studio-adapter-monaco";
import {
  COLORS,
  DiagnosticsPanel,
  HistoryTimeline,
  PlanPanel,
  SnapshotTree,
  StudioHotkeys,
  StudioProvider,
  useStudio,
} from "@manifesto-ai/studio-react";
import todoSource from "./fixtures/todo.mel?raw";

type Wiring = {
  readonly core: StudioCore;
  readonly adapter: EditorAdapter;
  readonly editor: monaco.editor.IStandaloneCodeEditor;
};

type RightTab = "snapshot" | "plan" | "history" | "diagnostics";

/**
 * Phase 1 W2: editor | graph placeholder | tabbed panel column.
 *
 * The Monaco host `<div ref={editorHostRef} />` is rendered UNCONDITIONALLY
 * at a fixed position in the tree. Swapping its parent between
 * "SourceEditor wrapper" and "plain div" would remount the div and wipe
 * Monaco's content — avoid that. Chrome decoration (header / footer) is
 * applied via sibling elements instead of a wrapper component.
 */
export function App(): JSX.Element {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [wiring, setWiring] = useState<Wiring | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("snapshot");

  useEffect(() => {
    if (editorHostRef.current === null) return;
    // Guard StrictMode's intentional double-effect-run in dev: if an editor
    // already exists for this host, don't tear it down and rebuild — just
    // reuse.
    if (editorInstanceRef.current !== null) return;

    const editor = monaco.editor.create(editorHostRef.current, {
      value: todoSource,
      language: "plaintext",
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 12,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      padding: { top: 8, bottom: 8 },
    });
    editorInstanceRef.current = editor;

    const adapter = createMonacoAdapter({ editor, monaco });
    const core = createStudioCore();
    setWiring({ core, adapter, editor });

    return () => {
      adapter.dispose();
      editor.dispose();
      editorInstanceRef.current = null;
    };
  }, []);

  const revealMarker = (marker: Marker): void => {
    if (wiring === null) return;
    const { editor } = wiring;
    const { start } = marker.span;
    const line = Math.max(1, start.line);
    const column = Math.max(1, start.column);
    editor.revealLineInCenterIfOutsideViewport(line);
    editor.setPosition({ lineNumber: line, column });
    editor.focus();
  };

  const tabContent = (
    <>
      {rightTab === "snapshot" ? <SnapshotTree /> : null}
      {rightTab === "plan" ? <PlanPanel /> : null}
      {rightTab === "history" ? <HistoryTimeline /> : null}
      {rightTab === "diagnostics" ? (
        <DiagnosticsPanel onSelect={revealMarker} />
      ) : null}
    </>
  );

  const body = (
    <>
      <TopBar />
      <div style={mainStyle}>
        <div style={editorPaneStyle}>
          <div style={editorHeaderStyle}>
            <div style={tabChipStyle}>
              <span>todo.mel</span>
            </div>
            <span style={{ color: COLORS.muted, fontSize: 11 }}>
              ⌘/Ctrl + S to build
            </span>
          </div>
          {/* Stable: never re-parented. */}
          <div ref={editorHostRef} style={editorHostStyle} />
          {wiring !== null ? <EditorFooter /> : null}
        </div>

        <div style={graphPaneStyle}>
          <PanePlaceholder
            title="Schema Graph"
            subtitle="W3 brings the D3 SchemaGraphView here."
          />
        </div>

        <div style={rightPaneStyle}>
          <TabRow value={rightTab} onChange={setRightTab} />
          <div style={tabContentStyle}>
            {wiring !== null ? (
              tabContent
            ) : (
              <div style={placeholderContentStyle}>loading…</div>
            )}
          </div>
        </div>
      </div>
      <StatusBar />
    </>
  );

  return (
    <div style={rootStyle}>
      {wiring !== null ? (
        <StudioProvider
          core={wiring.core}
          adapter={wiring.adapter}
          historyPollMs={500}
        >
          <StudioHotkeys />
          {body}
        </StudioProvider>
      ) : (
        body
      )}
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

function TopBar(): JSX.Element {
  return (
    <div style={topBarStyle}>
      <span style={{ fontWeight: 600 }}>Studio</span>
      <span style={{ color: COLORS.textDim, marginLeft: 16 }}>
        manifesto-ai / studio / todo.mel
      </span>
      <span style={{ marginLeft: "auto", color: COLORS.textDim, fontSize: 12 }}>
        studio.manifesto-ai.dev — early access
      </span>
    </div>
  );
}

function StatusBar(): JSX.Element {
  return (
    <div style={statusBarStyle}>
      <span style={{ color: COLORS.textDim }}>Phase 1 — W2 panels wired</span>
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

function PanePlaceholder({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: string;
}): JSX.Element {
  return (
    <div style={{ padding: 0, height: "100%" }}>
      <div style={paneHeaderStyle}>{title}</div>
      <div style={placeholderContentStyle}>{subtitle}</div>
    </div>
  );
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
  padding: "0 16px",
  height: 48,
  background: COLORS.surface,
  borderBottom: `1px solid ${COLORS.line}`,
  fontSize: 13,
};
const mainStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
};
const editorPaneStyle: CSSProperties = {
  width: "40%",
  minWidth: 0,
  borderRight: `1px solid ${COLORS.line}`,
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
  width: "35%",
  minWidth: 0,
  borderRight: `1px solid ${COLORS.line}`,
  background: COLORS.panel,
  display: "flex",
  flexDirection: "column",
};
const rightPaneStyle: CSSProperties = {
  width: "25%",
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
