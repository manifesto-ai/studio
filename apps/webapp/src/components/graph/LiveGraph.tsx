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
import { useFocus } from "@/hooks/useFocus";
import { ActionCard, ComputedCard, StateCard } from "./NodeCard";
import { EdgeLayer } from "./EdgeLayer";
import { ActionDispatchPopover } from "./ActionDispatchPopover";
import { formatType } from "./formatValue";
import { computeLayout, type LayoutResult, type Rect } from "./layout";
import { useLivePulse } from "./useLivePulse";
import {
  computePlaybackScrollTarget,
  useSimulationPlayback,
} from "./useSimulationPlayback";
// computePlaybackScrollTarget handles the single-rect → viewport math
// we need for the focus bounding-box too; feeding it a union rect gives
// us the same "center if it fits, clamp otherwise" behaviour.
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
    return () => ro.disconnect();
  }, []);

  const baseLayout: LayoutResult = useMemo(
    () =>
      computeLayout(
        model,
        Math.max(viewport.width, 800),
        Math.max(viewport.height, 500),
      ),
    [model, viewport.width, viewport.height],
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
    [layout.bounds],
  );

  const onNodePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      const drag = dragStateRef.current;
      if (drag === null || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startPointerX;
      const dy = e.clientY - drag.startPointerY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
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

  // --- Focus viewport follow ------------------------------------------
  // When focus lands on a node, scroll so the focus node + its 1-hop
  // neighbours are all in view. This is the "bounding-box viewing
  // focus" behaviour: it keeps the highlighted sub-graph on screen
  // even when focus is driven from outside the canvas (Monaco cursor,
  // diagnostic click). We skip the scroll if the sub-graph is already
  // fully visible so typing/clicking doesn't constantly bounce the
  // viewport. Runs on both origins — the source cursor is the primary
  // reason this effect exists.
  const lastScrolledFocusRef = useRef<GraphNode["id"] | null>(null);
  useEffect(() => {
    if (focusNodeId === null) {
      lastScrolledFocusRef.current = null;
      return;
    }
    const host = hostRef.current;
    if (host === null) return;
    // Guard against re-scrolling when only the origin changed (e.g. the
    // double-click path that re-publishes the same id). We key on node
    // id — a genuine focus shift always carries a different id.
    if (lastScrolledFocusRef.current === focusNodeId) return;

    const ids = new Set<GraphNode["id"]>([focusNodeId]);
    for (const id of neighbourhood.nodeIds) ids.add(id);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const id of ids) {
      const r = layout.bounds.get(id);
      if (r === undefined) continue;
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    if (!Number.isFinite(minX)) return;

    const target = computePlaybackScrollTarget(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      {
        left: host.scrollLeft,
        top: host.scrollTop,
        width: host.clientWidth,
        height: host.clientHeight,
        scrollWidth: host.scrollWidth,
        scrollHeight: host.scrollHeight,
      },
    );
    lastScrolledFocusRef.current = focusNodeId;
    if (target === null) return;
    host.scrollTo({
      left: target.left,
      top: target.top,
      behavior: "smooth",
    });
  }, [focusNodeId, neighbourhood.nodeIds, layout.bounds]);

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
    const target = computePlaybackScrollTarget(originRect, {
      left: host.scrollLeft,
      top: host.scrollTop,
      width: host.clientWidth,
      height: host.clientHeight,
      scrollWidth: host.scrollWidth,
      scrollHeight: host.scrollHeight,
    });
    if (target === null) return;
    lastScrolledPlaybackGenerationRef.current = simulatePulse.generation;
    host.scrollTo({
      left: target.left,
      top: target.top,
      behavior: "smooth",
    });
  }, [
    disableDispatch,
    layout.bounds,
    simulatePulse.generation,
    simulatePulse.originAction,
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
      className="absolute inset-0 overflow-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleBackgroundClick();
      }}
    >
      <div
        className="relative"
        style={{
          width: layout.canvasWidth,
          height: layout.canvasHeight,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) handleBackgroundClick();
        }}
      >
        <EdgeLayer
          model={model}
          layout={layout}
          highlightedEdgeIds={neighbourhood.edgeIds}
          pulsingEdgeIds={pulsingEdgeIds}
          dimmed={dimmed}
        />

        {model.nodes.map((node) => {
          const rect = layout.bounds.get(node.id);
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
          const commonHandlers = {
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
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onActivate,
  onRevealSource,
  children,
}: {
  readonly nodeId: string;
  readonly rect: Rect;
  readonly onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onActivate: (el: HTMLElement) => void;
  readonly onRevealSource: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // The NodeCard itself is absolutely positioned via Framer Motion
  // transforms.  We overlay a pointer-target div at the same rect so
  // drag gestures feel natural and the dispatch popover has a stable
  // DOM anchor that moves with the card.
  return (
    <div
      ref={wrapperRef}
      data-interactive-card-id={nodeId}
      onPointerDown={(e) => {
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => {
        // Avoid firing activate if the target is a control inside the
        // card — the card itself, including value rows, is considered
        // neutral surface that can activate.
        const t = e.target as HTMLElement;
        if (t.closest("button, input, textarea, select, [role='dialog']"))
          return;
        const el = (wrapperRef.current ??
          (t.closest("[data-node-id]") as HTMLElement | null)) as HTMLElement | null;
        if (el !== null) onActivate(el);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onRevealSource();
      }}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
        width: rect.width,
        height: rect.height,
        touchAction: "none",
        cursor: "grab",
      }}
    >
      {children}
    </div>
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
