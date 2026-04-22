import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import type { StudioSimulateResult } from "@manifesto-ai/studio-core";
import type { SimulationPlaybackSource } from "../StudioProvider.js";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import { useStudio } from "../useStudio.js";
import { summarizePreviewValue } from "./snapshot-diff.js";

type SimulationTrace = NonNullable<
  NonNullable<StudioSimulateResult["diagnostics"]>["trace"]
>;
type SimulationTraceNode = SimulationTrace["root"];

export type SimulationTraceViewProps = {
  readonly trace: SimulationTrace;
  readonly density?: "regular" | "compact";
  readonly defaultOpen?: boolean;
  readonly playbackSource?: SimulationPlaybackSource | null;
};

const SUMMARY_INPUT_KEYS = ["op", "path", "type", "reason", "flow", "target"] as const;

export function SimulationTraceView({
  trace,
  density = "regular",
  defaultOpen = false,
  playbackSource = null,
}: SimulationTraceViewProps): JSX.Element {
  const { enterSimulation } = useStudio();
  const [open, setOpen] = useState(defaultOpen);
  const nodeCount = useMemo(() => countTraceNodes(trace), [trace]);
  const compact = density === "compact";
  const replayEnabled = playbackSource !== null;
  const replayAll = useCallback(() => {
    if (playbackSource === null) return;
    enterSimulation({
      origin: { kind: "simulate-button", actionName: trace.intent.type },
      trace,
      source: playbackSource,
      mode: "sequence",
    });
  }, [playbackSource, enterSimulation, trace]);
  const replayNode = useCallback(
    (node: SimulationTraceNode) => {
      if (playbackSource === null) return;
      enterSimulation({
        origin: {
          kind: "trace-node",
          actionName: trace.intent.type,
          traceNodeId: node.id,
        },
        trace,
        source: playbackSource,
        mode: "step",
      });
    },
    [playbackSource, enterSimulation, trace],
  );

  return (
    <details
      open={open}
      style={detailsStyle(compact)}
      data-testid="simulation-trace"
    >
      <summary
        style={summaryStyle(compact)}
        data-testid="simulation-trace-summary"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span style={summaryHeaderStyle()}>
          <span style={summaryTitleStyle(compact)}>Execution Trace</span>
          {replayEnabled ? (
            <button
              type="button"
              style={replayButtonStyle(compact)}
              data-testid="simulation-trace-replay-all"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                replayAll();
              }}
            >
              Replay
            </button>
          ) : null}
        </span>
        <span style={summaryMetaStyle(compact)}>
          {trace.terminatedBy}
          {" · "}
          {nodeCount} node{nodeCount === 1 ? "" : "s"}
          {" · "}
          {trace.root.sourcePath}
        </span>
      </summary>
      {open ? (
        <div style={bodyStyle(compact)}>
          <TraceTreeNode
            node={trace.root}
            depth={0}
            density={density}
            replayEnabled={replayEnabled}
            onReplayNode={replayNode}
            isRoot
          />
        </div>
      ) : null}
    </details>
  );
}

function TraceTreeNode({
  node,
  depth,
  density,
  replayEnabled,
  onReplayNode,
  isRoot = false,
}: {
  readonly node: SimulationTraceNode;
  readonly depth: number;
  readonly density: "regular" | "compact";
  readonly replayEnabled: boolean;
  readonly onReplayNode: (node: SimulationTraceNode) => void;
  readonly isRoot?: boolean;
}): JSX.Element {
  const compact = density === "compact";
  const inputSummary = summarizeInputs(node.inputs);
  const hasOutput = node.output !== null && node.output !== undefined;
  const outputSummary = hasOutput
    ? summarizePreviewValue(node.output, compact ? 42 : 72)
    : null;
  const replayable = replayEnabled && isReplayableTraceNode(node);

  return (
    <div style={treeNodeStyle(depth, compact)} data-testid={isRoot ? "simulation-trace-root-node" : undefined}>
      <div style={rowStyle(compact)}>
        <span style={kindStyle(node.kind, compact)}>{node.kind}</span>
        <code style={pathStyle(compact)}>{node.sourcePath}</code>
        {replayable ? (
          <button
            type="button"
            style={replayButtonStyle(compact)}
            data-testid={`simulation-trace-replay-${node.id}`}
            onClick={() => onReplayNode(node)}
          >
            Play
          </button>
        ) : null}
      </div>
      {inputSummary !== null ? (
        <div style={metaLineStyle(compact)}>
          <span style={labelStyle}>inputs</span>
          <code style={valueStyle(compact)}>{inputSummary}</code>
        </div>
      ) : null}
      {outputSummary !== null ? (
        <div style={metaLineStyle(compact)}>
          <span style={labelStyle}>output</span>
          <code style={valueStyle(compact)}>{outputSummary}</code>
        </div>
      ) : null}
      {node.children.length > 0 ? (
        <div style={childrenStyle}>
          {node.children.map((child) => (
            <TraceTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              density={density}
              replayEnabled={replayEnabled}
              onReplayNode={onReplayNode}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function countTraceNodes(trace: SimulationTrace): number {
  const indexed = Object.keys(trace.nodes).length;
  if (indexed > 0) return indexed;
  return countTraceNode(trace.root);
}

function countTraceNode(node: SimulationTraceNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countTraceNode(child), 0);
}

function summarizeInputs(inputs: SimulationTraceNode["inputs"]): string | null {
  const entries = SUMMARY_INPUT_KEYS.flatMap((key) => {
    const value = inputs[key];
    if (value === undefined || value === null) return [];
    return [`${key}=${summarizePreviewValue(value, 28)}`];
  });
  return entries.length > 0 ? entries.join(" ") : null;
}

function isReplayableTraceNode(node: SimulationTraceNode): boolean {
  if (node.sourcePath.startsWith("actions.")) return true;
  if (node.sourcePath.startsWith("computed.")) return true;
  if (node.kind !== "patch") return false;
  const patchPath = node.inputs.path;
  return (
    typeof patchPath === "string" &&
    patchPath.length > 0 &&
    !patchPath.startsWith("$")
  );
}

function kindColor(kind: SimulationTraceNode["kind"]): string {
  switch (kind) {
    case "patch":
      return COLORS.action;
    case "effect":
      return COLORS.warn;
    case "error":
      return COLORS.err;
    case "branch":
      return COLORS.accent;
    case "halt":
      return COLORS.muted;
    case "call":
      return COLORS.computed;
    case "computed":
      return COLORS.computed;
    default:
      return COLORS.textDim;
  }
}

function detailsStyle(compact: boolean): CSSProperties {
  return {
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    background: COLORS.panelAlt,
    overflow: "hidden",
    marginTop: compact ? 6 : 8,
  };
}

function summaryStyle(compact: boolean): CSSProperties {
  return {
    cursor: "pointer",
    listStyle: "none",
    padding: compact ? "7px 9px" : "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  };
}

function summaryHeaderStyle(): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
}

function summaryTitleStyle(compact: boolean): CSSProperties {
  return {
    fontSize: compact ? 10 : 11,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: COLORS.textDim,
    fontFamily: FONT_STACK,
  };
}

function summaryMetaStyle(compact: boolean): CSSProperties {
  return {
    color: COLORS.text,
    fontSize: compact ? 10.5 : 11,
    fontFamily: MONO_STACK,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

function bodyStyle(compact: boolean): CSSProperties {
  return {
    borderTop: `1px solid ${COLORS.line}`,
    padding: compact ? "8px 9px" : "10px",
    maxHeight: compact ? 180 : 260,
    overflow: "auto",
  };
}

function replayButtonStyle(compact: boolean): CSSProperties {
  return {
    marginLeft: "auto",
    borderRadius: 999,
    border: `1px solid ${COLORS.line}`,
    background: COLORS.panel,
    color: COLORS.textDim,
    fontFamily: FONT_STACK,
    fontSize: compact ? 9.5 : 10,
    fontWeight: 700,
    lineHeight: 1,
    padding: compact ? "4px 7px" : "5px 8px",
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };
}

function treeNodeStyle(depth: number, compact: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: compact ? 3 : 4,
    paddingLeft: depth === 0 ? 0 : 10,
    marginLeft: depth === 0 ? 0 : 6,
    borderLeft: depth === 0 ? "none" : `1px solid ${COLORS.line}`,
    paddingTop: depth === 0 ? 0 : 6,
  };
}

function rowStyle(compact: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    fontFamily: FONT_STACK,
    fontSize: compact ? 10.5 : 11,
  };
}

function kindStyle(kind: SimulationTraceNode["kind"], compact: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    padding: compact ? "1px 6px" : "2px 7px",
    background: `${kindColor(kind)}22`,
    border: `1px solid ${kindColor(kind)}55`,
    color: kindColor(kind),
    fontFamily: FONT_STACK,
    fontSize: compact ? 9.5 : 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };
}

function pathStyle(compact: boolean): CSSProperties {
  return {
    color: COLORS.text,
    fontFamily: MONO_STACK,
    fontSize: compact ? 10.5 : 11,
    wordBreak: "break-word",
  };
}

function metaLineStyle(compact: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: compact ? 10 : 10.5,
  };
}

const labelStyle: CSSProperties = {
  color: COLORS.muted,
  fontFamily: FONT_STACK,
  minWidth: 40,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  fontSize: 9.5,
};

function valueStyle(compact: boolean): CSSProperties {
  return {
    color: COLORS.textDim,
    fontFamily: MONO_STACK,
    fontSize: compact ? 10 : 10.5,
    wordBreak: "break-word",
  };
}

const childrenStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};
