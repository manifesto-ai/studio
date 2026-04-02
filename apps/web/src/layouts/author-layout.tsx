import { StudioWorkbench } from "@manifesto-ai/studio-ui";

import { Masthead } from "../panels/shared/masthead.js";
import { CodeSidebar } from "../panels/author/code-sidebar.js";
import { DomainGraphPanel } from "../panels/author/domain-graph-panel.js";
import { NodeContextPanel } from "../panels/author/node-context-panel.js";
import { DiagnosticsFooter } from "../panels/author/diagnostics-footer.js";

export function AuthorLayout() {
  return (
    <StudioWorkbench
      masthead={<Masthead />}
      sidebar={<CodeSidebar />}
      canvas={<DomainGraphPanel />}
      inspector={<NodeContextPanel />}
      footer={<DiagnosticsFooter />}
      sidebarWidth="440px"
      inspectorWidth="360px"
      footerHeight="260px"
    />
  );
}
