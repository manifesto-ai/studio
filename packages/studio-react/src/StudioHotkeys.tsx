import { useEffect } from "react";
import { useStudio } from "./useStudio.js";

/**
 * Globally captures CTRL/CMD + S and triggers `requestBuild()` on the
 * current Studio adapter. SE-BUILD-1 / SE-UI-2: builds are explicit.
 *
 * Mount once anywhere inside `<StudioProvider>`. Mounting multiple
 * instances is safe (the browser only dispatches one keydown) but
 * wasteful.
 */
export function StudioHotkeys(): null {
  const { requestBuild } = useStudio();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s";
      if (!isSave) return;
      e.preventDefault();
      requestBuild();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestBuild]);
  return null;
}
