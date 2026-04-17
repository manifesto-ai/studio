import { useEffect, useRef, useState } from "react";
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
  SourceEditor,
  StudioHotkeys,
  StudioProvider,
} from "@manifesto-ai/studio-react";
import todoSource from "./fixtures/todo.mel?raw";

type Wiring = {
  readonly core: StudioCore;
  readonly adapter: EditorAdapter;
  readonly editor: monaco.editor.IStandaloneCodeEditor;
};

type RightTab = "snapshot" | "plan" | "history" | "diagnostics";

/**
 * Phase 1 W2: editor | graph placeholder | tabbed panel column. W3
 * replaces the graph placeholder with SchemaGraphView; W4 adds
 * InteractionEditor as a top tab in the right column.
 */
export function App(): JSX.Element {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const [wiring, setWiring] = useState<Wiring | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("snapshot");

  useEffect(() => {
    if (editorHostRef.current === null) return;

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
    const adapter = createMonacoAdapter({ editor, monaco });
    const core = createStudioCore();
    setWiring({ core, adapter, editor });

    return () => {
      adapter.dispose();
      editor.dispose();
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

  const layout = (
    <>
      <TopBar />
      <div style={mainStyle}>
        <div style={editorPaneStyle}>
          {wiring !== null ? (
            <SourceEditor filename="todo.mel">
              <div ref={editorHostRef} style={editorHostStyle} />
            </SourceEditor>
          ) : (
            <div style={placeholderStyle}>
              <div ref={editorHostRef} style={editorHostStyle} />
            </div>
          )}
        </div>
        <div style={graphPaneStyle}>
          <PanePlaceholder
            title="Schema Graph"
            subtitle="W3 brings the D3 SchemaGraphView here."
          />
        </div>
        <div style={rightPaneStyle}>
          {wiring !== null ? (
            <>
              <TabRow value={rightTab} onChange={setRightTab} />
              <div style={tabContentStyle}>
                {rightTab === "snapshot" ? <SnapshotTree /> : null}
                {rightTab === "plan" ? <PlanPanel /> : null}
                {rightTab === "history" ? <HistoryTimeline /> : null}
                {rightTab === "diagnostics" ? (
                  <DiagnosticsPanel onSelect={revealMarker} />
                ) : null}
              </div>
            </>
          ) : (
            <PanePlaceholder title="Right" subtitle="loading…" />
          )}
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
          {layout}
        </StudioProvider>
      ) : (
        layout
      )}
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

const rootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: COLORS.bg,
  color: COLORS.text,
};
const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0 16px",
  height: 48,
  background: COLORS.surface,
  borderBottom: `1px solid ${COLORS.line}`,
  fontSize: 13,
};
const mainStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
};
const editorPaneStyle: React.CSSProperties = {
  width: "40%",
  minWidth: 0,
  borderRight: `1px solid ${COLORS.line}`,
  display: "flex",
  flexDirection: "column",
};
const editorHostStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
};
const graphPaneStyle: React.CSSProperties = {
  width: "35%",
  minWidth: 0,
  borderRight: `1px solid ${COLORS.line}`,
  background: COLORS.panel,
  display: "flex",
  flexDirection: "column",
};
const rightPaneStyle: React.CSSProperties = {
  width: "25%",
  minWidth: 0,
  background: COLORS.panel,
  display: "flex",
  flexDirection: "column",
};
const paneHeaderStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: `1px solid ${COLORS.line}`,
  background: COLORS.panelAlt,
};
const tabRowStyle: React.CSSProperties = {
  display: "flex",
  background: COLORS.panelAlt,
  borderBottom: `1px solid ${COLORS.line}`,
};
const tabButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "10px 14px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
};
const tabContentStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};
const statusBarStyle: React.CSSProperties = {
  padding: "0 16px",
  height: 40,
  background: COLORS.surface,
  borderTop: `1px solid ${COLORS.line}`,
  display: "flex",
  alignItems: "center",
  fontSize: 12,
};
const placeholderStyle: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
};
const placeholderContentStyle: React.CSSProperties = {
  flex: 1,
  color: COLORS.muted,
  fontSize: 12,
  padding: 24,
};
