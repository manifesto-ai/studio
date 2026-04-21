import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  GraphModel,
  GraphNode,
} from "@manifesto-ai/studio-react";
import {
  createIntentArgsForValue,
  createInitialFormValue,
  descriptorForAction,
  useStudio,
} from "@manifesto-ai/studio-react";
import { motion } from "motion/react";
import { useFocus } from "@/hooks/useFocus";
import {
  computeFitCamera,
  useViewport,
  zoomAroundPointer,
  MAX_ZOOM,
  MIN_ZOOM,
} from "@/hooks/useViewport";
import { ActionCard, ComputedCard, StateCard } from "./NodeCard";
import { EdgeLayer } from "./EdgeLayer";
import { ActionDispatchPopover } from "./ActionDispatchPopover";
import { formatType } from "./formatValue";
import {
  computeFocusLayout,
  computeLayout,
  type LayoutResult,
  type Rect,
} from "./layout";
import { detectClusters } from "./clusters";
import { useLivePulse } from "./useLivePulse";
import { useSimulationPlayback } from "./useSimulationPlayback";
import { GraphSearch } from "./GraphSearch";

/**
 * LiveGraph — the Observatory renderer.
 *
 * Layout is deterministic (actions top, state left, computed right) but
 * users can drag cards to reposition.  Overrides are kept per-schema
 * in a ref so a rebuild resets layout back to its computed default.
 *
 * `snapshotOverride` lets the host swap in a replayed past snapshot
 * (time scrubbing).  `disableDispatch` suppresses the action popover
 * while scrubbing since we can't dispatch into the past.
 */
export function LiveGraph({
  model,
  snapshotOverride,
  disableDispatch = false,
}: {
  readonly model: GraphModel;
  readonly snapshotOverride?:
    | {
        readonly data?: unknown;
        readonly computed?: Record<string, unknown>;
      }
    | null
    | undefined;
  readonly disableDispatch?: boolean;
}): JSX.Element {
  const {
    module,
    snapshot: liveSnapshot,
    whyNot,
    createIntent,
    simulationPlayback,
  } = useStudio();
  const effectiveSnapshot = snapshotOverride ?? liveSnapshot ?? null;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledPlaybackGenerationRef = useRef<number>(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const { camera, setCamera } = useViewport();
  // Keep a ref to the latest camera so pointer handlers registered once
  // can read current zoom without being re-bound on every tween step.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (el === null) return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      setViewport({ width: r.width, height: r.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // measure() is recreated on every render but ResizeObserver only
    // needs one subscription, so we don't redo this in the return.
    return () => ro.disconnect();
  }, []);

  // --- Wheel pan / ctrl+wheel zoom ------------------------------------
  // Attach natively (not via React's synthetic onWheel) so we can
  // preventDefault — required to suppress native page zoom on
  // ctrl+wheel and page scroll on plain wheel inside the canvas.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const cam = cameraRef.current;
      if (e.ctrlKey || e.metaKey) {
        const hostRect = host.getBoundingClientRect();
        const screenPoint = {
          x: e.clientX - hostRect.left,
          y: e.clientY - hostRect.top,
        };
        // Exponential factor feels uniform across trackpads and mice.
        const factor = Math.exp(-e.deltaY * 0.0015);
        setCamera(zoomAroundPointer(cam, screenPoint, factor));
      } else {
        setCamera({
          tx: cam.tx - e.deltaX,
          ty: cam.ty - e.deltaY,
          k: cam.k,
        });
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [setCamera]);

  const clusters = useMemo(() => detectClusters(model), [model]);
  const baseLayout: LayoutResult = useMemo(
    () =>
      computeLayout(
        model,
        Math.max(viewport.width, 800),
        Math.max(viewport.height, 500),
        clusters,
      ),
    [model, viewport.width, viewport.height, clusters],
  );

  // --- Drag-to-reposition ----------------------------------------------
  //
  // Overrides keyed by `${schemaHash}:${nodeId}` so a rebuild resets them.
  // A small map is enough — we don't persist across sessions (the layout
  // is regenerated deterministically anyway).
  const [overrides, setOverrides] = useState<
    ReadonlyMap<string, { x: number; y: number }>
  >(new Map());
  const overridesKey = (nodeId: GraphNode["id"]): string =>
    `${model.schemaHash}:${nodeId}`;

  useEffect(() => {
    // Drop overrides that no longer belong to this schema hash.
    setOverrides((prev) => {
      let changed = false;
      const next = new Map<string, { x: number; y: number }>();
      for (const [key, val] of prev) {
        if (key.startsWith(`${model.schemaHash}:`)) {
          next.set(key, val);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [model.schemaHash]);

  const layout: LayoutResult = useMemo(() => {
    if (overrides.size === 0) return baseLayout;
    let maxX = baseLayout.canvasWidth;
    let maxY = baseLayout.canvasHeight;
    const merged = new Map<GraphNode["id"], Rect>();
    for (const [id, rect] of baseLayout.bounds) {
      const o = overrides.get(overridesKey(id));
      const finalRect: Rect =
        o === undefined ? rect : { ...rect, x: o.x, y: o.y };
      merged.set(id, finalRect);
      maxX = Math.max(maxX, finalRect.x + finalRect.width + 28);
      maxY = Math.max(maxY, finalRect.y + finalRect.height + 28);
    }
    return { bounds: merged, canvasWidth: maxX, canvasHeight: maxY };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayout, overrides, model.schemaHash]);

  // --- Focus / neighbourhood ------------------------------------------
  // Focus is global (see `useFocus`) so that the Monaco cursor can move
  // the graph's focus and vice versa. Local "which node is focused" is
  // a read-through on that state.
  const { focus, setFocus, clear: clearFocus } = useFocus();
  const focusNodeId: GraphNode["id"] | null =
    focus !== null && focus.kind === "node" ? focus.id : null;
  const focusNode = useCallback(
    (id: GraphNode["id"]): void => {
      setFocus({ kind: "node", id, origin: "graph" });
    },
    [setFocus],
  );
  const toggleFocus = useCallback(
    (id: GraphNode["id"]): void => {
      if (focusNodeId === id) clearFocus();
      else setFocus({ kind: "node", id, origin: "graph" });
    },
    [focusNodeId, setFocus, clearFocus],
  );
  const neighbourhood = useMemo(
    () => computeNeighbourhood(model, focusNodeId),
    [model, focusNodeId],
  );

  // --- Focus subgraph layout ------------------------------------------
  // When a node is focused, compute a secondary clean layout for the
  // focus + 1-hop neighbours, sized to the viewport so it reads without
  // any zoom. Cards animate between their baseLayout rect and the
  // focusLayout rect (FLIP). Nodes not in the focus set stay at their
  // base position but fade out. Edges re-render from the focus
  // subgraph.
  const focusedNodeSet = useMemo<ReadonlySet<GraphNode["id"]>>(() => {
    if (focusNodeId === null) return new Set();
    const out = new Set<GraphNode["id"]>([focusNodeId]);
    for (const id of neighbourhood.nodeIds) out.add(id);
    return out;
  }, [focusNodeId, neighbourhood.nodeIds]);
  const focusedModel = useMemo<GraphModel | null>(() => {
    if (focusNodeId === null) return null;
    const nodes = model.nodes.filter((n) => focusedNodeSet.has(n.id));
    if (nodes.length === 0) return null;
    const edges = model.edges.filter(
      (e) => focusedNodeSet.has(e.source) && focusedNodeSet.has(e.target),
    );
    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    return { schemaHash: model.schemaHash, nodes, edges, nodesById };
  }, [focusNodeId, focusedNodeSet, model]);
  const focusLayout = useMemo<LayoutResult | null>(() => {
    if (focusedModel === null || focusNodeId === null) return null;
    const W = Math.max(viewport.width, 640);
    const H = Math.max(viewport.height, 440);
    return computeFocusLayout(focusedModel, focusNodeId, W, H);
  }, [focusedModel, focusNodeId, viewport.width, viewport.height]);
  const focusActive = focusLayout !== null;
  const effectiveModel: GraphModel = focusedModel ?? model;
  const effectiveLayout: LayoutResult = focusLayout ?? layout;

  const dragStateRef = useRef<{
    nodeId: GraphNode["id"];
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const onNodePointerDown = useCallback(
    (
      node: GraphNode,
      e: React.PointerEvent<HTMLElement>,
    ): void => {
      // Only left button; don't start drag from form inputs or buttons
      // inside the card.
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, input, textarea, select, [role='dialog']"))
        return;
      // Drag is disabled while focus layout is active. The point of
      // focus mode is a clean subgraph presentation; letting the user
      // move cards would immediately defeat that.
      if (focusActive) return;

      const rect = layout.bounds.get(node.id);
      if (rect === undefined) return;

      dragStateRef.current = {
        nodeId: node.id,
        pointerId: e.pointerId,
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        startX: rect.x,
        startY: rect.y,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [layout.bounds, focusActive],
  );

  const onNodePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      const drag = dragStateRef.current;
      if (drag === null || drag.pointerId !== e.pointerId) return;
      // Pointer deltas are screen-space; divide by camera.k to get the
      // matching world-space delta for the card's x/y in layout coords.
      // (React Flow's #1 bug category — don't skip this division.)
      const scale = cameraRef.current.k || 1;
      const dx = (e.clientX - drag.startPointerX) / scale;
      const dy = (e.clientY - drag.startPointerY) / scale;
      if (!drag.moved && Math.hypot(dx, dy) < 4 / scale) return;
      drag.moved = true;
      const nextX = Math.max(0, drag.startX + dx);
      const nextY = Math.max(0, drag.startY + dy);
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(overridesKey(drag.nodeId), { x: nextX, y: nextY });
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.schemaHash],
  );

  const onNodePointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      const drag = dragStateRef.current;
      if (drag === null || drag.pointerId !== e.pointerId) return;
      const moved = drag.moved;
      dragStateRef.current = null;
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
      // If the user dragged, treat the click as consumed — caller
      // should skip its onClick.
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [],
  );

  const wasDraggedSinceLastClickRef = useRef(false);

  // --- Focus camera follow --------------------------------------------
  // With focus subgraph re-layout enabled, the focus layout is already
  // sized to the viewport — so the camera stays at identity. We only
  // touch the camera on focus enter / exit transitions, not on every
  // re-focus within a session.
  const lastFocusActiveRef = useRef<boolean>(false);
  useEffect(() => {
    if (focusActive === lastFocusActiveRef.current) return;
    lastFocusActiveRef.current = focusActive;
    setCamera({ tx: 0, ty: 0, k: 1 }, { animate: true });
  }, [focusActive, setCamera]);

  // --- Propagation pulse ----------------------------------------------
  const livePulse = useLivePulse(model);
  const simulatePulse = useSimulationPlayback(model, simulationPlayback, {
    disabled: disableDispatch,
  });
  const livePulsingEdgeIds = useMemo(() => {
    if (livePulse.touched.size === 0) return new Set<string>();
    const ids = new Set<string>();
    for (const edge of model.edges) {
      if (
        livePulse.touched.has(edge.source) &&
        livePulse.touched.has(edge.target)
      ) {
        ids.add(edge.id);
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePulse.generation, livePulse.touched, model.edges]);
  const pulsingEdgeIds = useMemo(() => {
    if (
      livePulsingEdgeIds.size === 0 &&
      simulatePulse.activeEdges.size === 0
    ) {
      return new Set<string>();
    }
    const ids = new Set<string>(livePulsingEdgeIds);
    for (const edgeId of simulatePulse.activeEdges) {
      ids.add(edgeId);
    }
    return ids;
  }, [livePulsingEdgeIds, simulatePulse.activeEdges]);

  useEffect(() => {
    if (disableDispatch) return;
    if (simulatePulse.generation === 0 || simulatePulse.originAction === null) {
      return;
    }
    if (lastScrolledPlaybackGenerationRef.current === simulatePulse.generation) {
      return;
    }
    const host = hostRef.current;
    const originRect = layout.bounds.get(simulatePulse.originAction);
    if (host === null || originRect === undefined) return;
    // Fit the origin action + touched downstream nodes in the camera.
    // Falls back to just the origin rect if the pulse hasn't populated
    // yet (first frame of a new generation).
    let minX = originRect.x;
    let minY = originRect.y;
    let maxX = originRect.x + originRect.width;
    let maxY = originRect.y + originRect.height;
    for (const id of simulatePulse.activeNodes) {
      const r = layout.bounds.get(id);
      if (r === undefined) continue;
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    const target = computeFitCamera(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      { width: host.clientWidth, height: host.clientHeight },
      { padding: 96 },
    );
    lastScrolledPlaybackGenerationRef.current = simulatePulse.generation;
    setCamera(target, { animate: true });
  }, [
    disableDispatch,
    layout.bounds,
    simulatePulse.generation,
    simulatePulse.originAction,
    simulatePulse.activeNodes,
    setCamera,
  ]);

  // --- Action dispatch popover ----------------------------------------
  const [popoverAction, setPopoverAction] = useState<{
    readonly name: string;
    readonly anchor: HTMLElement;
  } | null>(null);
  const closePopover = useCallback(() => setPopoverAction(null), []);

  // Reset transient UI on schema change. Focus is cleared too — node
  // ids are schema-scoped, so the old focus target may not exist any
  // more after a rebuild.
  useEffect(() => {
    setPopoverAction(null);
    clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.schemaHash]);

  // Close popover when dispatching is disabled (past mode)
  useEffect(() => {
    if (disableDispatch) setPopoverAction(null);
  }, [disableDispatch]);

  // Close popover whenever focus enters / exits. The anchor DOM moves
  // with the card's FLIP animation and Radix Popover does NOT auto-
  // update its floating position — so the popover would visually stay
  // pinned to the anchor's old viewport coords until the next toggle.
  // Clean-close beats a stuck popover. The user can re-open at the
  // new location by clicking the action card again in focus mode.
  useEffect(() => {
    setPopoverAction(null);
  }, [focusActive]);

  // --- Search / filter (G6) -------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const matchedNodeIds: ReadonlySet<GraphNode["id"]> | null = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!searchOpen || trimmed === "") return null;
    const q = trimmed.toLowerCase();
    const out = new Set<GraphNode["id"]>();
    for (const node of model.nodes) {
      if (fuzzyMatch(node.name, q) || fuzzyMatch(node.kind, q)) {
        out.add(node.id);
      }
    }
    return out;
  }, [searchOpen, searchQuery, model.nodes]);

  // Type-anywhere: start search on any printable key (unless an input
  // already has focus or the user pressed a modifier).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          (target as HTMLElement).isContentEditable);
      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
        } else {
          clearFocus();
          setPopoverAction(null);
        }
        return;
      }
      if (inField) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Cmd/Ctrl+F opens search explicitly
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "/" || (e.key.length === 1 && /^[a-zA-Z0-9]$/.test(e.key))) {
        if (!searchOpen) {
          setSearchOpen(true);
          setSearchQuery(e.key === "/" ? "" : e.key);
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  // --- Dispatchability (live only — past mode hides this) --------------
  const actionDispatchability = useMemo(() => {
    const map = new Map<
      string,
      { readonly dispatchable: boolean; readonly blockerCount: number }
    >();
    if (module === null || disableDispatch) return map;
    for (const node of model.nodes) {
      if (node.kind !== "action") continue;
      try {
        const descriptor = descriptorForAction(module.schema, node.name);
        const defaults =
          descriptor === null
            ? undefined
            : createInitialFormValue(descriptor, { sparseOptional: true });
        const intent = createIntent(
          node.name,
          ...createIntentArgsForValue(descriptor, defaults),
        );
        const blockers = whyNot(intent);
        if (blockers === null || blockers.length === 0) {
          map.set(node.id, { dispatchable: true, blockerCount: 0 });
        } else {
          map.set(node.id, {
            dispatchable: false,
            blockerCount: blockers.length,
          });
        }
      } catch {
        map.set(node.id, { dispatchable: false, blockerCount: 0 });
      }
    }
    return map;
  }, [
    model.nodes,
    module,
    liveSnapshot,
    whyNot,
    createIntent,
    disableDispatch,
  ]);

  const handleNodeActivate = useCallback(
    (node: GraphNode, el: HTMLElement) => {
      if (wasDraggedSinceLastClickRef.current) {
        wasDraggedSinceLastClickRef.current = false;
        return;
      }
      if (node.kind === "action" && !disableDispatch) {
        setPopoverAction({ name: node.name, anchor: el });
        focusNode(node.id);
      } else {
        toggleFocus(node.id);
      }
    },
    [disableDispatch, focusNode, toggleFocus],
  );

  const handleBackgroundClick = useCallback(() => {
    clearFocus();
    setPopoverAction(null);
  }, [clearFocus]);

  const searchActive = searchOpen && searchQuery.trim() !== "";
  const dimmed = focusNodeId !== null || searchActive;

  return (
    <>
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleBackgroundClick();
      }}
      data-zoom-state={camera.k < 0.5 ? "low" : "normal"}
    >
      <div
        className="relative"
        style={{
          width: effectiveLayout.canvasWidth,
          height: effectiveLayout.canvasHeight,
          transform: `translate3d(${camera.tx}px, ${camera.ty}px, 0) scale(${camera.k})`,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) handleBackgroundClick();
        }}
      >
        {/* Cluster boundaries — subtle dashed rectangles behind the
         * state+computed columns. Hidden while focus layout is active
         * (clusters don't map onto the focus sub-graph). */}
        {!focusActive && effectiveLayout.clusterRects?.map((r) => (
          <div
            key={r.clusterId}
            aria-hidden
            style={{
              position: "absolute",
              left: r.x,
              top: r.y,
              width: r.width,
              height: r.height,
              borderRadius: 12,
              border: "1px dashed color-mix(in oklch, var(--color-violet) 30%, transparent)",
              pointerEvents: "none",
              opacity: 0.65,
            }}
          />
        ))}

        <EdgeLayer
          model={effectiveModel}
          layout={effectiveLayout}
          highlightedEdgeIds={neighbourhood.edgeIds}
          pulsingEdgeIds={pulsingEdgeIds}
          dimmed={dimmed}
          focusActive={focusActive}
        />

        {model.nodes.map((node) => {
          // In focus mode, non-focused nodes stay at their baseLayout
          // position (so they fade out in place), focused nodes use
          // the fresh subgraph rect. Out of focus, everyone uses the
          // merged baseLayout+overrides rect.
          const inFocus = focusActive && focusedNodeSet.has(node.id);
          const rect = inFocus
            ? effectiveLayout.bounds.get(node.id)
            : layout.bounds.get(node.id);
          if (rect === undefined) return null;
          const focused = focusNodeId === node.id;
          const focusOk =
            focusNodeId === null ||
            node.id === focusNodeId ||
            neighbourhood.nodeIds.has(node.id);
          const searchOk =
            matchedNodeIds === null || matchedNodeIds.has(node.id);
          const highlighted = focusOk && searchOk;
          const pulsing =
            livePulse.touched.has(node.id) ||
            simulatePulse.activeNodes.has(node.id);
          // In focus mode, non-focused cards fade out in place and stop
          // responding to pointer events — they're context, not targets.
          const faded = focusActive && !focusedNodeSet.has(node.id);
          const interactive = !faded;
          const commonHandlers = {
            faded,
            interactive,
            onPointerDown: (e: React.PointerEvent<HTMLElement>) =>
              onNodePointerDown(node, e),
            onPointerMove: onNodePointerMove,
            onPointerUp: onNodePointerUp,
            onActivate: (el: HTMLElement) => handleNodeActivate(node, el),
            // Double-click routes to Focus (origin=graph). `useFocusSync`
            // then reveals + pulses the span in Monaco. For action cards
            // this path is handy: single=popover, double=jump to source.
            onRevealSource: () => focusNode(node.id),
          };

          if (node.kind === "state") {
            const typeLabel = typeOfStateField(module, node.name);
            const typeDef = typeDefOfStateField(module, node.name);
            const value = (
              effectiveSnapshot?.data as Record<string, unknown> | undefined
            )?.[node.name];
            return (
              <InteractiveCard
                key={node.id}
                nodeId={node.id}
                rect={rect}
                {...commonHandlers}
              >
                <StateCard
                  id={node.id}
                  name={node.name}
                  typeLabel={typeLabel}
                  typeDef={typeDef}
                  value={value}
                  rect={rect}
                  highlighted={highlighted}
                  focused={focused}
                  pulsing={pulsing}
                />
              </InteractiveCard>
            );
          }
          if (node.kind === "computed") {
            const typeLabel = typeOfComputed(module, node.name);
            const typeDef = typeDefOfComputed(module, node.name);
            const value = effectiveSnapshot?.computed?.[node.name];
            return (
              <InteractiveCard
                key={node.id}
                nodeId={node.id}
                rect={rect}
                {...commonHandlers}
              >
                <ComputedCard
                  id={node.id}
                  name={node.name}
                  typeLabel={typeLabel}
                  typeDef={typeDef}
                  value={value}
                  rect={rect}
                  highlighted={highlighted}
                  focused={focused}
                  pulsing={pulsing}
                />
              </InteractiveCard>
            );
          }
          // action
          const info = actionDispatchability.get(node.id);
          const descriptor =
            module === null
              ? null
              : descriptorForAction(module.schema, node.name);
          const argLabel = describeActionArg(descriptor, node.name);
          return (
            <InteractiveCard
              key={node.id}
              nodeId={node.id}
              rect={rect}
              {...commonHandlers}
            >
              <ActionCard
                id={node.id}
                name={node.name}
                argLabel={argLabel}
                dispatchable={disableDispatch ? null : info?.dispatchable ?? null}
                blockerCount={info?.blockerCount ?? 0}
                rect={rect}
                highlighted={highlighted}
                focused={focused}
                pulsing={pulsing}
              />
            </InteractiveCard>
          );
        })}
      </div>

      {popoverAction !== null && !disableDispatch && (
        <ActionDispatchPopover
          actionName={popoverAction.name}
          anchor={popoverAction.anchor}
          open
          onOpenChange={(next) => {
            if (!next) closePopover();
          }}
        />
      )}
    </div>
    <GraphSearch
      open={searchOpen}
      query={searchQuery}
      onQueryChange={setSearchQuery}
      onClose={() => {
        setSearchOpen(false);
        setSearchQuery("");
      }}
      matchCount={matchedNodeIds?.size ?? 0}
    />
    </>
  );
}

// --------------------------------------------------------------------
// InteractiveCard — wraps a NodeCard with pointer handlers for drag
// and click. Provides the anchor element used by the dispatch popover.
// --------------------------------------------------------------------

function InteractiveCard({
  nodeId,
  rect,
  faded,
  interactive,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onActivate,
  onRevealSource,
  children,
}: {
  readonly nodeId: string;
  readonly rect: Rect;
  /** Non-focused nodes in focus mode: keep in place but fade out. */
  readonly faded: boolean;
  /** Pointer interactivity disabled for fading-out cards. */
  readonly interactive: boolean;
  readonly onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onActivate: (el: HTMLElement) => void;
  readonly onRevealSource: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // motion.div animates `x`, `y`, `width`, `height`, and `opacity`
  // whenever the rect / faded props change, giving us FLIP transitions
  // into and out of focus-layout positions for free.
  return (
    <motion.div
      ref={wrapperRef}
      data-interactive-card-id={nodeId}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
      onClick={
        interactive
          ? (e) => {
              const t = e.target as HTMLElement;
              if (
                t.closest("button, input, textarea, select, [role='dialog']")
              )
                return;
              const el = (wrapperRef.current ??
                (t.closest("[data-node-id]") as HTMLElement | null)) as HTMLElement | null;
              if (el !== null) onActivate(el);
            }
          : undefined
      }
      onDoubleClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              onRevealSource();
            }
          : undefined
      }
      initial={false}
      animate={{
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        opacity: faded ? 0 : 1,
      }}
      transition={{
        // Layout changes use a critically-damped-ish spring so enter
        // settles cleanly without overshoot and exit feels organic
        // rather than mechanical. Opacity tweens separately on a
        // shorter linear so fading cards don't "hold on" visually.
        x: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
        y: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
        width: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
        height: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
        opacity: { duration: 0.22, ease: "easeOut" },
      }}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        touchAction: "none",
        cursor: interactive ? "grab" : "default",
        pointerEvents: faded ? "none" : undefined,
      }}
    >
      {children}
    </motion.div>
  );
}

// --------------------------------------------------------------------
// Schema introspection helpers
// --------------------------------------------------------------------

function typeOfStateField(
  module: ReturnType<typeof useStudio>["module"],
  name: string,
): string {
  if (module === null) return "";
  // Prefer the TypeDefinition (newer IR) so unions and arrays render
  // with proper wrapping.
  const def = typeDefOfStateField(module, name);
  if (def !== undefined) {
    const label = formatType(def);
    if (label !== "") return label;
  }
  const field = module.schema.state?.fields?.[name] as
    | { readonly type?: unknown }
    | undefined;
  if (field === undefined) return "";
  if (typeof field.type === "string") return field.type;
  return "";
}

function typeOfComputed(
  module: ReturnType<typeof useStudio>["module"],
  name: string,
): string {
  if (module === null) return "derived";
  const spec = module.schema.computed?.[name];
  if (spec === undefined) return "derived";
  if ((spec as { returnType?: unknown }).returnType !== undefined) {
    return formatType((spec as { returnType: unknown }).returnType);
  }
  return "derived";
}

function typeDefOfStateField(
  module: ReturnType<typeof useStudio>["module"],
  name: string,
): unknown {
  if (module === null) return undefined;
  const state = module.schema.state as
    | {
        readonly fieldTypes?: Record<string, unknown>;
        readonly fields?: Record<string, unknown>;
      }
    | undefined;
  // Newer IR carries a fieldTypes map with TypeDefinition nodes.
  const fromNewIR = state?.fieldTypes?.[name];
  if (fromNewIR !== undefined) return fromNewIR;
  // Older FieldSpec shape: { type: "string" | { enum: [...] }, ... }.
  // Adapt enum-style types back to TypeDefinition so ValueView's
  // enum extraction has a single code path.
  const field = state?.fields?.[name] as
    | { readonly type?: unknown; readonly typeDef?: unknown }
    | undefined;
  if (field === undefined) return undefined;
  if (field.typeDef !== undefined) return field.typeDef;
  const t = field.type;
  if (
    t !== null &&
    typeof t === "object" &&
    Array.isArray((t as { enum?: unknown[] }).enum)
  ) {
    const options = (t as { enum: unknown[] }).enum;
    return {
      kind: "union",
      types: options.map((v) => ({ kind: "literal", value: v })),
    };
  }
  return undefined;
}

function typeDefOfComputed(
  module: ReturnType<typeof useStudio>["module"],
  name: string,
): unknown {
  if (module === null) return undefined;
  // Computed can be either the raw record OR a { fields: {...} } wrapper
  // depending on IR generation; probe both.
  const computed = module.schema.computed as
    | Record<string, unknown>
    | { readonly fields?: Record<string, unknown> }
    | undefined;
  const spec =
    (computed as Record<string, unknown>)?.[name] ??
    (computed as { fields?: Record<string, unknown> })?.fields?.[name];
  if (spec === undefined || spec === null || typeof spec !== "object")
    return undefined;
  const s = spec as { readonly returnType?: unknown; readonly type?: unknown };
  return s.returnType ?? s.type;
}

function describeActionArg(
  descriptor: ReturnType<typeof descriptorForAction>,
  name: string,
): string {
  if (descriptor === null) return `${name}()`;
  switch (descriptor.kind) {
    case "object":
      if (descriptor.fields.length === 0) return `${name}()`;
      return `${name}({ ${descriptor.fields.map((f) => f.name).join(", ")} })`;
    case "string":
      return `${name}(string)`;
    case "number":
      return `${name}(number)`;
    case "boolean":
      return `${name}(bool)`;
    case "enum":
      return `${name}(${descriptor.options.map((o) => JSON.stringify(o.value)).slice(0, 2).join("|")}${descriptor.options.length > 2 ? "…" : ""})`;
    default:
      return `${name}(${descriptor.kind})`;
  }
}

function computeNeighbourhood(
  model: GraphModel,
  focusId: GraphNode["id"] | null,
): {
  readonly nodeIds: ReadonlySet<GraphNode["id"]>;
  readonly edgeIds: ReadonlySet<string>;
} {
  if (focusId === null) {
    return { nodeIds: new Set(), edgeIds: new Set() };
  }
  const nodeIds = new Set<GraphNode["id"]>([focusId]);
  const edgeIds = new Set<string>();
  for (const edge of model.edges) {
    if (edge.source === focusId) {
      nodeIds.add(edge.target);
      edgeIds.add(edge.id);
    } else if (edge.target === focusId) {
      nodeIds.add(edge.source);
      edgeIds.add(edge.id);
    }
  }
  return { nodeIds, edgeIds };
}

/**
 * Simple subsequence fuzzy match — characters in `query` appear in
 * order in `text`.  Good enough for node-name searches where the
 * namespace is small.
 */
function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}
