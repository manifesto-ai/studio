import { useEffect, useMemo, useRef } from "react";
import * as monaco from "monaco-editor";
import {
  buildGraphModel,
  useStudio,
  type GraphModel,
  type GraphNode,
} from "@manifesto-ai/studio-react";
import { useFocus } from "./useFocus";

/**
 * Renderless component: mounts the sync hook inside the provider tree.
 * Keeps App.tsx free of extra sub-component scaffolding.
 */
export function FocusSync({
  editor,
}: {
  readonly editor: monaco.editor.IStandaloneCodeEditor | null;
}): null {
  useFocusSync(editor);
  return null;
}

/**
 * Two-way sync between the Monaco editor's cursor and the global Focus
 * state.
 *
 * Source → Focus (origin="source"): debounced cursor listener finds the
 *   smallest graph node whose `sourceSpan` encloses the cursor and
 *   publishes it. Readers (LiveGraph) dim non-focused neighbours.
 *
 * Focus → Source (when origin ∈ {"graph", "diagnostic"}): reveal the
 *   node's span in Monaco, add a whole-line Decoration with the
 *   `mf-focus-pulse` class for ~700ms, then clear it. We skip this for
 *   origin="source" to avoid re-centering the viewport on every keystroke.
 *
 * Graph model is computed here (not shared with ObservatoryPane) — the
 * scan is O(nodes) per cursor move and the object is structurally
 * stable across renders while the module is unchanged, so there is no
 * meaningful cost and no new coupling.
 */
export function useFocusSync(
  editor: monaco.editor.IStandaloneCodeEditor | null,
): void {
  const { module } = useStudio();
  const { focus, setFocus } = useFocus();
  // Plan param is null — we only need the graph topology + sourceSpans
  // for mapping, not the reconciliation overlay.
  const graphModel = useMemo(() => buildGraphModel(module, null), [module]);

  // --- Source → Focus --------------------------------------------------
  // Debounce at 150ms so continuous typing / arrow-key scrubbing doesn't
  // thrash. Dedupe by node id so re-publishing the same focus doesn't
  // re-trigger downstream effects.
  const lastSourceIdRef = useRef<GraphNode["id"] | null>(null);
  useEffect(() => {
    if (editor === null) return;
    let timer: number | undefined;
    const handler = (): void => {
      const pos = editor.getPosition();
      if (pos === null) return;
      const node = findNodeAtPosition(graphModel, pos.lineNumber, pos.column);
      const nextId = node?.id ?? null;
      if (nextId === lastSourceIdRef.current) return;
      lastSourceIdRef.current = nextId;
      if (node === null) return; // cursor landed in whitespace: leave focus alone
      setFocus({ kind: "node", id: node.id, origin: "source" });
    };
    const disp = editor.onDidChangeCursorPosition(() => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(handler, 150);
    });
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      disp.dispose();
    };
  }, [editor, graphModel, setFocus]);

  // --- Focus → Source (reveal + pulse) ---------------------------------
  // Key insight: we only run this for focus.origin ∈ {"graph","diagnostic"}.
  // For origin="source" the cursor is already there — re-revealing would
  // yank the viewport every keystroke.
  const lastRevealedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (editor === null) return;
    if (focus === null || focus.kind !== "node") {
      lastRevealedIdRef.current = null;
      return;
    }
    if (focus.origin === "source") return;
    // Dedupe: if the same node is re-focused from the graph, don't
    // re-pulse. The user will perceive a second click as "I already see
    // this" rather than "flash it again."
    if (lastRevealedIdRef.current === focus.id) return;
    lastRevealedIdRef.current = focus.id;

    const node = graphModel?.nodes.find((n) => n.id === focus.id) ?? null;
    if (node === null || node.sourceSpan === null) return;
    const span = node.sourceSpan;

    editor.revealLineInCenterIfOutsideViewport(span.start.line);
    // Move the cursor to the span start so subsequent keyboard edits
    // happen at a sensible place. `setPosition` fires onDidChangeCursor
    // which would normally bounce focus back as origin="source", but
    // our dedupe guard on the source→focus side swallows the echo.
    editor.setPosition({
      lineNumber: span.start.line,
      column: span.start.column,
    });

    const collection = editor.createDecorationsCollection([
      {
        range: new monaco.Range(
          span.start.line,
          1,
          span.end.line,
          Number.MAX_SAFE_INTEGER,
        ),
        options: {
          isWholeLine: true,
          className: "mf-focus-pulse",
        },
      },
    ]);
    const timer = window.setTimeout(() => collection.clear(), 750);
    return () => {
      window.clearTimeout(timer);
      collection.clear();
    };
  }, [editor, focus, graphModel]);
}

function findNodeAtPosition(
  model: GraphModel | null,
  line: number,
  column: number,
): GraphNode | null {
  if (model === null) return null;
  let best: GraphNode | null = null;
  let bestSize = Number.POSITIVE_INFINITY;
  for (const node of model.nodes) {
    const s = node.sourceSpan;
    if (s === null) continue;
    const afterStart =
      s.start.line < line ||
      (s.start.line === line && s.start.column <= column);
    const beforeEnd =
      s.end.line > line ||
      (s.end.line === line && s.end.column >= column);
    if (!afterStart || !beforeEnd) continue;
    // Prefer the smallest enclosing span — it's the most specific hit.
    const size =
      (s.end.line - s.start.line) * 10_000 +
      (s.end.column - s.start.column);
    if (size < bestSize) {
      best = node;
      bestSize = size;
    }
  }
  return best;
}
