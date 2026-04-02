import { ObservationLedgerPanel } from "@manifesto-ai/studio-ui";

import { useStudioState, useStudioDispatch } from "../../context/studio-context.js";

export function LedgerFooter() {
  const state = useStudioState();
  const dispatch = useStudioDispatch();

  return (
    <ObservationLedgerPanel
      records={state.records}
      selectedRecordId={state.selectedRecordId}
      onSelectRecord={(recordId) =>
        dispatch({ type: "SELECT_RECORD", recordId })
      }
    />
  );
}
