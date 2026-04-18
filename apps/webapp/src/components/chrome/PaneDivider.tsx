import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/cn";
import { PANE_LIMITS } from "@/hooks/usePaneSizes";

/**
 * Pane divider — a 1px luminous measurement line between panes.
 * Reads as an instrument ruler rather than a resize handle until hovered.
 */
export function PaneDivider({
  onResize,
  getSize,
  ariaLabel,
  invertDelta = false,
}: {
  readonly onResize: (dx: number, startSize: number) => void;
  readonly getSize: () => number;
  readonly ariaLabel: string;
  readonly invertDelta?: boolean;
}): JSX.Element {
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);
  const dragRef = useRef<{ startX: number; startSize: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startSize: getSize() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null) return;
    onResize(e.clientX - d.startX, d.startSize);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") {
      onResize(invertDelta ? step : -step, getSize());
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      onResize(invertDelta ? -step : step, getSize());
      e.preventDefault();
    } else if (e.key === "Home") {
      const defaultSize = invertDelta
        ? PANE_LIMITS.DEFAULT_SIZES.right
        : PANE_LIMITS.DEFAULT_SIZES.left;
      const delta = invertDelta
        ? getSize() - defaultSize
        : defaultSize - getSize();
      onResize(delta, getSize());
      e.preventDefault();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onKeyDown={onKeyDown}
      className={cn(
        "w-[6px] flex-none relative flex items-center justify-center",
        "cursor-col-resize outline-none group",
        "transition-colors duration-150",
      )}
    >
      <div
        className={cn(
          "w-px h-full transition-all duration-150",
          active
            ? "bg-[var(--color-violet-hot)] shadow-[0_0_12px_var(--color-violet-hot)]"
            : hover
              ? "bg-[var(--color-violet)] shadow-[0_0_8px_color-mix(in_oklch,var(--color-violet)_60%,transparent)]"
              : "bg-[var(--color-rule)]",
        )}
      />
    </div>
  );
}
