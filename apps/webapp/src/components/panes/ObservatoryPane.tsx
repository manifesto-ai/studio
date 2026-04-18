import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Focus, Orbit } from "lucide-react";
import * as monaco from "monaco-editor";
import {
  buildGraphModel,
  buildGraphFocusLens,
  resolveFocusRoots,
  SchemaGraphView,
  useStudio,
  type GraphFocusLens,
  type GraphNode,
} from "@manifesto-ai/studio-react";
import type { SourceSpan } from "@manifesto-ai/studio-core";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

/**
 * ObservatoryPane — the central instrument. Renders the schema
 * dependency graph inside a glass viewport. Hooks up editor selection
 * <-> graph focus lens bidirectionally.
 *
 * The SchemaGraphView itself is untouched; we only wrap and style the
 * chrome around it.
 */
export function ObservatoryPane({
  editor,
}: {
  readonly editor: monaco.editor.IStandaloneCodeEditor | null;
}): JSX.Element {
  const { module, plan } = useStudio();
  const graphModel = useMemo(
    () => buildGraphModel(module, plan),
    [module, plan],
  );
  const [activeSelectionLens, setActiveSelectionLens] =
    useState<GraphFocusLens | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useContainerSize(hostRef);
  const ready = width > 80 && height > 80;

  const setSelectionFromRoots = useCallback(
    (rootIds: readonly GraphNode["id"][], origin: GraphFocusLens["origin"]) => {
      if (graphModel === null) {
        setActiveSelectionLens(null);
        return;
      }
      const next = buildGraphFocusLens(graphModel, rootIds, origin);
      setActiveSelectionLens((prev) => (sameLens(prev, next) ? prev : next));
    },
    [graphModel],
  );

  const clearSelection = useCallback(() => {
    setActiveSelectionLens((prev) => (prev === null ? prev : null));
  }, []);

  const syncEditorSelection = useCallback(
    (selection: monaco.Selection | null) => {
      if (graphModel === null || selection === null) {
        clearSelection();
        return;
      }
      const roots = resolveFocusRoots(graphModel, selectionToSpan(selection));
      if (roots.length === 0) {
        clearSelection();
        return;
      }
      setSelectionFromRoots(
        roots.map((node) => node.id),
        "editor",
      );
    },
    [clearSelection, graphModel, setSelectionFromRoots],
  );

  useEffect(() => {
    if (graphModel === null) {
      setActiveSelectionLens(null);
      return;
    }
    setActiveSelectionLens(null);
  }, [graphModel?.schemaHash]);

  useEffect(() => {
    if (editor === null || graphModel === null) {
      setActiveSelectionLens(null);
      return;
    }
    let timer: number | null = null;
    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        syncEditorSelection(editor.getSelection());
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
  }, [editor, graphModel, syncEditorSelection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection]);

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
      setSelectionFromRoots([node.id], "graph");
      revealNode(node);
    },
    [revealNode, setSelectionFromRoots],
  );

  const lensActive = activeSelectionLens !== null;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        channel="state"
        right={
          lensActive ? (
            <Button
              variant="chip"
              size="xs"
              onClick={clearSelection}
              aria-label="Clear focus lens"
              className="gap-1.5"
            >
              <Focus className="h-[10px] w-[10px]" />
              <span>clear lens</span>
            </Button>
          ) : undefined
        }
      >
        <span>Observatory</span>
      </PanelHeader>

      <PanelBody className="relative">
        <div ref={hostRef} className="absolute inset-0 overflow-hidden">
          {ready && graphModel !== null && graphModel.nodes.length > 0 ? (
            <SchemaGraphView
              model={graphModel}
              width={width}
              height={height}
              focusLens={activeSelectionLens}
              onNodeClick={handleNodeClick}
              onBackgroundClick={clearSelection}
            />
          ) : (
            <EmptyObservatory ready={ready} />
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

function EmptyObservatory({ ready }: { readonly ready: boolean }): JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center max-w-[360px]">
        <div className="relative">
          <div
            className="
              h-16 w-16 rounded-full
              border border-[var(--color-glass-edge)]
              bg-[var(--color-glass)]
              flex items-center justify-center
            "
          >
            <Orbit className="h-6 w-6 text-[var(--color-violet)] opacity-60" />
          </div>
          <div
            aria-hidden
            className="
              absolute inset-0 rounded-full
              animate-ping
              border border-[var(--color-violet)]
              opacity-20
            "
          />
        </div>
        <div className="font-sans font-medium text-[14px] text-[var(--color-ink)]">
          {ready ? "Awaiting module" : "Calibrating"}
        </div>
        <div className="font-sans text-[12px] leading-relaxed text-[var(--color-ink-mute)] max-w-[280px]">
          Press{" "}
          <span className="font-mono text-[11.5px] text-[var(--color-ink)]">
            ⌘S
          </span>{" "}
          in the source pane to compile. Nodes will appear as observed
          signals.
        </div>
      </div>
    </div>
  );
}

function selectionToSpan(selection: monaco.Selection): SourceSpan {
  return {
    start: { line: selection.startLineNumber, column: selection.startColumn },
    end: { line: selection.endLineNumber, column: selection.endColumn },
  };
}

function sameLens(a: GraphFocusLens | null, b: GraphFocusLens | null): boolean {
  if (a === null || b === null) return a === b;
  return a.signature === b.signature;
}

function useContainerSize(ref: RefObject<HTMLElement | null>): {
  width: number;
  height: number;
} {
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
