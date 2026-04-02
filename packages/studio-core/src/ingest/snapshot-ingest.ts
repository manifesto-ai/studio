import type { Snapshot } from "../contracts/inputs.js";

export function ingestSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    meta: { ...snapshot.meta },
    system: {
      ...snapshot.system,
      pendingRequirements: [...snapshot.system.pendingRequirements]
    },
    computed: { ...snapshot.computed }
  };
}

