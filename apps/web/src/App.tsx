import { StudioProvider } from "./context/studio-provider.js";
import { StudioShell } from "./layouts/studio-shell.js";

export function App() {
  return (
    <StudioProvider>
      <StudioShell />
    </StudioProvider>
  );
}
