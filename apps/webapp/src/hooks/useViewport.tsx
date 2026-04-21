import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Viewport — the camera for LiveGraph.
 *
 * `{tx, ty, k}` follows the industry-standard shape (React Flow, tldraw,
 * d3-zoom): world points map to screen points as
 *
 *     screen = world * k + {tx, ty}
 *
 * i.e. `transform: translate(tx, ty) scale(k); transform-origin: 0 0`.
 *
 * The provider owns only the raw camera and a rAF tween that animates
 * `{tx, ty, k}` together (never scale-then-pan — that feels jarring).
 * Fit-to-bounds math lives in `computeFitCamera`, which callers use to
 * request a camera move in response to their own signals (focus change,
 * simulation playback origin, manual pan/zoom gestures).
 *
 * Keeping Camera separate from Focus is intentional — same separation
 * tldraw and React Flow maintain. "What is highlighted" and "where are
 * we looking" should compose, not couple.
 */

export type Camera = {
  readonly tx: number;
  readonly ty: number;
  readonly k: number;
};

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 1.5;

export const IDENTITY_CAMERA: Camera = { tx: 0, ty: 0, k: 1 };

export type SetCameraOptions = {
  /** If true, animates from the current camera. Default false. */
  readonly animate?: boolean;
  /** Tween duration in ms. Default 320. */
  readonly duration?: number;
};

type ViewportContextValue = {
  readonly camera: Camera;
  /**
   * Immediately set or animate to a target camera. Values are clamped
   * to `[MIN_ZOOM, MAX_ZOOM]` for k.
   */
  readonly setCamera: (next: Camera, options?: SetCameraOptions) => void;
  /** Reset to identity. */
  readonly resetCamera: () => void;
};

const ViewportContext = createContext<ViewportContextValue | null>(null);

export function ViewportProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const [camera, setCameraState] = useState<Camera>(IDENTITY_CAMERA);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const rafRef = useRef<number | null>(null);

  const cancelAnimation = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => cancelAnimation, [cancelAnimation]);

  // `setCamera` is deliberately independent of the `camera` state — it
  // reads the latest value through `cameraRef` — so its identity stays
  // stable across frames. Pointer / wheel handlers and effects that
  // depend on it won't thrash-resubscribe on every tween step.
  const setCamera = useCallback(
    (next: Camera, options?: SetCameraOptions): void => {
      cancelAnimation();
      const clampedK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.k));
      const target: Camera = { tx: next.tx, ty: next.ty, k: clampedK };
      const shouldAnimate = options?.animate === true;
      if (!shouldAnimate) {
        setCameraState(target);
        return;
      }
      const from = cameraRef.current;
      const duration = Math.max(0, options?.duration ?? 320);
      if (duration === 0) {
        setCameraState(target);
        return;
      }
      const start = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeInOutCubic(t);
        setCameraState({
          tx: from.tx + (target.tx - from.tx) * eased,
          ty: from.ty + (target.ty - from.ty) * eased,
          k: from.k + (target.k - from.k) * eased,
        });
        if (t < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancelAnimation],
  );

  const resetCamera = useCallback((): void => {
    cancelAnimation();
    setCameraState(IDENTITY_CAMERA);
  }, [cancelAnimation]);

  const value = useMemo<ViewportContextValue>(
    () => ({ camera, setCamera, resetCamera }),
    [camera, setCamera, resetCamera],
  );
  return (
    <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>
  );
}

export function useViewport(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (ctx === null) {
    throw new Error("useViewport must be used inside <ViewportProvider>");
  }
  return ctx;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Compute a camera that centers the given world-space box in the given
 * viewport, with uniform scale. Identical in spirit to xyflow's
 * `getViewportForBounds` — picks the dimension-limiting scale, clamps,
 * then translates so the box center maps to the viewport center.
 */
export function computeFitCamera(
  box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  viewport: { readonly width: number; readonly height: number },
  options: {
    readonly padding?: number;
    readonly minZoom?: number;
    readonly maxZoom?: number;
  } = {},
): Camera {
  const padding = options.padding ?? 64;
  const minZoom = options.minZoom ?? MIN_ZOOM;
  const maxZoom = options.maxZoom ?? MAX_ZOOM;
  if (viewport.width <= 0 || viewport.height <= 0 || box.width <= 0 || box.height <= 0) {
    return IDENTITY_CAMERA;
  }
  const kx = (viewport.width - padding * 2) / box.width;
  const ky = (viewport.height - padding * 2) / box.height;
  const k = Math.max(minZoom, Math.min(maxZoom, Math.min(kx, ky)));
  const boxCx = box.x + box.width / 2;
  const boxCy = box.y + box.height / 2;
  const tx = viewport.width / 2 - boxCx * k;
  const ty = viewport.height / 2 - boxCy * k;
  return { tx, ty, k };
}

/**
 * Compute a camera that zooms around a screen-space pointer by a given
 * factor, keeping the world point under the pointer fixed. This is the
 * conventional pointer-centric wheel-zoom formula.
 */
export function zoomAroundPointer(
  current: Camera,
  screenPoint: { readonly x: number; readonly y: number },
  factor: number,
  options: { readonly minZoom?: number; readonly maxZoom?: number } = {},
): Camera {
  const minZoom = options.minZoom ?? MIN_ZOOM;
  const maxZoom = options.maxZoom ?? MAX_ZOOM;
  const nextK = Math.max(minZoom, Math.min(maxZoom, current.k * factor));
  if (nextK === current.k) return current;
  // Invariant: (screenPoint - translate) / k = world point under pointer.
  // Solve for translate' that keeps world point fixed at the new scale.
  const tx = screenPoint.x - ((screenPoint.x - current.tx) * nextK) / current.k;
  const ty = screenPoint.y - ((screenPoint.y - current.ty) * nextK) / current.k;
  return { tx, ty, k: nextK };
}
