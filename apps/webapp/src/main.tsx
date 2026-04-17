import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { App } from "./App.js";

// Monaco requires a MonacoEnvironment.getWorker hook to spawn its tokenizer
// worker. We only use a plain-text language surface in Phase 1, so just the
// base editor.worker is wired — TS/JSON/CSS language workers land if we
// adopt their language services later.
self.MonacoEnvironment = {
  getWorker(): Worker {
    return new EditorWorker();
  },
};

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
