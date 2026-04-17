import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import {
  GraphLayoutCache,
  runLayout,
  type NodePosition,
  type PositionMap,
} from "./layout.js";
import {
  identityFateGlyph,
  type GraphEdge,
  type GraphEdgeRelation,
  type GraphModel,
  type GraphNode,
  type GraphNodeId,
  type GraphNodeKind,
} from "./graph-model.js";
import type { IdentityFate } from "@manifesto-ai/studio-core";
import { GraphLegend } from "./GraphLegend.js";

export type SchemaGraphViewProps = {
  readonly model: GraphModel | null;
  /** Explicit canvas size. Defaults to 800x600. */
  readonly width?: number;
  readonly height?: number;
  readonly onNodeClick?: (node: GraphNode) => void;
  readonly selectedNodeId?: GraphNodeId | null;
  /** Override label. Used in empty state. */
  readonly emptyLabel?: string;
};

type ViewTransform = { readonly x: number; readonly y: number; readonly k: number };

const IDENTITY: ViewTransform = { x: 0, y: 0, k: 1 };
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;
const BASE_NODE_RADIUS = 28;

/**
 * Scale node and label dimensions down for dense graphs. Keeps labels
 * from piling up when the simulation has to pack 60+ nodes into a
 * narrow pane (battleship).
 */
function densityScale(nodeCount: number): number {
  if (nodeCount <= 15) return 1;
  return Math.max(0.55, Math.sqrt(15 / nodeCount));
}

export function SchemaGraphView(props: SchemaGraphViewProps): JSX.Element {
  const {
    model,
    width = 800,
    height = 600,
    onNodeClick,
    selectedNodeId = null,
    emptyLabel = "Build the module to see its schema graph.",
  } = props;

  const cacheRef = useRef<GraphLayoutCache>(new GraphLayoutCache());
  const prevPositionsRef = useRef<PositionMap | null>(null);
  const prevHashRef = useRef<string | null>(null);

  const positions = useMemo<PositionMap | null>(() => {
    if (model === null) return null;
    const cache = cacheRef.current;
    // Cache key includes a size bucket so resizing the pane invalidates
    // positions that were laid out for a very different canvas (the
    // rebuild-same-schema INV-P1-3 case still hits because the bucket
    // is coarse).
    const key = `${model.schemaHash}:${Math.round(width / 80)}x${Math.round(height / 80)}`;
    const cached = cache.get(key);
    if (cached !== null) {
      prevPositionsRef.current = cached;
      prevHashRef.current = model.schemaHash;
      return cached;
    }

    const carry =
      prevPositionsRef.current !== null
        ? GraphLayoutCache.carryOver(model, prevPositionsRef.current)
        : undefined;

    const fresh = runLayout(model, {
      width,
      height,
      prevPositions: carry,
    });
    cache.set(key, fresh);
    prevPositionsRef.current = fresh;
    prevHashRef.current = model.schemaHash;
    return fresh;
  }, [model, width, height]);

  const [view, setView] = useState<ViewTransform>(IDENTITY);
  const [hoveredId, setHoveredId] = useState<GraphNodeId | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStateRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const resetView = useCallback(() => setView(IDENTITY), []);

  // Reset view whenever the graph identity changes materially.
  useEffect(() => {
    resetView();
    setHoveredId(null);
  }, [model?.schemaHash, resetView]);

  const handleWheel = useCallback(
    (e: ReactWheelEvent<SVGSVGElement>) => {
      if (!e.ctrlKey && !e.metaKey && e.deltaY === 0) return;
      e.preventDefault();
      const svg = svgRef.current;
      if (svg === null) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const k = clamp(v.k * factor, MIN_SCALE, MAX_SCALE);
        const scaleRatio = k / v.k;
        // Keep the point under the cursor stable.
        const x = mx - (mx - v.x) * scaleRatio;
        const y = my - (my - v.y) * scaleRatio;
        return { x, y, k };
      });
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      // Only start pan on background (not a node) and primary button.
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest("[data-node-id]") !== null) return;
      panStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: view.x,
        origY: view.y,
      };
      setIsPanning(true);
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    },
    [view.x, view.y],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const st = panStateRef.current;
      if (st === null) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      setView((v) => ({ ...v, x: st.origX + dx, y: st.origY + dy }));
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      panStateRef.current = null;
      setIsPanning(false);
      if ((e.currentTarget as SVGSVGElement).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
      }
    },
    [],
  );

  const handleDoubleClick = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const target = e.target as Element;
      if (target.closest("[data-node-id]") !== null) return;
      resetView();
    },
    [resetView],
  );

  if (model === null || positions === null) {
    return <EmptyState width={width} height={height} label={emptyLabel} />;
  }

  const connectedByHover = hoveredId !== null
    ? edgesTouching(model, hoveredId)
    : null;

  const scale = densityScale(model.nodes.length);
  const nodeRadius = BASE_NODE_RADIUS * scale;
  const labelFontSize = Math.max(8, Math.round(11 * scale));
  const glyphFontSize = Math.max(8, Math.round(11 * scale));
  const showLabels = scale >= 0.65 || model.nodes.length <= 40;

  return (
    <div style={containerStyle}>
      <svg
        ref={svgRef}
        role="img"
        aria-label="Schema graph"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          background: COLORS.bg,
          display: "block",
          cursor: isPanning ? "grabbing" : "grab",
          touchAction: "none",
        }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <ArrowMarker id="arrow-feeds" color={COLORS.textDim} />
          <ArrowMarker id="arrow-mutates" color="#F59E0B" />
          <ArrowMarker id="arrow-unlocks" color={COLORS.muted} />
          <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </radialGradient>
        </defs>

        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="url(#grid-dots)"
          pointerEvents="none"
        />

        <GridPattern width={width} height={height} view={view} />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* Edges first so nodes overlap them cleanly. */}
          <g>
            {model.edges.map((e) => (
              <EdgeShape
                key={e.id}
                edge={e}
                positions={positions}
                radius={nodeRadius}
                dimmed={
                  hoveredId !== null && connectedByHover?.has(e.id) !== true
                }
                emphasized={
                  hoveredId !== null && connectedByHover?.has(e.id) === true
                }
              />
            ))}
          </g>

          {/* Nodes */}
          <g>
            {model.nodes.map((n) => {
              const p = positions.get(n.id);
              if (p === undefined) return null;
              return (
                <NodeShape
                  key={n.id}
                  node={n}
                  position={p}
                  radius={nodeRadius}
                  glyphFontSize={glyphFontSize}
                  labelFontSize={labelFontSize}
                  showLabel={showLabels}
                  hovered={hoveredId === n.id}
                  dimmed={
                    hoveredId !== null &&
                    hoveredId !== n.id &&
                    connectedByHover?.has(n.id) !== true
                  }
                  selected={selectedNodeId === n.id}
                  onHover={setHoveredId}
                  onClick={onNodeClick}
                />
              );
            })}
          </g>
        </g>
      </svg>

      <GraphLegend />

      {/* Minimap / zoom chrome corner, production-lite */}
      <ZoomChrome view={view} onReset={resetView} onChange={setView} />
    </div>
  );
}

type NodeProps = {
  readonly node: GraphNode;
  readonly position: NodePosition;
  readonly radius: number;
  readonly glyphFontSize: number;
  readonly labelFontSize: number;
  readonly showLabel: boolean;
  readonly hovered: boolean;
  readonly dimmed: boolean;
  readonly selected: boolean;
  readonly onHover: (id: GraphNodeId | null) => void;
  readonly onClick?: (node: GraphNode) => void;
};

function NodeShape({
  node,
  position,
  radius,
  glyphFontSize,
  labelFontSize,
  showLabel,
  hovered,
  dimmed,
  selected,
  onHover,
  onClick,
}: NodeProps): JSX.Element {
  const { fill, stroke } = kindColors(node.kind);
  const opacity = dimmed ? 0.3 : 1;

  const onClickInner = onClick === undefined ? undefined : () => onClick(node);
  const onKeyDown = (e: React.KeyboardEvent<SVGGElement>) => {
    if (onClick === undefined) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick(node);
    }
  };

  const Shape =
    node.kind === "action" ? PillShape : node.kind === "computed" ? HexShape : RoundedRectShape;
  const labelOffset = radius + Math.max(10, radius * 0.6);

  return (
    <g
      transform={`translate(${position.x} ${position.y})`}
      data-node-id={node.id}
      tabIndex={0}
      role="button"
      aria-label={`${node.kind} ${node.name}`}
      style={{
        cursor: onClick === undefined ? "default" : "pointer",
        opacity,
        outline: "none",
        transition: "opacity 120ms ease-out",
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      onClick={onClickInner}
      onKeyDown={onKeyDown}
    >
      <FateHalo fate={node.identityFate} Shape={Shape} radius={radius} />
      {(hovered || selected) && (
        <Shape
          fill="none"
          stroke={selected ? COLORS.accent : "#FFFFFF"}
          strokeWidth={selected ? 2.5 : 2}
          expand={6}
          opacity={selected ? 0.9 : 0.5}
          radius={radius}
        />
      )}
      <Shape fill={fill} stroke={stroke} strokeWidth={1.5} radius={radius} />
      <circle cx={0} cy={0} r={radius} fill="url(#node-glow)" pointerEvents="none" />

      <text
        x={0}
        y={4}
        textAnchor="middle"
        fontFamily={MONO_STACK}
        fontSize={glyphFontSize}
        fontWeight={600}
        fill="#0B1020"
        pointerEvents="none"
      >
        {kindGlyph(node.kind)}
      </text>
      {showLabel ? (
        <text
          x={0}
          y={labelOffset}
          textAnchor="middle"
          fontFamily={FONT_STACK}
          fontSize={labelFontSize}
          fill={COLORS.text}
          pointerEvents="none"
        >
          {node.name}
        </text>
      ) : null}
      <FateBadge
        identity={node.identityFate}
        snapshot={node.snapshotFate}
        radius={radius}
      />
      {node.warnings.length > 0 ? (
        <WarnBadge count={node.warnings.length} radius={radius} />
      ) : null}

      <title>
        {describeNodeFate(node)}
      </title>
    </g>
  );
}

function FateHalo({
  fate,
  Shape,
  radius,
}: {
  readonly fate: IdentityFate | null;
  readonly Shape: (p: ShapeProps) => JSX.Element;
  readonly radius: number;
}): JSX.Element | null {
  if (fate === null) return null;
  const color = identityFateColor(fate);
  if (color === null) return null;
  return (
    <Shape
      fill="none"
      stroke={color}
      strokeWidth={2}
      expand={3}
      opacity={0.85}
      radius={radius}
    />
  );
}

function FateBadge({
  identity,
  snapshot,
  radius,
}: {
  readonly identity: IdentityFate | null;
  readonly snapshot: GraphNode["snapshotFate"];
  readonly radius: number;
}): JSX.Element | null {
  const glyph = identity !== null ? identityFateGlyph(identity) : "";
  const showIdentity = identity !== null && identity.kind !== "preserved" && glyph !== "";
  if (showIdentity) {
    return (
      <g transform={`translate(${radius * 1.1} ${-radius * 0.75})`}>
        <circle
          r={8.5}
          fill={identityFateColor(identity) ?? COLORS.panel}
          stroke={COLORS.bg}
          strokeWidth={1.5}
        />
        <text
          textAnchor="middle"
          y={3.2}
          fontFamily={MONO_STACK}
          fontSize={10}
          fontWeight={700}
          fill="#0B1020"
          pointerEvents="none"
        >
          {glyph}
        </text>
      </g>
    );
  }
  if (snapshot !== undefined && snapshot !== "preserved") {
    const color =
      snapshot === "initialized" ? COLORS.initialized : COLORS.discarded;
    return (
      <circle
        cx={radius * 1.1}
        cy={-radius * 0.75}
        r={5.5}
        fill={color}
        stroke={COLORS.bg}
        strokeWidth={1.5}
      />
    );
  }
  return null;
}

function WarnBadge({ count, radius }: { readonly count: number; readonly radius: number }): JSX.Element {
  return (
    <g transform={`translate(${-radius * 1.1} ${-radius * 0.75})`}>
      <circle r={8} fill={COLORS.warn} stroke={COLORS.bg} strokeWidth={1.5} />
      <text
        textAnchor="middle"
        y={3}
        fontFamily={MONO_STACK}
        fontSize={9}
        fontWeight={700}
        fill="#0B1020"
        pointerEvents="none"
      >
        {count}
      </text>
    </g>
  );
}

function identityFateColor(fate: IdentityFate): string | null {
  switch (fate.kind) {
    case "preserved":
      return null; // quiet for steady state
    case "initialized":
      return COLORS.initialized;
    case "discarded":
      return COLORS.discarded;
    case "renamed":
      return COLORS.accent;
  }
}

function describeNodeFate(node: GraphNode): string {
  const parts: string[] = [`${node.kind}: ${node.name}`];
  if (node.identityFate !== null) {
    const f = node.identityFate;
    switch (f.kind) {
      case "preserved":
        parts.push("identity preserved");
        break;
      case "initialized":
        parts.push(`initialized (${f.reason})`);
        break;
      case "discarded":
        parts.push(`discarded (${f.reason})`);
        break;
      case "renamed":
        parts.push(`renamed from ${f.from}`);
        break;
    }
  }
  if (node.snapshotFate !== undefined) {
    parts.push(`snapshot ${node.snapshotFate}`);
  }
  if (node.warnings.length > 0) {
    parts.push(
      `${node.warnings.length} warning${node.warnings.length === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" · ");
}

type ShapeProps = {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth?: number;
  readonly expand?: number;
  readonly opacity?: number;
  readonly radius: number;
};

function RoundedRectShape({ fill, stroke, strokeWidth = 1, expand = 0, opacity = 1, radius }: ShapeProps): JSX.Element {
  const r = radius + expand;
  return (
    <rect
      x={-r * 1.3}
      y={-r * 0.7}
      width={r * 2.6}
      height={r * 1.4}
      rx={10}
      ry={10}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
}

function PillShape({ fill, stroke, strokeWidth = 1, expand = 0, opacity = 1, radius }: ShapeProps): JSX.Element {
  const w = (radius + expand) * 2.8;
  const h = (radius + expand) * 1.3;
  return (
    <rect
      x={-w / 2}
      y={-h / 2}
      width={w}
      height={h}
      rx={h / 2}
      ry={h / 2}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
}

function HexShape({ fill, stroke, strokeWidth = 1, expand = 0, opacity = 1, radius }: ShapeProps): JSX.Element {
  const r = radius + expand;
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${Math.cos(angle) * r * 1.05},${Math.sin(angle) * r * 0.95}`);
  }
  return (
    <polygon
      points={pts.join(" ")}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
}

function kindColors(kind: GraphNodeKind): { fill: string; stroke: string } {
  switch (kind) {
    case "state":
      return { fill: COLORS.state, stroke: "#1E3A5F" };
    case "computed":
      return { fill: COLORS.computed, stroke: "#3B1F5C" };
    case "action":
      return { fill: COLORS.action, stroke: "#13402A" };
  }
}

function kindGlyph(kind: GraphNodeKind): string {
  switch (kind) {
    case "state":
      return "S";
    case "computed":
      return "ƒ";
    case "action":
      return "A";
  }
}

type EdgeProps = {
  readonly edge: GraphEdge;
  readonly positions: PositionMap;
  readonly radius: number;
  readonly dimmed: boolean;
  readonly emphasized: boolean;
};

function EdgeShape({ edge, positions, radius, dimmed, emphasized }: EdgeProps): JSX.Element | null {
  const s = positions.get(edge.source);
  const t = positions.get(edge.target);
  if (s === undefined || t === undefined) return null;

  const path = curvedPath(s, t, edge, radius);
  const { color, strokeWidth, dash, marker } = edgeStyle(edge.relation);
  const opacity = dimmed ? 0.18 : emphasized ? 1 : 0.8;
  const finalWidth = emphasized ? strokeWidth + 0.5 : strokeWidth;

  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={finalWidth}
      strokeDasharray={dash}
      markerEnd={`url(#${marker})`}
      opacity={opacity}
      style={{ transition: "opacity 120ms ease-out" }}
    />
  );
}

function edgeStyle(relation: GraphEdgeRelation): {
  color: string;
  strokeWidth: number;
  dash: string | undefined;
  marker: string;
} {
  switch (relation) {
    case "feeds":
      return { color: COLORS.textDim, strokeWidth: 1.1, dash: undefined, marker: "arrow-feeds" };
    case "mutates":
      return { color: "#F59E0B", strokeWidth: 1.6, dash: undefined, marker: "arrow-mutates" };
    case "unlocks":
      return { color: COLORS.muted, strokeWidth: 1.1, dash: "4 3", marker: "arrow-unlocks" };
  }
}

function curvedPath(
  s: NodePosition,
  t: NodePosition,
  edge: GraphEdge,
  radius: number,
): string {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return `M ${s.x} ${s.y}`;
  // Trim both endpoints to the node boundary approximation (circle radius)
  const nx = dx / dist;
  const ny = dy / dist;
  const pad = radius + 6;
  const startX = s.x + nx * pad;
  const startY = s.y + ny * pad;
  const endX = t.x - nx * pad;
  const endY = t.y - ny * pad;
  // Quadratic curve with offset perpendicular — slight arc reduces overlaps
  // and gives a directional feel even with bidirectional edges.
  const hash = stringHash(edge.id);
  const side = (hash & 1) === 0 ? 1 : -1;
  const curve = Math.min(40, dist * 0.2) * side;
  const mx = (startX + endX) / 2 - ny * curve;
  const my = (startY + endY) / 2 + nx * curve;
  return `M ${startX} ${startY} Q ${mx} ${my} ${endX} ${endY}`;
}

function stringHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function ArrowMarker({ id, color }: { id: string; color: string }): JSX.Element {
  return (
    <marker
      id={id}
      viewBox="0 -5 10 10"
      refX={9}
      refY={0}
      markerWidth={7}
      markerHeight={7}
      orient="auto-start-reverse"
    >
      <path d="M0,-4 L9,0 L0,4 z" fill={color} />
    </marker>
  );
}

function GridPattern({
  width,
  height,
  view,
}: {
  readonly width: number;
  readonly height: number;
  readonly view: ViewTransform;
}): JSX.Element {
  const size = 24 * view.k;
  const offsetX = (((view.x % size) + size) % size) - size;
  const offsetY = (((view.y % size) + size) % size) - size;
  const dots: JSX.Element[] = [];
  // Render only a sparse dot grid for the visible area. Cap count.
  const cols = Math.ceil((width + size) / size) + 1;
  const rows = Math.ceil((height + size) / size) + 1;
  if (cols * rows < 1500) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        dots.push(
          <circle
            key={`${r}-${c}`}
            cx={offsetX + c * size}
            cy={offsetY + r * size}
            r={0.7}
            fill={COLORS.line}
          />,
        );
      }
    }
  }
  return <g pointerEvents="none">{dots}</g>;
}

function EmptyState({
  width,
  height,
  label,
}: {
  readonly width: number;
  readonly height: number;
  readonly label: string;
}): JSX.Element {
  return (
    <div style={{ ...containerStyle, width, height }}>
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLORS.muted,
          fontFamily: FONT_STACK,
          fontSize: 13,
          background: COLORS.bg,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ZoomChrome({
  view,
  onReset,
  onChange,
}: {
  readonly view: ViewTransform;
  readonly onReset: () => void;
  readonly onChange: (v: ViewTransform) => void;
}): JSX.Element {
  const step = (factor: number): void => {
    onChange({
      x: view.x,
      y: view.y,
      k: clamp(view.k * factor, MIN_SCALE, MAX_SCALE),
    });
  };
  return (
    <div style={zoomChromeStyle}>
      <button type="button" onClick={() => step(1 / 1.2)} style={zoomBtnStyle} aria-label="Zoom out">
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        style={{ ...zoomBtnStyle, minWidth: 48 }}
        aria-label="Reset zoom"
      >
        {Math.round(view.k * 100)}%
      </button>
      <button type="button" onClick={() => step(1.2)} style={zoomBtnStyle} aria-label="Zoom in">
        +
      </button>
    </div>
  );
}

function edgesTouching(model: GraphModel, nodeId: GraphNodeId): Set<string> {
  const touched = new Set<string>();
  touched.add(nodeId);
  for (const e of model.edges) {
    if (e.source === nodeId || e.target === nodeId) {
      touched.add(e.id);
      touched.add(e.source);
      touched.add(e.target);
    }
  }
  return touched;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const containerStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  background: COLORS.bg,
};

const zoomChromeStyle: CSSProperties = {
  position: "absolute",
  bottom: 12,
  right: 12,
  display: "flex",
  gap: 4,
  background: COLORS.panelAlt,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 8,
  padding: 4,
  boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
};

const zoomBtnStyle: CSSProperties = {
  background: "transparent",
  color: COLORS.text,
  border: "none",
  padding: "4px 10px",
  fontFamily: MONO_STACK,
  fontSize: 12,
  cursor: "pointer",
  borderRadius: 4,
  minWidth: 28,
};
