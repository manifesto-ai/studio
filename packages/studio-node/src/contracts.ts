import type {
  ActionAvailabilityProjection,
  ActionBlockerProjection,
  AnalysisBundle,
  DomainGraphProjection,
  FindingsFilter,
  FindingsReportProjection,
  GovernanceStateProjection,
  LineageStateProjection,
  SnapshotInspectorProjection,
  StudioSessionOptions,
  TraceReplayProjection
} from "@manifesto-ai/studio-core";

export type StudioFileInput = {
  cwd?: string;
  bundlePath?: string;
  schemaPath?: string;
  snapshotPath?: string;
  tracePath?: string;
  lineagePath?: string;
  governancePath?: string;
  sessionOptions?: StudioSessionOptions;
};

export type StudioOperation =
  | {
      kind: "graph";
      format?: "summary" | "full";
    }
  | {
      kind: "findings";
      filter?: FindingsFilter;
    }
  | {
      kind: "availability";
    }
  | {
      kind: "explain-action";
      actionId: string;
    }
  | {
      kind: "snapshot";
    }
  | {
      kind: "trace";
    }
  | {
      kind: "lineage";
    }
  | {
      kind: "governance";
    };

export type StudioOperationResult =
  | DomainGraphProjection
  | FindingsReportProjection
  | ActionAvailabilityProjection[]
  | ActionBlockerProjection
  | SnapshotInspectorProjection
  | TraceReplayProjection
  | LineageStateProjection
  | GovernanceStateProjection;

export type StudioOperationKind = StudioOperation["kind"];

export type StudioBundleFile = Partial<AnalysisBundle> & {
  schemaPath?: string;
  snapshotPath?: string;
  tracePath?: string;
  lineagePath?: string;
  governancePath?: string;
};

export const STUDIO_OPERATION_SPECS = {
  graph: {
    command: "graph",
    toolName: "get_domain_graph",
    description: "Returns the domain semantic graph projection."
  },
  findings: {
    command: "find_issues",
    toolName: "find_issues",
    description: "Runs studio-core findings analysis with optional filtering."
  },
  availability: {
    command: "availability",
    toolName: "get_action_availability",
    description: "Returns runtime action availability for all actions."
  },
  "explain-action": {
    command: "explain_action_blocker",
    toolName: "explain_action_blocker",
    description: "Explains why a specific action is available, blocked, or unreachable."
  },
  snapshot: {
    command: "inspect_snapshot",
    toolName: "inspect_snapshot",
    description: "Inspects snapshot fields and runtime-only findings."
  },
  trace: {
    command: "analyze_trace",
    toolName: "analyze_trace",
    description: "Analyzes a trace overlay and returns replay-style projection."
  },
  lineage: {
    command: "get_lineage_state",
    toolName: "get_lineage_state",
    description: "Returns lineage branch, world, and seal state."
  },
  governance: {
    command: "get_governance_state",
    toolName: "get_governance_state",
    description: "Returns governance proposal, actor, and gate state."
  }
} as const satisfies Record<
  StudioOperationKind,
  {
    command: string;
    toolName: string;
    description: string;
  }
>;
