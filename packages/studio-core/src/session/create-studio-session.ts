import type { AnalysisBundle } from "../contracts/inputs.js";
import type { StudioSession, StudioSessionOptions } from "../contracts/session.js";

import { StudioSessionImpl } from "./studio-session-impl.js";

export function createStudioSession(
  bundle: AnalysisBundle,
  options?: StudioSessionOptions
): StudioSession {
  return new StudioSessionImpl(bundle, options);
}
