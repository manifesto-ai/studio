import {
  memo,
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
  FONT_STACK,
  MONO_STACK,
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
import { PlaybackControlBar } from "./PlaybackControlBar";
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
    core,
    module,
    snapshot: liveSnapshot,
    whyNot,
    createIntent,
    simulation,
    exitSimulation,
  } = useStudio();
  const simulationPlayback = simulation?.playback ?? null;
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

  // Which clusters the user has collapsed. Collapsing re-homes every
  // member rect to the cluster centre so cards converge into a single
  // supernode overlay (FLIP carries them); edges still resolve
  // correctly because endpoints share the supernode's rect.
  const [collapsedClusters, setCollapsedClusters] = useState<
    ReadonlySet<string>
  >(new Set());
  // Drop collapsed state when the schema changes — cluster ids are
  // schema-scoped and may not match after a rebuild.
  useEffect(() => {
    setCollapsedClusters((prev) => (prev.size === 0 ? prev : new Set()));
  }, [model.schemaHash]);

  const layout: LayoutResult = useMemo(() => {
    if (overrides.size === 0 && collapsedClusters.size === 0) return baseLayout;
    let maxX = baseLayout.canvasWidth;
    let maxY = baseLayout.canvasHeight;
    const merged = new Map<GraphNode["id"], Rect>();

    // Resolve collapsed cluster centres once.
    const collapsedCentres = new Map<string, { x: number; y: number }>();
    if (collapsedClusters.size > 0) {
      for (const r of baseLayout.clusterRects ?? []) {
        if (collapsedClusters.has(r.clusterId)) {
          collapsedCentres.set(r.clusterId, {
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
          });
        }
      }
    }

    for (const [id, rect] of baseLayout.bounds) {
      const clusterId = clusters.byNode.get(id);
      const centre =
        clusterId !== undefined ? collapsedCentres.get(clusterId) : undefined;
      let finalRect: Rect;
      if (centre !== undefined) {
        // Homed to cluster centre so the cards converge visually.
        finalRect = {
          x: centre.x - rect.width / 2,
          y: centre.y - rect.height / 2,
          width: rect.width,
          height: rect.height,
        };
      } else {
        const o = overrides.get(overridesKey(id));
        finalRect = o === undefined ? rect : { ...rect, x: o.x, y: o.y };
      }
      merged.set(id, finalRect);
      maxX = Math.max(maxX, finalRect.x + finalRect.width + 28);
      maxY = Math.max(maxY, finalRect.y + finalRect.height + 28);
    }
    return {
      bounds: merged,
      canvasWidth: maxX,
      canvasHeight: maxY,
      clusterRects: baseLayout.clusterRects,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayout, overrides, collapsedClusters, clusters, model.schemaHash]);

  // --- Focus / neighbourhood ------------------------------------------
  // Focus is global (see `useFocus`) so that the Monaco cursor can move
  // the graph's focus and vice versa. Local "which node is focused" is
  // a read-through on that state.
  const { focus, setFocus, clear: clearFocus } = useFocus();
  const focusNodeId: GraphNode["id"] | null =
    focus !== null && focus.kind === "node" ? focus.id : null;

  // Auto-exit simulation when the user focuses a different node. A
  // simulation session was opened against a specific intent + its
  // projected propagation; switching attention to another part of the
  // graph means that context is no longer what the user is asking
  // about, so the playback bar should disappear. The ref tracks the
  // last focused id across renders so we fire only on actual focus
  // transitions, not on every parent re-render.
  const lastFocusIdForSimRef = useRef<GraphNode["id"] | null>(focusNodeId);
  useEffect(() => {
    if (lastFocusIdForSimRef.current === focusNodeId) return;
    lastFocusIdForSimRef.current = focusNodeId;
    if (simulation !== null) exitSimulation("focus-changed");
  }, [focusNodeId, simulation, exitSimulation]);

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
  // Simulation playback controller must be instantiated before the
  // focused-subgraph memo so the subgraph can include playback step
  // nodes (keeps propagation path visible while focus is active).
  const simulateController = useSimulationPlayback(model, simulationPlayback, {
    disabled: disableDispatch,
  });

  const focusedNodeSet = useMemo<ReadonlySet<GraphNode["id"]>>(() => {
    if (focusNodeId === null) return new Set();
    const out = new Set<GraphNode["id"]>([focusNodeId]);
    for (const id of neighbourhood.nodeIds) out.add(id);
    // Union playback step nodes so focus mode can still render the
    // propagation path for a running simulation without forcing the
    // user to exit focus. The focus layout grows to accommodate.
    for (const step of simulateController.steps) out.add(step.nodeId);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, neighbourhood.nodeIds, simulateController.steps]);
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
      nodeId: GraphNode["id"],
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

      const rect = layout.bounds.get(nodeId);
      if (rect === undefined) return;

      dragStateRef.current = {
        nodeId,
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
    const wasActive = lastFocusActiveRef.current;
    lastFocusActiveRef.current = focusActive;
    if (!focusActive) {
      // Focus cleared — return to identity camera.
      if (wasActive) {
        setCamera({ tx: 0, ty: 0, k: 1 }, { animate: true });
      }
      return;
    }
    const host = hostRef.current;
    if (host === null || focusLayout === null) return;
    // Fit the entire focus-layout bounding box into the viewport so
    // dense neighbourhoods zoom out instead of overlapping. Canvas
    // grows with neighbour count (see computeFocusLayout), and
    // semantic zoom handles text legibility at low k.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const rect of focusLayout.bounds.values()) {
      if (rect.x < minX) minX = rect.x;
      if (rect.y < minY) minY = rect.y;
      if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
      if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
    }
    if (!Number.isFinite(minX)) return;
    const next = computeFitCamera(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      { width: host.clientWidth, height: host.clientHeight },
      { padding: 48 },
    );
    setCamera(next, { animate: true });
  }, [focusActive, focusLayout, setCamera]);

  // --- Propagation pulse ----------------------------------------------
  const livePulse = useLivePulse(model);
  const simulatePulse = simulateController.pulse;
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
    if (focusActive) return; // focus fit owns the camera in focus mode
    if (simulatePulse.generation === 0) return;
    if (simulateController.steps.length === 0) return;
    if (lastScrolledPlaybackGenerationRef.current === simulatePulse.generation) {
      return;
    }
    const host = hostRef.current;
    if (host === null) return;

    // Fit the full propagation path at generation boundary. Using the
    // static `steps` list (not the live `activeNodes`) keeps the camera
    // pinned for the entire playback — the previous implementation fit
    // whichever set of active nodes the current pulse carried, which
    // for step 0 is a single origin-action card → extreme zoom-in.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const addRect = (id: GraphNode["id"] | null): void => {
      if (id === null) return;
      const r = layout.bounds.get(id);
      if (r === undefined) return;
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    };
    addRect(simulatePulse.originAction);
    for (const step of simulateController.steps) addRect(step.nodeId);
    if (!Number.isFinite(minX)) return;

    const target = computeFitCamera(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      { width: host.clientWidth, height: host.clientHeight },
      { padding: 96 },
    );
    lastScrolledPlaybackGenerationRef.current = simulatePulse.generation;
    setCamera(target, { animate: true });
  }, [
    disableDispatch,
    focusActive,
    layout.bounds,
    simulatePulse.generation,
    simulatePulse.originAction,
    simulateController.steps,
    setCamera,
  ]);

  // Reset focus on schema change — node ids are schema-scoped.
  useEffect(() => {
    clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.schemaHash]);

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
        // Priority order for Esc: close the most "current" overlay
        // first so repeated Esc peels back through the UI like
        // onion layers — search > simulation > focus selection.
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
        } else if (simulation !== null) {
          exitSimulation("user-close");
        } else {
          clearFocus();
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
  }, [searchOpen, simulation, exitSimulation, clearFocus]);

  // --- Action surface readiness (live only — past mode hides this) -----
  //
  // Three states surfaced on the action card:
  //
  //   "ready"      — `available when` passes. The action is on the
  //                  callable surface; whether a particular intent
  //                  dispatches still depends on user input.
  //   "input"      — `available when` passes BUT a default-input
  //                  intent fails `dispatchable when`. We can't know
  //                  in advance whether real input will pass; the
  //                  card just signals "this needs a specific input
  //                  to dispatch" so the user isn't surprised when
  //                  the ladder shows a blocker.
  //   "blocked"    — `available when` fails. Action isn't reachable
  //                  in the current snapshot regardless of input.
  //
  // The previous behaviour folded all `dispatchable when` failures on
  // the synthetic default-input intent into "blocked", which made
  // actions like `set(value: number) dispatchable when value > 0`
  // permanently look broken even though they were perfectly callable
  // with a positive value.
  const actionDispatchability = useMemo(() => {
    const map = new Map<
      string,
      {
        readonly status: "ready" | "input" | "blocked";
        readonly availableBlockerCount: number;
      }
    >();
    if (module === null || disableDispatch) return map;
    for (const node of model.nodes) {
      if (node.kind !== "action") continue;
      const available = core.isActionAvailable(node.name);
      if (!available) {
        // Available-layer failure. We try to count blockers via the
        // default-input intent; the SDK guarantees the first failing
        // layer short-circuits, so any blockers we see here are at
        // the available layer.
        let availableBlockerCount = 0;
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
          availableBlockerCount = blockers?.length ?? 0;
        } catch {
          // Couldn't build a probe intent; status is still "blocked"
          // — we just can't show a count.
        }
        map.set(node.id, { status: "blocked", availableBlockerCount });
        continue;
      }
      // Available passes. Probe with default input to see whether the
      // action is plug-and-play or input-bound.
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
          map.set(node.id, { status: "ready", availableBlockerCount: 0 });
        } else {
          // Available passed, dispatchable failed on default input —
          // user-supplied input may still pass.
          map.set(node.id, { status: "input", availableBlockerCount: 0 });
        }
      } catch {
        // createIntent threw — usually an input-shape issue. Same
        // signal as a dispatchable failure: action is reachable in
        // principle but needs a specific input.
        map.set(node.id, { status: "input", availableBlockerCount: 0 });
      }
    }
    return map;
  }, [
    model.nodes,
    module,
    liveSnapshot,
    core,
    whyNot,
    createIntent,
    disableDispatch,
  ]);

  const handleNodeActivate = useCallback(
    (nodeId: GraphNode["id"], _el: HTMLElement) => {
      if (wasDraggedSinceLastClickRef.current) {
        wasDraggedSinceLastClickRef.current = false;
        return;
      }
      // All node kinds route through Focus. Action cards used to open
      // an inline dispatch popover here; that path now lives in the
      // Interact lens, which LensPane auto-pulses when focus lands on
      // an action while the lens isn't visible.
      toggleFocus(nodeId);
    },
    [toggleFocus],
  );

  const handleBackgroundClick = useCallback(() => {
    clearFocus();
  }, [clearFocus]);

  // --- Per-node schema metadata (stable per schema build) -------------
  // typeLabel / typeDef / action-arg / action-descriptor all depend on
  // `module` only — when the snapshot changes, these don't. Pre-compute
  // them once per schema build so card renders read from a Map instead
  // of calling `typeOfStateField(module, name)` on every parent render,
  // which previously returned fresh object references for typeDef and
  // defeated NodeCard.memo.
  const nodeMetaByNodeId = useMemo(() => {
    type Meta =
      | { readonly kind: "state"; readonly typeLabel: string; readonly typeDef: unknown }
      | { readonly kind: "computed"; readonly typeLabel: string; readonly typeDef: unknown }
      | { readonly kind: "action"; readonly argLabel: string };
    const map = new Map<GraphNode["id"], Meta>();
    if (module === null) return map;
    for (const node of model.nodes) {
      if (node.kind === "state") {
        map.set(node.id, {
          kind: "state",
          typeLabel: typeOfStateField(module, node.name),
          typeDef: typeDefOfStateField(module, node.name),
        });
      } else if (node.kind === "computed") {
        map.set(node.id, {
          kind: "computed",
          typeLabel: typeOfComputed(module, node.name),
          typeDef: typeDefOfComputed(module, node.name),
        });
      } else if (node.kind === "action") {
        const descriptor = descriptorForAction(module.schema, node.name);
        map.set(node.id, {
          kind: "action",
          argLabel: describeActionArg(descriptor, node.name),
        });
      }
    }
    return map;
  }, [model.nodes, module]);

  // --- Rect reference stability ---------------------------------------
  // Both `layout.bounds` (base + overrides + cluster collapse) and
  // `focusLayout.bounds` (focus subgraph) get rebuilt on every pointer
  // drag / cluster toggle / focus change. For nodes whose (x, y, width,
  // height) are unchanged we want to reuse the prior Rect object so
  // NodeCard.memo can shallow-compare `rect === prev.rect` and skip.
  const stableBounds = useRectStability(layout.bounds);
  const stableFocusBounds = useRectStability(focusLayout?.bounds ?? null);

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
        {/* Cluster boundaries — dashed rectangles behind the column
         * group, with a chevron toggle to collapse/expand. Hidden
         * while focus layout is active. Collapsed clusters render
         * their member cards at the cluster centre (handled in layout)
         * and a supernode overlay on top. */}
        {!focusActive && effectiveLayout.clusterRects?.map((r) => {
          const cluster = clusters.clusters.find((c) => c.id === r.clusterId);
          if (cluster === undefined) return null;
          const isCollapsed = collapsedClusters.has(r.clusterId);
          const memberCount =
            cluster.states.length + cluster.computeds.length + cluster.actions.length;
          return (
            <div
              key={r.clusterId}
              style={{
                position: "absolute",
                left: r.x,
                top: r.y,
                width: r.width,
                height: r.height,
              }}
            >
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 12,
                  border: "1px dashed color-mix(in oklch, var(--color-violet) 30%, transparent)",
                  pointerEvents: "none",
                  opacity: isCollapsed ? 0 : 0.65,
                  transition: "opacity 250ms ease-out",
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsedClusters((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.clusterId)) next.delete(r.clusterId);
                    else next.add(r.clusterId);
                    return next;
                  });
                }}
                title={isCollapsed ? "Expand cluster" : "Collapse cluster"}
                style={{
                  position: "absolute",
                  top: -10,
                  left: 12,
                  height: 20,
                  padding: "0 8px",
                  borderRadius: 10,
                  border: "1px solid color-mix(in oklch, var(--color-violet) 45%, transparent)",
                  background: "var(--color-void-hi, #1A2036)",
                  color: "var(--color-ink-dim, #95A3B8)",
                  fontFamily: MONO_STACK,
                  fontSize: 10,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ color: "var(--color-violet, #9f7bff)" }}>
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span>{cluster.label}</span>
                <span style={{ color: "var(--color-ink-mute, #607089)" }}>
                  · {memberCount}
                </span>
              </button>
              {isCollapsed ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.28, delay: 0.18 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsedClusters((prev) => {
                      const next = new Set(prev);
                      next.delete(r.clusterId);
                      return next;
                    });
                  }}
                  style={{
                    position: "absolute",
                    left: r.width / 2 - 90,
                    top: r.height / 2 - 28,
                    width: 180,
                    height: 56,
                    borderRadius: 10,
                    border: "1px solid color-mix(in oklch, var(--color-violet) 55%, transparent)",
                    background: "color-mix(in oklch, var(--color-void-hi, #1A2036) 92%, var(--color-violet, #9f7bff))",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    cursor: "pointer",
                    boxShadow: "0 4px 24px color-mix(in oklch, var(--color-violet, #9f7bff) 20%, transparent)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: FONT_STACK,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--color-ink, #E6EBF8)",
                    }}
                  >
                    {cluster.label}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO_STACK,
                      fontSize: 10,
                      color: "var(--color-ink-mute, #607089)",
                    }}
                  >
                    {cluster.states.length}s · {cluster.computeds.length}c · {cluster.actions.length}a
                  </span>
                </motion.div>
              ) : null}
            </div>
          );
        })}

        <EdgeLayer
          model={effectiveModel}
          layout={effectiveLayout}
          highlightedEdgeIds={neighbourhood.edgeIds}
          pulsingEdgeIds={pulsingEdgeIds}
          dimmed={dimmed}
          focusActive={focusActive}
          clusters={clusters}
          bundlingEnabled={!focusActive && clusters.clusters.length > 1}
        />

        {model.nodes.map((node) => {
          // In focus mode, non-focused nodes stay at their baseLayout
          // position (so they fade out in place), focused nodes use
          // the fresh subgraph rect. Out of focus, everyone uses the
          // merged baseLayout+overrides rect.
          const inFocus = focusActive && focusedNodeSet.has(node.id);
          const rect = inFocus
            ? stableFocusBounds?.get(node.id)
            : stableBounds.get(node.id);
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
          const meta = nodeMetaByNodeId.get(node.id);

          if (node.kind === "state" && meta?.kind === "state") {
            const value = (
              effectiveSnapshot?.data as Record<string, unknown> | undefined
            )?.[node.name];
            return (
              <StateCardItem
                key={node.id}
                nodeId={node.id}
                name={node.name}
                typeLabel={meta.typeLabel}
                typeDef={meta.typeDef}
                value={value}
                rect={rect}
                highlighted={highlighted}
                focused={focused}
                pulsing={pulsing}
                faded={faded}
                interactive={interactive}
                onPointerDown={onNodePointerDown}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onActivate={handleNodeActivate}
                onRevealSource={focusNode}
              />
            );
          }
          if (node.kind === "computed" && meta?.kind === "computed") {
            const value = effectiveSnapshot?.computed?.[node.name];
            return (
              <ComputedCardItem
                key={node.id}
                nodeId={node.id}
                name={node.name}
                typeLabel={meta.typeLabel}
                typeDef={meta.typeDef}
                value={value}
                rect={rect}
                highlighted={highlighted}
                focused={focused}
                pulsing={pulsing}
                faded={faded}
                interactive={interactive}
                onPointerDown={onNodePointerDown}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onActivate={handleNodeActivate}
                onRevealSource={focusNode}
              />
            );
          }
          if (node.kind === "action" && meta?.kind === "action") {
            const info = actionDispatchability.get(node.id);
            return (
              <ActionCardItem
                key={node.id}
                nodeId={node.id}
                name={node.name}
                argLabel={meta.argLabel}
                actionStatus={
                  disableDispatch ? "unknown" : info?.status ?? "unknown"
                }
                blockerCount={info?.availableBlockerCount ?? 0}
                rect={rect}
                highlighted={highlighted}
                focused={focused}
                pulsing={pulsing}
                faded={faded}
                interactive={interactive}
                onPointerDown={onNodePointerDown}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onActivate={handleNodeActivate}
                onRevealSource={focusNode}
              />
            );
          }
          return null;
        })}
      </div>

      <PlaybackControlBar
        controller={simulateController}
        model={model}
        onExit={() => exitSimulation("user-close")}
      />
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
// Shared pointer/activate wrapper + per-kind memoized card items.
// --------------------------------------------------------------------
//
// Why this shape: parent LiveGraph re-renders on many high-frequency
// signals (pointer moves, live-pulse ticks, viewport changes). Each
// render used to produce a fresh closure for every card's onPointerDown
// / onActivate / onRevealSource, which defeated React.memo. We now pass
// stable handlers that take `nodeId` and bind them per-card inside an
// inner memoized wrapper, so most cards skip render when their own
// props haven't changed.

type CardHandlerProps = {
  readonly nodeId: GraphNode["id"];
  readonly rect: Rect;
  readonly faded: boolean;
  readonly interactive: boolean;
  readonly onPointerDown: (
    nodeId: GraphNode["id"],
    e: React.PointerEvent<HTMLElement>,
  ) => void;
  readonly onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onActivate: (nodeId: GraphNode["id"], el: HTMLElement) => void;
  readonly onRevealSource: (nodeId: GraphNode["id"]) => void;
};

function InteractiveCardShell({
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
}: CardHandlerProps & { readonly children: React.ReactNode }): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => onPointerDown(nodeId, e),
    [nodeId, onPointerDown],
  );
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const t = e.target as HTMLElement;
      if (t.closest("button, input, textarea, select, [role='dialog']")) return;
      const el = (wrapperRef.current ??
        (t.closest("[data-node-id]") as HTMLElement | null)) as HTMLElement | null;
      if (el !== null) onActivate(nodeId, el);
    },
    [nodeId, onActivate],
  );
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation();
      onRevealSource(nodeId);
    },
    [nodeId, onRevealSource],
  );
  return (
    <motion.div
      ref={wrapperRef}
      data-interactive-card-id={nodeId}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
      onClick={interactive ? handleClick : undefined}
      onDoubleClick={interactive ? handleDoubleClick : undefined}
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

type StateCardItemProps = CardHandlerProps & {
  readonly name: string;
  readonly typeLabel: string;
  readonly typeDef: unknown;
  readonly value: unknown;
  readonly highlighted: boolean;
  readonly focused: boolean;
  readonly pulsing: boolean;
};

const StateCardItem = memo(function StateCardItem(
  props: StateCardItemProps,
): JSX.Element {
  return (
    <InteractiveCardShell
      nodeId={props.nodeId}
      rect={props.rect}
      faded={props.faded}
      interactive={props.interactive}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onActivate={props.onActivate}
      onRevealSource={props.onRevealSource}
    >
      <StateCard
        id={props.nodeId}
        name={props.name}
        typeLabel={props.typeLabel}
        typeDef={props.typeDef}
        value={props.value}
        rect={props.rect}
        highlighted={props.highlighted}
        focused={props.focused}
        pulsing={props.pulsing}
      />
    </InteractiveCardShell>
  );
});

type ComputedCardItemProps = CardHandlerProps & {
  readonly name: string;
  readonly typeLabel: string;
  readonly typeDef: unknown;
  readonly value: unknown;
  readonly highlighted: boolean;
  readonly focused: boolean;
  readonly pulsing: boolean;
};

const ComputedCardItem = memo(function ComputedCardItem(
  props: ComputedCardItemProps,
): JSX.Element {
  return (
    <InteractiveCardShell
      nodeId={props.nodeId}
      rect={props.rect}
      faded={props.faded}
      interactive={props.interactive}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onActivate={props.onActivate}
      onRevealSource={props.onRevealSource}
    >
      <ComputedCard
        id={props.nodeId}
        name={props.name}
        typeLabel={props.typeLabel}
        typeDef={props.typeDef}
        value={props.value}
        rect={props.rect}
        highlighted={props.highlighted}
        focused={props.focused}
        pulsing={props.pulsing}
      />
    </InteractiveCardShell>
  );
});

type ActionCardItemProps = CardHandlerProps & {
  readonly name: string;
  readonly argLabel: string;
  readonly actionStatus: "ready" | "input" | "blocked" | "unknown";
  readonly blockerCount: number;
  readonly highlighted: boolean;
  readonly focused: boolean;
  readonly pulsing: boolean;
};

const ActionCardItem = memo(function ActionCardItem(
  props: ActionCardItemProps,
): JSX.Element {
  return (
    <InteractiveCardShell
      nodeId={props.nodeId}
      rect={props.rect}
      faded={props.faded}
      interactive={props.interactive}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onActivate={props.onActivate}
      onRevealSource={props.onRevealSource}
    >
      <ActionCard
        id={props.nodeId}
        name={props.name}
        argLabel={props.argLabel}
        actionStatus={props.actionStatus}
        blockerCount={props.blockerCount}
        rect={props.rect}
        highlighted={props.highlighted}
        focused={props.focused}
        pulsing={props.pulsing}
      />
    </InteractiveCardShell>
  );
});

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
  // ComputedSpec shape is `{ fields: Record<string, ComputedFieldSpec> }`
  // — index through `fields`, not the ComputedSpec itself.
  const spec = module.schema.computed.fields?.[name];
  if (spec === undefined) return "derived";
  // `ComputedFieldSpec` doesn't currently declare a returnType field,
  // but the MEL compiler may expose one in the future — double-cast via
  // `unknown` to read it opportunistically without lying to TS about
  // the static shape.
  const withReturnType = spec as unknown as { returnType?: unknown };
  if (withReturnType.returnType !== undefined) {
    return formatType(withReturnType.returnType);
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
 * Preserve Rect object references across layout re-computations when
 * the geometry is unchanged. Turns a stream of fresh Maps into a stream
 * of Maps that share rect identity with the previous one for all
 * unchanged entries, so NodeCard.memo can shallow-compare and skip.
 */
function useRectStability(
  bounds: ReadonlyMap<GraphNode["id"], Rect> | null,
): ReadonlyMap<GraphNode["id"], Rect> {
  const cacheRef = useRef(new Map<GraphNode["id"], Rect>());
  return useMemo(() => {
    const cache = cacheRef.current;
    const next = new Map<GraphNode["id"], Rect>();
    if (bounds === null) {
      cacheRef.current = next;
      return next;
    }
    for (const [id, rect] of bounds) {
      const prev = cache.get(id);
      if (
        prev !== undefined &&
        prev.x === rect.x &&
        prev.y === rect.y &&
        prev.width === rect.width &&
        prev.height === rect.height
      ) {
        next.set(id, prev);
      } else {
        next.set(id, rect);
      }
    }
    cacheRef.current = next;
    return next;
  }, [bounds]);
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
