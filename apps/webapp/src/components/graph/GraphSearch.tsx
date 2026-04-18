import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Floating search overlay. Appears on any printable key or Cmd/Ctrl+F
 * while the graph has focus. Filters nodes by fuzzy match on name or
 * kind. Esc closes.
 */
export function GraphSearch({
  open,
  query,
  onQueryChange,
  onClose,
  matchCount,
}: {
  readonly open: boolean;
  readonly query: string;
  readonly onQueryChange: (next: string) => void;
  readonly onClose: () => void;
  readonly matchCount: number;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      // Let the overlay mount before focusing so the caret lands in
      // the input instead of the background.
      const t = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className="z-30 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--color-void-hi)]/95 backdrop-blur-xl border border-[var(--color-glass-edge)] shadow-[var(--shadow-glass)]"
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            width: "fit-content",
          }}
        >
          <Search className="h-3.5 w-3.5 text-[var(--color-ink-mute)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
              }
            }}
            placeholder="filter nodes…"
            className="
              w-[220px] h-5 bg-transparent outline-none
              font-mono text-[11.5px] text-[var(--color-ink)]
              placeholder:text-[var(--color-ink-mute)]
            "
          />
          <div className="flex items-center gap-1.5 pl-1.5 border-l border-[var(--color-rule)]">
            <span className="font-mono text-[10px] text-[var(--color-ink-mute)]">
              {query.trim() === ""
                ? "type to filter"
                : matchCount === 0
                  ? "no matches"
                  : `${matchCount} match${matchCount === 1 ? "" : "es"}`}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="
                inline-flex items-center justify-center
                h-4 w-4 rounded
                text-[var(--color-ink-mute)]
                hover:text-[var(--color-ink)]
                hover:bg-[var(--color-glass)]
              "
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
