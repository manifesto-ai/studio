import { useMemo } from "react";
import { motion } from "motion/react";
import type { GraphModel } from "@manifesto-ai/studio-react";
import type { LayoutResult } from "./layout";
import type { ClusterMap } from "./clusters";
import { orthogonalPortRouter, type EdgeRouter } from "./edge-router";

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
  clusters,
  bundlingEnabled = false,
  router = orthogonalPortRouter,
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
  readonly clusters?: ClusterMap;
  /** Turn bundling off to force straight routing everywhere (e.g. focus mode). */
  readonly bundlingEnabled?: boolean;
  /**
   * Routing strategy. Default is `orthogonalPortRouter` — smoothstep
   * (right-angle segments with rounded corners), using cluster ports
   * as the bundling rendezvous. Swap in `dagreRouter` / `elkRouter`
   * etc. without touching this layer.
   */
  readonly router?: EdgeRouter;
}): JSX.Element {
  const routing = useMemo(
    () =>
      router({
        model,
        layout,
        clusters,
        options: { bundling: bundlingEnabled },
      }),
    [router, model, layout, clusters, bundlingEnabled],
  );
  const edgeById = useMemo(() => {
    const m = new Map<string, GraphModel["edges"][number]>();
    for (const e of model.edges) m.set(e.id, e);
    return m;
  }, [model.edges]);

  // Which edges are members of which bundle — used to dim a trunk when
  // a highlighted edge passes through it (neighbourhood focus), and to
  // brighten it on hover. We derive from classification via `hint`.
  const trunkHighlighted = useMemo(() => {
    const highlightedBundles = new Set<string>();
    // Highlighted trunks = trunks whose bundled edge is highlighted.
    // Cheap: for each route with hint bundle-leaf, check if its edge
    // is highlighted, then mark its cluster-pair key.
    // We can't recover the pair key from a leaf route directly, but we
    // can infer from the model + clusters we already have in closure.
    if (clusters === undefined) return highlightedBundles;
    for (const edge of model.edges) {
      if (!highlightedEdgeIds.has(edge.id)) continue;
      const srcCluster = clusters.byNode.get(edge.source);
      const tgtCluster = clusters.byNode.get(edge.target);
      if (
        srcCluster === undefined ||
        tgtCluster === undefined ||
        srcCluster === tgtCluster
      ) {
        continue;
      }
      highlightedBundles.add(`trunk:${srcCluster}|${tgtCluster}`);
    }
    return highlightedBundles;
  }, [clusters, highlightedEdgeIds, model.edges]);

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
      {/* Trunks — aggregate "river" per cluster pair with ≥2 edges.
       * Rendered beneath the individual edges so leaves sit on top of
       * the river. Thickness scales with edgeCount, colour uses the
       * bundle's dominant relation's hot tone. */}
      <g>
        {routing.trunks.map((trunk) => {
          const rel = trunk.dominantRelation as EdgeRelation;
          const style = RELATION_STYLES[rel];
          const isHighlighted = trunkHighlighted.has(trunk.id);
          // Log-scaled width so a 10-edge bundle doesn't blow up too
          // much relative to a 2-edge bundle.
          const width = Math.min(
            8,
            2.4 + Math.log2(1 + trunk.edgeCount) * 1.6,
          );
          return (
            <path
              key={trunk.id}
              d={trunk.d}
              fill="none"
              stroke={style.hot}
              strokeWidth={width}
              strokeLinecap="round"
              style={{
                opacity: isHighlighted
                  ? 0.85
                  : dimmed
                    ? 0.22
                    : 0.45,
                transition: "opacity 180ms, stroke-width 180ms",
                filter: isHighlighted
                  ? `drop-shadow(0 0 10px ${style.hot})`
                  : undefined,
              }}
            />
          );
        })}
      </g>
      <g>
        {routing.edges.map((route) => {
          const edge = edgeById.get(route.edgeId);
          if (edge === undefined) return null;
          const d = route.d;
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
                <>
                  {/* Leading wavefront — bright, thick head that
                    * traces along the edge path. Layered over a fading
                    * "afterglow" trail (next motion.path) so the
                    * energy reads as a comet rather than a single
                    * brief flash. */}
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={style.hot}
                    strokeWidth={3.6}
                    strokeLinecap="round"
                    initial={{ pathLength: 0, opacity: 1 }}
                    animate={{ pathLength: 1, opacity: 0 }}
                    transition={{ duration: 0.78, ease: [0.25, 0.75, 0.3, 1] }}
                    style={{
                      filter: `drop-shadow(0 0 14px ${style.hot}) drop-shadow(0 0 4px ${style.hot})`,
                    }}
                  />
                  {/* Afterglow — soft, wide halo that lingers slightly
                    * past the wavefront for the "trail" effect. */}
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={style.hot}
                    strokeWidth={7}
                    strokeLinecap="round"
                    initial={{ pathLength: 0, opacity: 0.35 }}
                    animate={{ pathLength: 1, opacity: 0 }}
                    transition={{ duration: 1.1, ease: [0.3, 0.55, 0.3, 1] }}
                    style={{
                      filter: `blur(3px)`,
                      mixBlendMode: "screen",
                    }}
                  />
                </>
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
