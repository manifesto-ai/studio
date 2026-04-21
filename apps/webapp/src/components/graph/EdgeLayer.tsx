import { useMemo } from "react";
import { motion } from "motion/react";
import type { GraphEdge, GraphModel } from "@manifesto-ai/studio-react";
import { attachPoint, edgePath, type LayoutResult } from "./layout";

type EdgeRelation = "feeds" | "mutates" | "unlocks";

const RELATION_STYLES: Record<
  EdgeRelation,
  {
    base: string;
    hot: string;
    dashed: boolean;
    marker: string;
  }
> = {
  mutates: {
    base: "color-mix(in oklch, var(--color-sig-action) 75%, transparent)",
    hot: "var(--color-sig-action)",
    dashed: false,
    marker: "arrow-mutates",
  },
  feeds: {
    base: "color-mix(in oklch, var(--color-sig-computed) 60%, transparent)",
    hot: "var(--color-sig-computed)",
    dashed: false,
    marker: "arrow-feeds",
  },
  unlocks: {
    base: "color-mix(in oklch, var(--color-sig-state) 40%, transparent)",
    hot: "var(--color-sig-state)",
    dashed: true,
    marker: "arrow-unlocks",
  },
};

export function EdgeLayer({
  model,
  layout,
  highlightedEdgeIds,
  pulsingEdgeIds,
  dimmed,
  focusActive = false,
}: {
  readonly model: GraphModel;
  readonly layout: LayoutResult;
  readonly highlightedEdgeIds: ReadonlySet<string>;
  readonly pulsingEdgeIds: ReadonlySet<string>;
  readonly dimmed: boolean;
  /**
   * When true, the caller has swapped `model` / `layout` to the focus
   * subgraph. We key the outer SVG on this bool so the whole edge
   * layer remounts and re-renders with an `initial` opacity animation
   * — a clean fade-swap instead of jittery path jumps.
   */
  readonly focusActive?: boolean;
}): JSX.Element {
  const paths = useMemo(() => {
    const out: {
      readonly edge: GraphEdge;
      readonly d: string;
    }[] = [];
    for (const edge of model.edges) {
      const source = layout.bounds.get(edge.source);
      const target = layout.bounds.get(edge.target);
      if (source === undefined || target === undefined) continue;
      const sourceCenter = {
        x: source.x + source.width / 2,
        y: source.y + source.height / 2,
      };
      const targetCenter = {
        x: target.x + target.width / 2,
        y: target.y + target.height / 2,
      };
      const fromPoint = attachPoint(source, targetCenter.x, targetCenter.y);
      const toPoint = attachPoint(target, sourceCenter.x, sourceCenter.y);
      out.push({ edge, d: edgePath(fromPoint, toPoint) });
    }
    return out;
  }, [layout, model.edges]);

  return (
    <motion.svg
      key={focusActive ? "focus" : "base"}
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      width={layout.canvasWidth}
      height={layout.canvasHeight}
      viewBox={`0 0 ${layout.canvasWidth} ${layout.canvasHeight}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <defs>
        <ArrowMarker id="arrow-mutates" color="var(--color-sig-action)" />
        <ArrowMarker id="arrow-feeds" color="var(--color-sig-computed)" />
        <ArrowMarker id="arrow-unlocks" color="var(--color-sig-state)" />
      </defs>
      <g>
        {paths.map(({ edge, d }) => {
          const style = RELATION_STYLES[edge.relation as EdgeRelation];
          const highlighted = highlightedEdgeIds.has(edge.id);
          const pulsing = pulsingEdgeIds.has(edge.id);
          return (
            <g key={edge.id}>
              <path
                d={d}
                fill="none"
                stroke={highlighted ? style.hot : style.base}
                strokeWidth={highlighted ? 1.5 : 1}
                strokeDasharray={style.dashed ? "3 4" : undefined}
                style={{
                  opacity: dimmed && !highlighted ? 0.2 : 1,
                  transition: "stroke 150ms, stroke-width 150ms, opacity 150ms",
                  filter: highlighted
                    ? `drop-shadow(0 0 6px ${style.hot})`
                    : undefined,
                }}
                markerEnd={`url(#${style.marker})`}
              />
              {pulsing && (
                <motion.path
                  d={d}
                  fill="none"
                  stroke={style.hot}
                  strokeWidth={2.25}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0.9 }}
                  animate={{ pathLength: 1, opacity: 0 }}
                  transition={{ duration: 0.7, ease: [0.3, 0.6, 0.3, 1] }}
                  style={{
                    filter: `drop-shadow(0 0 8px ${style.hot})`,
                  }}
                />
              )}
            </g>
          );
        })}
      </g>
    </motion.svg>
  );
}

function ArrowMarker({
  id,
  color,
}: {
  readonly id: string;
  readonly color: string;
}): JSX.Element {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="8"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
      markerUnits="userSpaceOnUse"
    >
      <path d="M 0 0 L 10 5 L 0 10 Z" fill={color} opacity="0.85" />
    </marker>
  );
}
