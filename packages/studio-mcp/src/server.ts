import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  AnalysisBundle,
  DomainSchema,
  FindingsFilter,
  StudioSessionOptions
} from "@manifesto-ai/studio-core";
import {
  executeStudioOperationFromBundle,
  loadAnalysisBundleFromFiles,
  type StudioFileInput
} from "@manifesto-ai/studio-node";

type ParsedArgs = {
  flags: Map<string, string[]>;
  positionals: string[];
};

type ToolCommonArgs = {
  bundle_path?: string;
  schema_path?: string;
  mel_path?: string;
  snapshot_path?: string;
  trace_path?: string;
  lineage_path?: string;
  governance_path?: string;
  validation_mode?: "lenient" | "strict";
  lineage_stale_ms?: number;
  governance_proposal_stale_ms?: number;
  schema?: DomainSchema;
  snapshot?: AnalysisBundle["snapshot"];
  trace_graph?: AnalysisBundle["trace"];
  lineage?: AnalysisBundle["lineage"];
  governance?: AnalysisBundle["governance"];
};

type ServerDefaults = {
  fileInput: StudioFileInput;
  bundle?: AnalysisBundle;
};

type ServerTransportMode = "stdio" | "http";

type HttpServerOptions = {
  host: string;
  port: number;
  endpoint: string;
};

const HELP_TEXT = `studio-mcp

Usage:
  studio-mcp [options]

Transport options:
  --transport <stdio|http>        Default: stdio
  --host <hostname>               HTTP mode only. Default: 127.0.0.1
  --port <number>                 HTTP mode only. Default: 8787
  --endpoint <path>               HTTP mode only. Default: /mcp

Default context options:
  --bundle <file>                  Load an analysis bundle JSON file
  --schema <file>                  Load a DomainSchema JSON file
  --mel <file>                     Load and compile a MEL file
  --snapshot <file>                Default Snapshot JSON file
  --trace <file>                   Default TraceGraph JSON file
  --lineage <file>                 Default lineage export JSON file
  --governance <file>              Default governance export JSON file
  --validation-mode <lenient|strict>
  --lineage-stale-ms <number>
  --governance-proposal-stale-ms <number>

The server exposes the PRD tool surface:
  explain_action_blocker
  get_domain_graph
  find_issues
  get_action_availability
  analyze_trace
  get_lineage_state
  get_governance_state

Notes:
  - stdio mode is appropriate for local desktop extensions.
  - http mode serves a Streamable HTTP MCP endpoint for remote clients.
  - Claude Desktop remote connectors require a remotely reachable HTTPS URL in front of this server.
`;

const commonInputShape = {
  bundle_path: z.string().optional(),
  schema_path: z.string().optional(),
  mel_path: z.string().optional(),
  snapshot_path: z.string().optional(),
  trace_path: z.string().optional(),
  lineage_path: z.string().optional(),
  governance_path: z.string().optional(),
  validation_mode: z.enum(["lenient", "strict"]).optional(),
  lineage_stale_ms: z.number().int().nonnegative().optional(),
  governance_proposal_stale_ms: z.number().int().nonnegative().optional(),
  schema: z.any().optional(),
  snapshot: z.any().optional(),
  trace_graph: z.any().optional(),
  lineage: z.any().optional(),
  governance: z.any().optional()
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
    throw new Error(`Flag "--${key}" must be a finite number.`);
  }

  return parsed;
}

function normalizePathPathname(pathname: string | undefined): string {
  if (!pathname || pathname === "/") {
    return "/mcp";
  }

  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function buildDefaultFileInput(argv: string[]): StudioFileInput {
  const parsed = parseArgs(argv);
  const melPath = getLastFlag(parsed.flags, "mel");

  return {
    cwd: process.cwd(),
    bundlePath: getLastFlag(parsed.flags, "bundle"),
    schemaPath: getLastFlag(parsed.flags, "schema") ?? melPath,
    snapshotPath: getLastFlag(parsed.flags, "snapshot"),
    tracePath: getLastFlag(parsed.flags, "trace"),
    lineagePath: getLastFlag(parsed.flags, "lineage"),
    governancePath: getLastFlag(parsed.flags, "governance"),
    sessionOptions: {
      validationMode: getLastFlag(parsed.flags, "validation-mode") as
        | "lenient"
        | "strict"
        | undefined,
      lineageStaleMs: parseNumberFlag(parsed.flags, "lineage-stale-ms"),
      governanceProposalStaleMs: parseNumberFlag(
        parsed.flags,
        "governance-proposal-stale-ms"
      )
    }
  };
}

function buildTransportMode(argv: string[]): ServerTransportMode {
  const parsed = parseArgs(argv);
  const raw = getLastFlag(parsed.flags, "transport");

  if (!raw || raw === "stdio") {
    return "stdio";
  }

  if (raw === "http") {
    return "http";
  }

  throw new Error(`Unsupported transport "${raw}". Use "stdio" or "http".`);
}

function buildHttpServerOptions(argv: string[]): HttpServerOptions {
  const parsed = parseArgs(argv);

  return {
    host: getLastFlag(parsed.flags, "host") ?? "127.0.0.1",
    port: parseNumberFlag(parsed.flags, "port") ?? 8787,
    endpoint: normalizePathPathname(getLastFlag(parsed.flags, "endpoint"))
  };
}

function hasPathSource(input: StudioFileInput): boolean {
  return Boolean(
    input.bundlePath ||
      input.schemaPath ||
      input.snapshotPath ||
      input.tracePath ||
      input.lineagePath ||
      input.governancePath
  );
}

function mergeSessionOptions(
  base: StudioSessionOptions | undefined,
  override: StudioSessionOptions | undefined
): StudioSessionOptions | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    validationMode: override?.validationMode ?? base?.validationMode,
    lineageStaleMs: override?.lineageStaleMs ?? base?.lineageStaleMs,
    governanceProposalStaleMs:
      override?.governanceProposalStaleMs ?? base?.governanceProposalStaleMs
  };
}

function toOverrideFileInput(args: ToolCommonArgs): StudioFileInput {
  const schemaPath = args.schema_path ?? args.mel_path;

  if (args.bundle_path) {
    return {
      cwd: process.cwd(),
      bundlePath: args.bundle_path,
      sessionOptions: {
        validationMode: args.validation_mode,
        lineageStaleMs: args.lineage_stale_ms,
        governanceProposalStaleMs: args.governance_proposal_stale_ms
      }
    };
  }

  return {
    cwd: process.cwd(),
    schemaPath,
    snapshotPath: args.snapshot_path,
    tracePath: args.trace_path,
    lineagePath: args.lineage_path,
    governancePath: args.governance_path,
    sessionOptions: {
      validationMode: args.validation_mode,
      lineageStaleMs: args.lineage_stale_ms,
      governanceProposalStaleMs: args.governance_proposal_stale_ms
    }
  };
}

function mergeFileInputs(
  base: StudioFileInput,
  override: StudioFileInput
): StudioFileInput {
  if (override.bundlePath) {
    return {
      cwd: base.cwd ?? override.cwd ?? process.cwd(),
      bundlePath: override.bundlePath,
      sessionOptions: mergeSessionOptions(base.sessionOptions, override.sessionOptions)
    };
  }

  const overrideHasPerFileInput = Boolean(
    override.schemaPath ||
      override.snapshotPath ||
      override.tracePath ||
      override.lineagePath ||
      override.governancePath
  );

  if (!overrideHasPerFileInput) {
    return {
      ...base,
      sessionOptions: mergeSessionOptions(base.sessionOptions, override.sessionOptions)
    };
  }

  return {
    cwd: base.cwd ?? override.cwd ?? process.cwd(),
    bundlePath: undefined,
    schemaPath: override.schemaPath ?? base.schemaPath,
    snapshotPath: override.snapshotPath ?? base.snapshotPath,
    tracePath: override.tracePath ?? base.tracePath,
    lineagePath: override.lineagePath ?? base.lineagePath,
    governancePath: override.governancePath ?? base.governancePath,
    sessionOptions: mergeSessionOptions(base.sessionOptions, override.sessionOptions)
  };
}

function cloneBundle(bundle: AnalysisBundle | undefined): AnalysisBundle | undefined {
  return bundle ? structuredClone(bundle) : undefined;
}

function applyInlineOverrides(
  bundle: AnalysisBundle | undefined,
  args: ToolCommonArgs
): AnalysisBundle {
  const next = cloneBundle(bundle) ?? ({} as Partial<AnalysisBundle>);

  if (args.schema) {
    next.schema = args.schema;
  }

  if (args.snapshot !== undefined) {
    next.snapshot = args.snapshot;
  }

  if (args.trace_graph !== undefined) {
    next.trace = args.trace_graph;
  }

  if (args.lineage !== undefined) {
    next.lineage = args.lineage;
  }

  if (args.governance !== undefined) {
    next.governance = args.governance;
  }

  if (!next.schema) {
    throw new Error(
      "No DomainSchema is available. Start the server with --bundle/--schema/--mel or provide schema/schema_path in the tool call."
    );
  }

  return next as AnalysisBundle;
}

async function resolveBundle(
  defaults: ServerDefaults,
  args: ToolCommonArgs
): Promise<{
  bundle: AnalysisBundle;
  sessionOptions: StudioSessionOptions | undefined;
}> {
  const overrideInput = toOverrideFileInput(args);
  const mergedInput = mergeFileInputs(defaults.fileInput, overrideInput);
  const shouldLoadFromFiles = hasPathSource(mergedInput) && (
    hasPathSource(overrideInput) || !defaults.bundle
  );
  const fileBundle = shouldLoadFromFiles
    ? await loadAnalysisBundleFromFiles(mergedInput)
    : defaults.bundle;

  return {
    bundle: applyInlineOverrides(fileBundle, args),
    sessionOptions: mergedInput.sessionOptions
  };
}

function jsonContent(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toolSuccess(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: jsonContent(value)
      }
    ]
  };
}

function toolError(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : "Unknown MCP tool error"
      }
    ],
    isError: true
  };
}

function resourceContents(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: jsonContent(value)
      }
    ]
  };
}

function summarizeSchema(schema: DomainSchema) {
  return {
    id: schema.id,
    version: schema.version,
    hash: schema.hash,
    meta: schema.meta ?? null,
    types: Object.keys(schema.types).sort(),
    state: Object.keys(schema.state.fields).sort(),
    computed: Object.keys(schema.computed.fields).sort(),
    actions: Object.keys(schema.actions).sort()
  };
}

function createFindingsFilter(args: {
  severity?: Array<"error" | "warn" | "info">;
  kinds?: string[];
  subjects?: string[];
  provenance?: Array<"static" | "runtime" | "trace" | "lineage" | "governance">;
}): FindingsFilter | undefined {
  if (
    !args.severity &&
    !args.kinds &&
    !args.subjects &&
    !args.provenance
  ) {
    return undefined;
  }

  return {
    severity: args.severity,
    kinds: args.kinds,
    subjects: args.subjects,
    provenance: args.provenance
  };
}

async function buildDefaults(fileInput: StudioFileInput): Promise<ServerDefaults> {
  if (!hasPathSource(fileInput)) {
    return { fileInput };
  }

  return {
    fileInput,
    bundle: await loadAnalysisBundleFromFiles(fileInput)
  };
}

async function withOperation(
  defaults: ServerDefaults,
  args: ToolCommonArgs,
  operation:
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
        kind: "trace";
      }
    | {
        kind: "lineage";
      }
    | {
        kind: "governance";
      }
): Promise<unknown> {
  const { bundle, sessionOptions } = await resolveBundle(defaults, args);
  return executeStudioOperationFromBundle(bundle, operation, sessionOptions);
}

export function createStudioMcpServer(defaults: ServerDefaults): McpServer {
  const server = new McpServer({
    name: "@manifesto-ai/studio-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "explain_action_blocker",
    {
      description: "Explains why a specific action is currently unavailable, available, or structurally unreachable.",
      inputSchema: {
        ...commonInputShape,
        action_id: z.string()
      }
    },
    async (args) => {
      try {
        return toolSuccess(
          await withOperation(defaults, args, {
            kind: "explain-action",
            actionId: args.action_id
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "get_domain_graph",
    {
      description: "Returns the semantic domain graph projection.",
      inputSchema: {
        ...commonInputShape,
        format: z.enum(["summary", "full"]).optional()
      }
    },
    async (args) => {
      try {
        return toolSuccess(
          await withOperation(defaults, args, {
            kind: "graph",
            format: args.format
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "find_issues",
    {
      description: "Runs static and overlay-aware findings analysis.",
      inputSchema: {
        ...commonInputShape,
        severity: z.array(z.enum(["error", "warn", "info"])).optional(),
        kinds: z.array(z.string()).optional(),
        subjects: z.array(z.string()).optional(),
        provenance: z
          .array(z.enum(["static", "runtime", "trace", "lineage", "governance"]))
          .optional()
      }
    },
    async (args) => {
      try {
        return toolSuccess(
          await withOperation(defaults, args, {
            kind: "findings",
            filter: createFindingsFilter(args)
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "get_action_availability",
    {
      description: "Returns availability state for all actions using the provided or default snapshot.",
      inputSchema: commonInputShape
    },
    async (args) => {
      try {
        return toolSuccess(
          await withOperation(defaults, args, {
            kind: "availability"
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "analyze_trace",
    {
      description: "Analyzes a trace overlay and returns replay-style execution projection.",
      inputSchema: commonInputShape
    },
    async (args) => {
      try {
        return toolSuccess(
          await withOperation(defaults, args, {
            kind: "trace"
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "get_lineage_state",
    {
      description: "Returns lineage branch, world, and seal state.",
      inputSchema: commonInputShape
    },
    async (args) => {
      try {
        return toolSuccess(
          await withOperation(defaults, args, {
            kind: "lineage"
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "get_governance_state",
    {
      description: "Returns governance proposal, actor, and gate state.",
      inputSchema: commonInputShape
    },
    async (args) => {
      try {
        return toolSuccess(
          await withOperation(defaults, args, {
            kind: "governance"
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerResource(
    "domain-graph",
    "studio://domain/graph",
    {
      title: "Domain Graph",
      description: "Current domain graph projection from the default server context."
    },
    async (uri) => {
      if (!defaults.bundle) {
        return resourceContents(uri.toString(), {
          error: "No default DomainSchema loaded. Start studio-mcp with --bundle, --schema, or --mel."
        });
      }

      return resourceContents(
        uri.toString(),
        executeStudioOperationFromBundle(
          defaults.bundle,
          {
            kind: "graph",
            format: "full"
          },
          defaults.fileInput.sessionOptions
        )
      );
    }
  );

  server.registerResource(
    "domain-findings",
    "studio://domain/findings",
    {
      title: "Domain Findings",
      description: "Current findings projection from the default server context."
    },
    async (uri) => {
      if (!defaults.bundle) {
        return resourceContents(uri.toString(), {
          error: "No default DomainSchema loaded. Start studio-mcp with --bundle, --schema, or --mel."
        });
      }

      return resourceContents(
        uri.toString(),
        executeStudioOperationFromBundle(
          defaults.bundle,
          {
            kind: "findings"
          },
          defaults.fileInput.sessionOptions
        )
      );
    }
  );

  server.registerResource(
    "domain-schema",
    "studio://domain/schema",
    {
      title: "Domain Schema Summary",
      description: "Current default DomainSchema summary."
    },
    async (uri) => {
      if (!defaults.bundle) {
        return resourceContents(uri.toString(), {
          error: "No default DomainSchema loaded. Start studio-mcp with --bundle, --schema, or --mel."
        });
      }

      return resourceContents(
        uri.toString(),
        summarizeSchema(defaults.bundle.schema)
      );
    }
  );

  return server;
}

function getHeaderValue(
  request: IncomingMessage,
  headerName: string
): string | undefined {
  const value = request.headers[headerName];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (raw.length === 0) {
    return undefined;
  }

  return JSON.parse(raw) as unknown;
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function writeTextResponse(
  response: ServerResponse,
  statusCode: number,
  body: string
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

async function startHttpServer(
  defaults: ServerDefaults,
  options: HttpServerOptions
): Promise<HttpServer> {
  const sessions = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      server: McpServer;
    }
  >();
  let shuttingDown = false;

  const handleMcpPost = async (
    request: IncomingMessage,
    response: ServerResponse
  ) => {
    const sessionId = getHeaderValue(request, "mcp-session-id");

    try {
      const parsedBody = await readJsonBody(request);
      let current = sessionId ? sessions.get(sessionId) : undefined;

      if (!current && !sessionId && isInitializeRequest(parsedBody)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (nextSessionId) => {
            sessions.set(nextSessionId, {
              transport,
              server
            });
          }
        });
        const server = createStudioMcpServer(defaults);

        transport.onclose = () => {
          const closedSessionId = transport.sessionId;

          if (!closedSessionId) {
            return;
          }

          sessions.delete(closedSessionId);
        };

        await server.connect(transport);
        await transport.handleRequest(request, response, parsedBody);
        return;
      }

      if (!current) {
        writeJsonResponse(response, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided"
          },
          id: null
        });
        return;
      }

      await current.transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      if (response.headersSent) {
        return;
      }

      writeJsonResponse(response, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal server error"
        },
        id: null
      });
    }
  };

  const handleMcpGetOrDelete = async (
    request: IncomingMessage,
    response: ServerResponse
  ) => {
    const sessionId = getHeaderValue(request, "mcp-session-id");

    if (!sessionId) {
      writeTextResponse(response, 400, "Invalid or missing session ID");
      return;
    }

    const current = sessions.get(sessionId);

    if (!current) {
      writeTextResponse(response, 404, "Unknown session ID");
      return;
    }

    try {
      await current.transport.handleRequest(request, response);
    } catch (error) {
      if (response.headersSent) {
        return;
      }

      writeTextResponse(
        response,
        500,
        error instanceof Error ? error.message : "Internal server error"
      );
    }
  };

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? `${options.host}:${options.port}`}`
    );

    if (requestUrl.pathname === "/healthz") {
      writeJsonResponse(response, 200, {
        ok: true,
        transport: "http",
        endpoint: options.endpoint
      });
      return;
    }

    if (requestUrl.pathname === "/") {
      writeJsonResponse(response, 200, {
        name: "@manifesto-ai/studio-mcp",
        transport: "http",
        endpoint: options.endpoint,
        health: "/healthz"
      });
      return;
    }

    if (requestUrl.pathname !== options.endpoint) {
      writeTextResponse(response, 404, "Not Found");
      return;
    }

    if (request.method === "POST") {
      await handleMcpPost(request, response);
      return;
    }

    if (request.method === "GET" || request.method === "DELETE") {
      await handleMcpGetOrDelete(request, response);
      return;
    }

    writeTextResponse(response, 405, "Method Not Allowed");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  process.stderr.write(
    `studio-mcp http listening on http://${options.host}:${options.port}${options.endpoint}\n`
  );

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    for (const [sessionId, current] of sessions.entries()) {
      try {
        await current.server.close();
      } catch {
        // Ignore shutdown errors.
      } finally {
        sessions.delete(sessionId);
      }
    }
  };

  const closeHttpServer = async () => {
    await shutdown();

    if (!server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  const handleSignal = (exitCode: number) => {
    void closeHttpServer()
      .catch(() => {
        // Ignore shutdown errors on process signal.
      })
      .finally(() => {
        process.exit(exitCode);
      });
  };

  const onSigint = () => {
    handleSignal(0);
  };
  const onSigterm = () => {
    handleSignal(0);
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  server.on("close", () => {
    void shutdown();
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  });

  return server;
}

export async function runServer(argv = process.argv.slice(2)): Promise<void> {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;

  if (normalizedArgv.includes("--help")) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }

  const defaults = await buildDefaults(buildDefaultFileInput(normalizedArgv));
  const transportMode = buildTransportMode(normalizedArgv);

  if (transportMode === "http") {
    await startHttpServer(defaults, buildHttpServerOptions(normalizedArgv));
    return;
  }

  const server = createStudioMcpServer(defaults);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
