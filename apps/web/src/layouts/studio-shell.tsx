import { useStudioState } from "../context/studio-context.js";
import { AuthorLayout } from "./author-layout.js";
import { ObserveLayout } from "./observe-layout.js";

export function StudioShell() {
  const state = useStudioState();

  if (state.mode === "observe") {
    return <ObserveLayout />;
  }

  return <AuthorLayout />;
}
