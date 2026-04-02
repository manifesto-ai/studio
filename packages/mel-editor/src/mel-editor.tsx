import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { registerMelLanguage, MEL_LANGUAGE_ID } from "./mel-language.js";
import { defineMelTheme, MEL_THEME_NAME } from "./mel-theme.js";
import { MelLspBridge } from "./lsp/bridge.js";

const DOCUMENT_URI = "inmemory://model/main.mel";

export type MelEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  readOnly?: boolean;
  className?: string;
  lsp?: boolean;
};

export function MelEditor({
  value,
  onChange,
  onMount,
  readOnly,
  className,
  lsp = true
}: MelEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const bridgeRef = useRef<MelLspBridge | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  onChangeRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    registerMelLanguage(monaco);
    defineMelTheme(monaco);

    const editor = monaco.editor.create(container, {
      value,
      language: MEL_LANGUAGE_ID,
      theme: MEL_THEME_NAME,
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 24,
      letterSpacing: 0.1,
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
      fontLigatures: false,
      padding: { top: 16, bottom: 16 },
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      bracketPairColorization: { enabled: true },
      guides: {
        indentation: true,
        bracketPairs: true
      },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        verticalSliderSize: 6,
        horizontalSliderSize: 6
      },
      wordWrap: "off",
      tabSize: 2
    });

    editorRef.current = editor;

    const disposable = editor.onDidChangeModelContent(() => {
      const nextValue = editor.getValue();
      if (nextValue !== valueRef.current) {
        onChangeRef.current(nextValue);
        bridgeRef.current?.notifyDocumentChange(DOCUMENT_URI, nextValue);
      }
    });

    // Start LSP bridge
    if (lsp) {
      try {
        const bridge = new MelLspBridge();
        bridge.start();
        bridge.notifyDocumentOpen(DOCUMENT_URI, value);
        bridgeRef.current = bridge;
      } catch {
        // LSP is optional — editor works without it
      }
    }

    onMount?.(editor);

    return () => {
      disposable.dispose();
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const currentValue = editor.getValue();
    if (currentValue !== value) {
      const selections = editor.getSelections();
      editor.setValue(value);
      if (selections) {
        editor.setSelections(selections);
      }
    }
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.updateOptions({ readOnly });
    }
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
