import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { App } from "./App.js";

// Monaco requires a MonacoEnvironment.getWorker hook to spawn its tokenizer
// worker. MEL uses a local Monarch tokenizer, so the base editor worker is
// sufficient; TS/JSON/CSS language workers can land later if we add their
// language services.
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
