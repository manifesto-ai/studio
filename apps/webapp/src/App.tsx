import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import {
  createStudioCore,
  type EditorAdapter,
  type StudioCore,
} from "@manifesto-ai/studio-core";
import { createMonacoAdapter } from "@manifesto-ai/studio-adapter-monaco";
import { StudioProvider, useStudio } from "@manifesto-ai/studio-react";
import todoSource from "./fixtures/todo.mel?raw";

/**
 * W1 scaffold. Three-pane placeholder — real SourceEditor / SchemaGraphView
 * / InteractionEditor components land in W2~W4. The goal here is just to
 * prove the wiring: Vite + React + Monaco + studio-react + studio-core all
 * cooperate in a live browser.
 */
export function App(): JSX.Element {
  const [ready, setReady] = useState<{
    core: StudioCore;
    adapter: EditorAdapter;
  } | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);

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
    });
    const adapter = createMonacoAdapter({ editor, monaco });
    const core = createStudioCore();
    setReady({ core, adapter });

    return () => {
      adapter.dispose();
      editor.dispose();
    };
  }, []);

  return (
    <div style={rootStyle}>
      <TopBar />
      <div style={mainStyle}>
        <div style={editorPaneStyle}>
          <div ref={editorHostRef} style={editorHostStyle} />
        </div>
        {ready !== null ? (
          <StudioProvider core={ready.core} adapter={ready.adapter}>
            <GraphPlaceholder />
            <InteractionPlaceholder />
          </StudioProvider>
        ) : (
          <>
            <div style={{ ...graphPaneStyle, ...centerTextStyle }}>loading…</div>
            <div style={{ ...rightPaneStyle, ...centerTextStyle }}>loading…</div>
          </>
        )}
      </div>
      <StatusBar />
    </div>
  );
}

function TopBar(): JSX.Element {
  return (
    <div style={topBarStyle}>
      <span style={{ fontWeight: 600 }}>Studio</span>
      <span style={{ color: "#95A3B8", marginLeft: 16 }}>
        manifesto-ai / studio / todo.mel
      </span>
      <span style={{ marginLeft: "auto", color: "#95A3B8", fontSize: 12 }}>
        studio.manifesto-ai.dev — early access
      </span>
    </div>
  );
}

function GraphPlaceholder(): JSX.Element {
  const { module, build, plan } = useStudio();
  return (
    <div style={graphPaneStyle}>
      <div style={paneHeaderStyle}>Schema Graph</div>
      <div style={{ padding: 24, color: "#95A3B8", fontSize: 13 }}>
        <p>
          Module:{" "}
          <span style={{ color: "#E6EBF8" }}>
            {module === null ? "not built yet" : module.schema.id}
          </span>
        </p>
        <p>
          Plan:{" "}
          <span style={{ color: "#E6EBF8" }}>
            {plan === null
              ? "—"
              : `${plan.identityMap.size} identity entries`}
          </span>
        </p>
        <button
          type="button"
          onClick={() => {
            void build();
          }}
          style={buttonStyle}
        >
          Build
        </button>
        <p style={{ marginTop: 24, fontSize: 11 }}>
          W3 brings the D3 SchemaGraphView here.
        </p>
      </div>
    </div>
  );
}

function InteractionPlaceholder(): JSX.Element {
  const { module, snapshot } = useStudio();
  return (
    <div style={rightPaneStyle}>
      <div style={paneHeaderStyle}>Interact</div>
      <div style={{ padding: 24, color: "#95A3B8", fontSize: 13 }}>
        <p>Actions:</p>
        <pre
          style={{
            background: "#0B1020",
            border: "1px solid #334155",
            padding: 12,
            borderRadius: 6,
            color: "#E6EBF8",
            fontSize: 11,
            overflowX: "auto",
          }}
        >
          {module === null
            ? "—"
            : Object.keys(module.schema.actions).sort().join("\n")}
        </pre>
        <p>Snapshot:</p>
        <pre
          style={{
            background: "#0B1020",
            border: "1px solid #334155",
            padding: 12,
            borderRadius: 6,
            color: "#E6EBF8",
            fontSize: 11,
            maxHeight: 240,
            overflow: "auto",
          }}
        >
          {snapshot === null
            ? "(build first)"
            : JSON.stringify((snapshot as { data?: unknown }).data, null, 2)}
        </pre>
        <p style={{ marginTop: 24, fontSize: 11 }}>
          W4 brings the real InteractionEditor here.
        </p>
      </div>
    </div>
  );
}

function StatusBar(): JSX.Element {
  return (
    <div style={statusBarStyle}>
      <span style={{ color: "#95A3B8" }}>Phase 1 — W1 scaffold</span>
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: "#0B1020",
  color: "#E6EBF8",
};
const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0 16px",
  height: 48,
  background: "#1E293B",
  borderBottom: "1px solid #334155",
  fontSize: 13,
};
const mainStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
};
const editorPaneStyle: React.CSSProperties = {
  width: "40%",
  borderRight: "1px solid #334155",
  background: "#0F172A",
  display: "flex",
  flexDirection: "column",
};
const editorHostStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
};
const graphPaneStyle: React.CSSProperties = {
  width: "35%",
  borderRight: "1px solid #334155",
  background: "#0F172A",
  display: "flex",
  flexDirection: "column",
};
const rightPaneStyle: React.CSSProperties = {
  width: "25%",
  background: "#0F172A",
  display: "flex",
  flexDirection: "column",
};
const paneHeaderStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: "1px solid #334155",
  background: "#1A2036",
};
const statusBarStyle: React.CSSProperties = {
  padding: "0 16px",
  height: 40,
  background: "#1E293B",
  borderTop: "1px solid #334155",
  display: "flex",
  alignItems: "center",
  fontSize: 12,
};
const buttonStyle: React.CSSProperties = {
  background: "#63B3FC",
  color: "#0B1020",
  border: "none",
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const centerTextStyle: React.CSSProperties = {
  alignItems: "center",
  justifyContent: "center",
  color: "#607089",
  fontSize: 13,
};
