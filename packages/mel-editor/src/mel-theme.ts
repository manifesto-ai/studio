import type * as monaco from "monaco-editor";

export const MEL_THEME_NAME = "mel-studio-dark";

export const MEL_THEME_DATA: monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "63dfcf", fontStyle: "bold" },
    { token: "type", foreground: "91a6ff" },
    { token: "support.function", foreground: "d59cff" },
    { token: "variable.predefined", foreground: "ffbf69" },
    { token: "constant.language", foreground: "ff8c99" },
    { token: "identifier", foreground: "edf4fc" },
    { token: "number", foreground: "d59cff" },
    { token: "string", foreground: "7ad8ff" },
    { token: "string.escape", foreground: "63dfcf" },
    { token: "string.invalid", foreground: "ff8c99" },
    { token: "comment", foreground: "5a7a9a", fontStyle: "italic" },
    { token: "delimiter", foreground: "7aa4de" },
    { token: "@brackets", foreground: "7aa4de" }
  ],
  colors: {
    "editor.background": "#071019",
    "editor.foreground": "#edf4fc",
    "editor.lineHighlightBackground": "#0d1f2e",
    "editor.selectionBackground": "#63dfcf3d",
    "editor.inactiveSelectionBackground": "#63dfcf1a",
    "editorCursor.foreground": "#63dfcf",
    "editorLineNumber.foreground": "#3a5a7a",
    "editorLineNumber.activeForeground": "#7aa4de",
    "editorIndentGuide.background": "#1a2a3a",
    "editorIndentGuide.activeBackground": "#2a4a5a",
    "editor.selectionHighlightBackground": "#91a6ff1a",
    "editorBracketMatch.background": "#63dfcf1a",
    "editorBracketMatch.border": "#63dfcf44",
    "editorWidget.background": "#0a1822",
    "editorWidget.border": "#7aa4de2e",
    "editorSuggestWidget.background": "#0a1822",
    "editorSuggestWidget.border": "#7aa4de2e",
    "editorSuggestWidget.selectedBackground": "#63dfcf1a",
    "editorSuggestWidget.highlightForeground": "#63dfcf",
    "editorHoverWidget.background": "#0a1822",
    "editorHoverWidget.border": "#7aa4de2e",
    "input.background": "#0d1f2e",
    "input.border": "#7aa4de2e",
    "input.foreground": "#edf4fc",
    "focusBorder": "#63dfcf56",
    "scrollbarSlider.background": "#91a6ff38",
    "scrollbarSlider.hoverBackground": "#91a6ff50",
    "scrollbarSlider.activeBackground": "#91a6ff68",
    "minimap.background": "#071019"
  }
};

let defined = false;

export function defineMelTheme(monacoInstance: typeof monaco): void {
  if (defined) {
    return;
  }

  monacoInstance.editor.defineTheme(MEL_THEME_NAME, MEL_THEME_DATA);
  defined = true;
}
