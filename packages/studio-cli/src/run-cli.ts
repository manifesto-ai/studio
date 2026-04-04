import type {
  ActionAvailabilityProjection,
  ActionBlockerProjection,
  DomainGraphProjection,
  FindingsReportProjection,
  GovernanceStateProjection,
  LineageStateProjection,
  SnapshotInspectorProjection,
  TransitionGraphProjection,
  TraceReplayProjection
} from "@manifesto-ai/studio-core";
import {
  executeStudioOperation,
  type StudioFileInput,
  type StudioOperation,
  type StudioOperationResult
} from "@manifesto-ai/studio-node";

const HELP_TEXT = `studio-cli

Usage:
  studio-cli analyze [schemaPath] [options]
  studio-cli check [schemaPath] [options]
  studio-cli graph [schemaPath] [options]
  studio-cli explain [actionId] [schemaPath] [options]
  studio-cli trace [tracePath] [options]
  studio-cli availability [schemaPath] [options]
  studio-cli snapshot [schemaPath] [options]
  studio-cli lineage [schemaPath] [options]
  studio-cli governance [schemaPath] [options]
  studio-cli transition-graph [options]

Common inputs:
  --bundle <file>                  Load an analysis bundle JSON file
  --schema <file>                  Load a DomainSchema JSON file
  --mel <file>                     Load and compile a MEL file
  --snapshot <file>                Attach a Snapshot JSON file
  --trace <file>                   Attach a TraceGraph JSON file
  --lineage <file>                 Attach a lineage export JSON file
  --governance <file>              Attach a governance export JSON file
  --observations <file>            Attach an ObservationRecord[] JSON file
  --preset <file>                  Attach a ProjectionPreset JSON file

Session options:
  --validation-mode <lenient|strict>
  --lineage-stale-ms <number>
  --governance-proposal-stale-ms <number>

Output:
  --output <text|json>             Default: text

Command-specific:
  analyze/check
    --severity <error,warn,info>
    --kind <finding-kind>
    --subject <node-id>
    --provenance <static,runtime,trace,lineage,governance>

  graph
    --format <summary|full|dot|json> Default: summary

  explain
    --action <action-id>           Required when actionId positional is absent

  transition-graph
    --observations <file>          Required unless --bundle provides observations
    --preset <file>                Required unless --bundle provides projectionPreset
`;

class CliUsageError extends Error {}

type ParsedArgs = {
  flags: Map<string, string[]>;
  positionals: string[];
};

function pushFlag(flags: Map<string, string[]>, key: string, value: string): void {
  const existing = flags.get(key);
  if (existing) {
    existing.push(value);
    return;
  }

  flags.set(key, [value]);
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");

    if (equalsIndex >= 0) {
      pushFlag(
        flags,
        withoutPrefix.slice(0, equalsIndex),
        withoutPrefix.slice(equalsIndex + 1)
      );
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      pushFlag(flags, withoutPrefix, "true");
      continue;
    }

    pushFlag(flags, withoutPrefix, next);
    index += 1;
  }

  return { flags, positionals };
}

function getLastFlag(flags: Map<string, string[]>, key: string): string | undefined {
  return flags.get(key)?.at(-1);
}

function getListFlag(flags: Map<string, string[]>, key: string): string[] | undefined {
  const values = flags.get(key);

  if (!values || values.length === 0) {
    return undefined;
  }

  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseNumberFlag(
  flags: Map<string, string[]>,
  key: string
): number | undefined {
  const value = getLastFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliUsageError(`Flag "--${key}" must be a finite number.`);
  }

  return parsed;
}

function buildFileInput(command: string, args: ParsedArgs): StudioFileInput {
  const melPath = getLastFlag(args.flags, "mel");
  const schemaPath = getLastFlag(args.flags, "schema") ?? melPath;
  const output = getLastFlag(args.flags, "output");

  if (output && output !== "text" && output !== "json") {
    throw new CliUsageError(`Unsupported output "${output}". Use "text" or "json".`);
  }

  const input: StudioFileInput = {
    cwd: process.cwd(),
    bundlePath: getLastFlag(args.flags, "bundle"),
    schemaPath,
    snapshotPath: getLastFlag(args.flags, "snapshot"),
    tracePath: getLastFlag(args.flags, "trace"),
    lineagePath: getLastFlag(args.flags, "lineage"),
    governancePath: getLastFlag(args.flags, "governance"),
    observationsPath: getLastFlag(args.flags, "observations"),
    projectionPresetPath: getLastFlag(args.flags, "preset"),
    sessionOptions: {
      validationMode: getLastFlag(args.flags, "validation-mode") as
        | "lenient"
        | "strict"
        | undefined,
      lineageStaleMs: parseNumberFlag(args.flags, "lineage-stale-ms"),
      governanceProposalStaleMs: parseNumberFlag(
        args.flags,
        "governance-proposal-stale-ms"
      )
    }
  };

  if (!input.bundlePath) {
    switch (command) {
      case "analyze":
      case "check":
      case "graph":
      case "availability":
      case "snapshot":
      case "lineage":
      case "governance":
        input.schemaPath = input.schemaPath ?? args.positionals[0];
        break;
      case "trace":
        input.tracePath = input.tracePath ?? args.positionals[0];
        input.schemaPath = input.schemaPath ?? args.positionals[1];
        break;
      case "explain":
        input.schemaPath = input.schemaPath ?? args.positionals[1];
        break;
      case "transition-graph":
        break;
      default:
        break;
    }
  }

  if (command === "transition-graph" && !input.bundlePath) {
    if (!input.observationsPath) {
      throw new CliUsageError(
        'transition-graph requires "--observations <file>" unless --bundle is provided.'
      );
    }

    if (!input.projectionPresetPath) {
      throw new CliUsageError(
        'transition-graph requires "--preset <file>" unless --bundle is provided.'
      );
    }
  }

  return input;
}

function buildOperation(command: string, args: ParsedArgs): StudioOperation {
  switch (command) {
    case "analyze":
    case "check":
      return {
        kind: "findings",
        filter: {
          severity: getListFlag(args.flags, "severity") as
            | Array<"error" | "warn" | "info">
            | undefined,
          kinds: getListFlag(args.flags, "kind"),
          subjects: getListFlag(args.flags, "subject"),
          provenance: getListFlag(args.flags, "provenance") as
            | Array<"static" | "runtime" | "trace" | "lineage" | "governance">
            | undefined
        }
      };
    case "graph":
      return {
        kind: "graph",
        format:
          getLastFlag(args.flags, "format") === "full" ||
          getLastFlag(args.flags, "format") === "json"
            ? "full"
            : "summary"
      };
    case "explain": {
      const actionId = getLastFlag(args.flags, "action") ?? args.positionals[0];

      if (!actionId) {
        throw new CliUsageError("explain requires an action id via positional arg or --action.");
      }

      return {
        kind: "explain-action",
        actionId
      };
    }
    case "trace":
      return { kind: "trace" };
    case "availability":
      return { kind: "availability" };
    case "snapshot":
      return { kind: "snapshot" };
    case "lineage":
      return { kind: "lineage" };
    case "governance":
      return { kind: "governance" };
    case "transition-graph":
      return { kind: "transition-graph" };
    default:
      throw new CliUsageError(`Unknown command "${command}".`);
  }
}

function renderFindingsReport(report: FindingsReportProjection): string {
  const lines = report.findings.map((finding) => {
    const header = `${finding.severity.toUpperCase().padEnd(5)} ${finding.kind}: ${finding.subject.nodeId}`;
    const body = `  → ${finding.message}`;
    const evidence = finding.evidence
      .slice(0, 3)
      .map((entry) => `  ↳ ${entry.role}: ${entry.ref.path ?? entry.ref.nodeId}`);

    return [header, body, ...evidence].join("\n");
  });

  lines.push(
    `Summary: ${report.summary.bySeverity.error} errors, ${report.summary.bySeverity.warn} warnings, ${report.summary.bySeverity.info} info`
  );

  return lines.join("\n\n");
}

function renderGraph(projection: DomainGraphProjection): string {
  const counts = projection.nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.kind] = (acc[node.kind] ?? 0) + 1;
    return acc;
  }, {});

  const nodeKinds = Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `  - ${kind}: ${count}`)
    .join("\n");

  return [
    "Domain graph",
    `Schema hash: ${projection.schemaHash}`,
    `Nodes: ${projection.nodeCount}`,
    `Edges: ${projection.edgeCount}`,
    "Node kinds:",
    nodeKinds || "  - none"
  ].join("\n");
}

function toDotIdentifier(value: string): string {
  return JSON.stringify(value);
}

function renderGraphAsDot(projection: DomainGraphProjection): string {
  const lines = [
    "digraph studio_domain {",
    "  rankdir=LR;"
  ];

  for (const node of projection.nodes) {
    const label =
      typeof node.metadata?.label === "string"
        ? node.metadata.label
        : node.id;

    lines.push(
      `  ${toDotIdentifier(node.id)} [label=${toDotIdentifier(`${label}\\n(${node.kind})`)}];`
    );
  }

  for (const edge of projection.edges) {
    lines.push(
      `  ${toDotIdentifier(edge.source)} -> ${toDotIdentifier(edge.target)} [label=${toDotIdentifier(edge.kind)}];`
    );
  }

  lines.push("}");
  return lines.join("\n");
}

function renderAvailability(projection: ActionAvailabilityProjection[]): string {
  return projection
    .map((entry) => {
      if (entry.status !== "ready") {
        return `${entry.actionId}: snapshot required`;
      }

      const state = entry.available ? "available" : "blocked";
      const blockerSummary = entry.blockers?.length
        ? ` (${entry.blockers.length} blocker${entry.blockers.length > 1 ? "s" : ""})`
        : "";

      return `${entry.actionId}: ${state}${blockerSummary}`;
    })
    .join("\n");
}

function renderActionBlocker(projection: ActionBlockerProjection): string {
  if (projection.status === "not-found") {
    return projection.summary;
  }

  if (projection.status === "not-provided") {
    return projection.summary;
  }

  const status = projection.available ? "AVAILABLE" : "BLOCKED";
  const blockers = projection.blockers.map((entry) =>
    `  ${entry.evaluated ? "✓" : "✗"} ${entry.subExpression}`
  );
  const causeChain = projection.explanation
    ? [
        "",
        "Cause chain:",
        ...projection.explanation.path.map(
          (node) => `  - ${node.provenance}: ${node.fact}`
        )
      ]
    : [];

  return [
    `${projection.actionId} is ${status}`,
    "",
    projection.summary,
    blockers.length > 0 ? "" : "",
    ...blockers,
    ...causeChain
  ]
    .filter(Boolean)
    .join("\n");
}

function renderSnapshot(projection: SnapshotInspectorProjection): string {
  if (projection.status !== "ready") {
    return projection.message;
  }

  return [
    `Snapshot version: ${projection.version}`,
    `Schema hash: ${projection.schemaHash}`,
    ...projection.fields.slice(0, 12).map(
      (field) => `  - ${field.path}: ${JSON.stringify(field.value)}`
    )
  ].join("\n");
}

function renderTrace(projection: TraceReplayProjection): string {
  if (projection.status !== "ready") {
    return projection.message;
  }

  return [
    `Intent: ${projection.intentType}`,
    `Duration: ${projection.duration}`,
    `Terminated by: ${projection.terminatedBy}`,
    "Steps:",
    ...projection.steps.map(
      (step) => `  - ${step.traceNodeId} (${step.kind}) @ ${step.sourcePath}`
    )
  ].join("\n");
}

function renderLineage(projection: LineageStateProjection): string {
  if (projection.status !== "ready") {
    return projection.message;
  }

  return [
    `Active branch: ${projection.activeBranchId}`,
    `Branches: ${projection.branches.length}`,
    `Worlds: ${projection.worlds.length}`,
    ...projection.branches.map(
      (branch) =>
        `  - ${branch.id}: head=${branch.headWorldId ?? "none"} tip=${branch.tipWorldId ?? "none"} epoch=${branch.epoch}`
    )
  ].join("\n");
}

function renderGovernance(projection: GovernanceStateProjection): string {
  if (projection.status !== "ready") {
    return projection.message;
  }

  return [
    `Proposals: ${projection.proposals.length}`,
    `Bindings: ${projection.bindings.length}`,
    `Gates: ${projection.gates.length}`,
    ...projection.proposals.map(
      (proposal) =>
        `  - ${proposal.id}: ${proposal.stage} on ${proposal.branchId} by ${proposal.actorId}`
    )
  ].join("\n");
}

function renderTransitionGraph(projection: TransitionGraphProjection): string {
  if (projection.status !== "ready") {
    return [
      `Preset: ${projection.presetName} (${projection.presetId})`,
      projection.message
    ].join("\n");
  }

  const lines = [
    `Preset: ${projection.presetName} (${projection.presetId})`,
    `Current node: ${projection.currentNodeId ?? "none"}`,
    `Nodes: ${projection.nodes.length}`,
    `Edges: ${projection.edges.length}`,
    "Nodes:",
    ...projection.nodes.map(
      (node) =>
        `  - ${node.label} [id=${node.id}] observations=${node.observationCount} current=${node.current}`
    ),
    "Edges:",
    ...projection.edges.map(
      (edge) =>
        `  - ${edge.actionId}: ${edge.source} -> ${edge.target} changed=${edge.changedDimensions.join(", ") || "none"} live=${edge.liveCount} dryRun=${edge.dryRunCount} blocked=${edge.blockedCount}`
    )
  ];

  return lines.join("\n");
}

function renderText(command: string, result: StudioOperationResult): string {
  switch (command) {
    case "analyze":
    case "check":
      return renderFindingsReport(result as FindingsReportProjection);
    case "graph":
      return renderGraph(result as DomainGraphProjection);
    case "explain":
      return renderActionBlocker(result as ActionBlockerProjection);
    case "trace":
      return renderTrace(result as TraceReplayProjection);
    case "availability":
      return renderAvailability(result as ActionAvailabilityProjection[]);
    case "snapshot":
      return renderSnapshot(result as SnapshotInspectorProjection);
    case "lineage":
      return renderLineage(result as LineageStateProjection);
    case "governance":
      return renderGovernance(result as GovernanceStateProjection);
    case "transition-graph":
      return renderTransitionGraph(result as TransitionGraphProjection);
    default:
      return JSON.stringify(result, null, 2);
  }
}

function writeHelp(): void {
  process.stdout.write(`${HELP_TEXT}\n`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;

  if (
    normalizedArgv.length === 0 ||
    normalizedArgv[0] === "help" ||
    normalizedArgv[0] === "--help"
  ) {
    writeHelp();
    return 0;
  }

  const [command, ...rest] = normalizedArgv;

  try {
    const parsed = parseArgs(rest);
    const input = buildFileInput(command, parsed);
    const operation = buildOperation(command, parsed);
    const graphFormat = getLastFlag(parsed.flags, "format");
    const output =
      command === "graph" && graphFormat === "json"
        ? "json"
        : getLastFlag(parsed.flags, "output") ?? "text";
    const result = await executeStudioOperation(input, operation);

    process.stdout.write(
      command === "graph" && graphFormat === "dot"
        ? `${renderGraphAsDot(result as DomainGraphProjection)}\n`
        : output === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${renderText(command, result)}\n`
    );

    return 0;
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`${error.message}\n\n`);
      writeHelp();
      return 1;
    }

    process.stderr.write(
      `${error instanceof Error ? error.message : "Unknown CLI error"}\n`
    );
    return 1;
  }
}
