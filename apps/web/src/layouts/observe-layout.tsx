import { StudioWorkbench } from "@manifesto-ai/studio-ui";

import { Masthead } from "../panels/shared/masthead.js";
import { ObservationSidebar } from "../panels/observe/observation-sidebar.js";
import { TransitionGraphPanel } from "../panels/observe/transition-graph-panel.js";
import { TransitionContextPanel } from "../panels/observe/transition-context-panel.js";
import { LedgerFooter } from "../panels/observe/ledger-footer.js";

export function ObserveLayout() {
  return (
    <StudioWorkbench
      masthead={<Masthead />}
      sidebar={<ObservationSidebar />}
      canvas={<TransitionGraphPanel />}
      inspector={<TransitionContextPanel />}
      footer={<LedgerFooter />}
      sidebarWidth="340px"
      inspectorWidth="360px"
      footerHeight="200px"
    />
  );
}
