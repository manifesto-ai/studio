import { useEffect, useRef, useState } from "react";
import {
  createStudioSession,
  type FindingsReportProjection,
  type StudioSession,
  type SnapshotInspectorProjection
} from "@manifesto-ai/studio-core";
import {
  createManifesto,
  type ManifestoBaseInstance,
  type TypedActionRef,
  type TypedIntent
} from "@manifesto-ai/sdk";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@manifesto-ai/ui-core";
import {
  ActionAvailabilityList,
  ActionBlockerCard,
  DomainGraphView,
  FindingList,
  StudioWorkbench
} from "@manifesto-ai/studio-ui";
import type { CoinSapiens } from "./generated/coin-sapiens.domain";

import coinSapiensSchema from "./domain/coin-sapiens.mel";

type CoinSapiensActionId = keyof CoinSapiens["actions"] & string;
type CoinSapiensActionRef = TypedActionRef<CoinSapiens, CoinSapiensActionId>;
type CoinSapiensIntent = TypedIntent<CoinSapiens, CoinSapiensActionId>;

type DemoAction = {
  id: CoinSapiensActionId;
  label: string;
  note: string;
  args: unknown[];
};

const demoActions: DemoAction[] = [
  {
    id: "perceiveMarket",
    label: "Perceive BTC 42k / greed",
    note: "Loads market data so runtime guards can evaluate against a real price.",
    args: [42000, "greed"]
  },
  {
    id: "goLive",
    label: "Go Live",
    note: "Turns on the stream and resets silence.",
    args: []
  },
  {
    id: "tickSilence",
    label: "Tick Silence +12s",
    note: "Pushes silence beyond the 10s threshold so speaking can unlock.",
    args: [12000]
  },
  {
    id: "speak",
    label: "Speak",
    note: "Only works once the stream is live and silence has accumulated.",
    args: ["Rent is due. The chart decides whether I eat."]
  },
  {
    id: "dayPasses",
    label: "Day Passes",
    note: "Advances survival pressure and stress.",
    args: []
  },
  {
    id: "reflect",
    label: "Reflect",
    note: "Builds a fresh inner monologue from current state.",
    args: []
  },
  {
    id: "updateMood",
    label: "Mood -> anxious",
    note: "Directly mutates mood to show snapshot and findings refresh.",
    args: ["anxious"]
  },
  {
    id: "openPosition",
    label: "Open Long 100",
    note: "Expected to stay blocked because the scenario starts with zero balance.",
    args: ["long", 100]
  }
];

const focusPaths = [
  "balance",
  "daysUntilRent",
  "lastPrice",
  "marketMood",
  "marketStale",
  "mood",
  "innerVoice",
  "isLive",
  "silenceDuration"
];

function asActionId(actionId: string): CoinSapiensActionId {
  return actionId as CoinSapiensActionId;
}

function createLooseIntent(
  runtime: ManifestoBaseInstance<CoinSapiens>,
  actionId: CoinSapiensActionId,
  args: unknown[]
): CoinSapiensIntent {
  const actionRef = runtime.MEL.actions[actionId] as CoinSapiensActionRef;
  const createIntent = runtime.createIntent as (
    action: CoinSapiensActionRef,
    ...dispatchArgs: unknown[]
  ) => CoinSapiensIntent;

  return createIntent(actionRef, ...args);
}

function getSeverityScore(report: FindingsReportProjection) {
  return report.summary.bySeverity.error * 3 + report.summary.bySeverity.warn;
}

export function App() {
  const runtimeRef = useRef<ManifestoBaseInstance<CoinSapiens> | null>(null);
  const sessionRef = useRef<StudioSession | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const [selectedActionId, setSelectedActionId] =
    useState<CoinSapiensActionId>("openPosition");
  const [selectedFindingId, setSelectedFindingId] = useState<string>();
  const [pendingActionId, setPendingActionId] = useState<CoinSapiensActionId | null>(null);
  const [lastEvent, setLastEvent] = useState(
    "coin-sapiens.mel compiled and studio workbench activated."
  );
  const [, setRevision] = useState(0);

  useEffect(() => {
    bootstrap();

    return () => {
      teardownRef.current?.();
    };
  }, []);

  function rerender() {
    setRevision((value) => value + 1);
  }

  function bootstrap() {
    teardownRef.current?.();

    const manifesto = createManifesto<CoinSapiens>(coinSapiensSchema, {});
    const runtime = manifesto.activate();
    const session = createStudioSession({
      schema: coinSapiensSchema,
      snapshot: runtime.getSnapshot()
    });

    runtimeRef.current = runtime;
    sessionRef.current = session;

    const unsubscribes = [
      runtime.on("dispatch:completed", ({ intent, snapshot }) => {
        session.attachSnapshot(snapshot);
        setPendingActionId(null);
        setSelectedActionId(asActionId(intent.type));
        setLastEvent(`${intent.type} committed at snapshot v${snapshot.meta.version}.`);
        rerender();
      }),
      runtime.on("dispatch:rejected", ({ intent, reason }) => {
        setPendingActionId(null);
        setSelectedActionId(asActionId(intent.type));
        setLastEvent(`${intent.type} rejected: ${reason}`);
        rerender();
      }),
      runtime.on("dispatch:failed", ({ intent, error, snapshot }) => {
        if (snapshot) {
          session.attachSnapshot(snapshot);
        }

        setPendingActionId(null);
        setSelectedActionId(asActionId(intent.type));
        setLastEvent(`${intent.type} failed: ${error.message}`);
        rerender();
      })
    ];

    teardownRef.current = () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      session.dispose();
      runtime.dispose();
      runtimeRef.current = null;
      sessionRef.current = null;
    };

    rerender();
  }

  async function runDemo(action: DemoAction) {
    const runtime = runtimeRef.current;

    if (!runtime) {
      return;
    }

    setSelectedActionId(action.id);
    setPendingActionId(action.id);
    setLastEvent(
      `Dispatching ${action.id}(${action.args.map((value) => JSON.stringify(value)).join(", ")})`
    );

    try {
      const intent = createLooseIntent(runtime, action.id, action.args);
      await runtime.dispatchAsync(intent);
    } catch (error) {
      setPendingActionId(null);
      setLastEvent(
        error instanceof Error ? `${action.id} threw: ${error.message}` : `${action.id} threw`
      );
      rerender();
    }
  }

  function resetDemo() {
    setPendingActionId(null);
    setSelectedActionId("openPosition");
    setSelectedFindingId(undefined);
    setLastEvent("Runtime reset to genesis snapshot.");
    bootstrap();
  }

  const session = sessionRef.current;

  if (!session) {
    return null;
  }

  const graph = session.getGraph("full");
  const findings = session.getFindings();
  const availability = session.getActionAvailability();
  const blocker = session.explainActionBlocker(selectedActionId);
  const snapshot = session.inspectSnapshot();
  const actionCount = graph.nodes.filter((node) => node.kind === "action").length;
  const readyActions = availability.filter(
    (entry) => entry.status === "ready" && entry.available
  ).length;
  const selectedFinding =
    findings.findings.find((finding) => finding.id === selectedFindingId) ??
    findings.findings[0];
  const focusSnapshot =
    snapshot.status === "ready"
      ? snapshot.fields.filter((field) => focusPaths.includes(field.path)).slice(0, 8)
      : [];

  return (
    <StudioWorkbench
      canvas={
        <DomainGraphView
          onSelectNode={(nodeId) => {
            if (nodeId.startsWith("action:")) {
              setSelectedActionId(asActionId(nodeId.slice("action:".length)));
            }
          }}
          projection={graph}
          selectedNodeId={`action:${selectedActionId}`}
        />
      }
      footer={
        <Card>
          <CardHeader>
            <CardTitle>Scenario Actions</CardTitle>
            <CardDescription>
              Shared `ui-core` primitives and `studio-ui` panels can be reused in later
              devtools or runtime consoles.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {demoActions.map((action) => (
              <button
                className="rounded-xl border border-border/70 bg-background/40 p-4 text-left transition-colors hover:bg-background/60"
                key={action.id}
                onClick={() => {
                  void runDemo(action);
                }}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{action.label}</p>
                  {pendingActionId === action.id ? (
                    <Badge variant="warning">RUNNING</Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{action.note}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      }
      inspector={
        <>
          <ActionBlockerCard projection={blocker} />
          <Card>
            <CardHeader>
              <CardTitle>Snapshot Focus</CardTitle>
              <CardDescription>
                {snapshot.status === "ready"
                  ? `Snapshot v${snapshot.version}`
                  : snapshot.message}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {focusSnapshot.map((field) => (
                <div
                  className="rounded-lg border border-border/70 bg-background/40 px-3 py-2"
                  key={field.path}
                >
                  <p className="text-xs uppercase tracking-[0.22em] text-primary">
                    {field.path}
                  </p>
                  <pre className="mt-2 overflow-x-auto text-xs text-muted-foreground">
                    {JSON.stringify(field.value, null, 2)}
                  </pre>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Selected Finding</CardTitle>
              <CardDescription>
                {selectedFinding ? selectedFinding.kind : "No finding selected"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {selectedFinding ? (
                <>
                  <Badge
                    variant={
                      selectedFinding.severity === "error"
                        ? "destructive"
                        : selectedFinding.severity === "warn"
                          ? "warning"
                          : "secondary"
                    }
                  >
                    {selectedFinding.severity.toUpperCase()}
                  </Badge>
                  <p className="text-sm text-foreground">{selectedFinding.message}</p>
                  <div className="grid gap-2">
                    {selectedFinding.evidence.map((entry) => (
                      <div
                        className="rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-sm text-muted-foreground"
                        key={`${selectedFinding.id}:${entry.role}:${entry.ref.nodeId ?? entry.ref.path}`}
                      >
                        <span className="font-medium text-foreground">{entry.role}</span>{" "}
                        {entry.ref.path ?? entry.ref.nodeId}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </>
      }
      masthead={
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,220px))]">
          <Card className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Badge>Studio UI Scaffold</Badge>
                <Badge variant="outline">React Flow + shadcn/ui + Tailwind v4</Badge>
              </div>
              <CardTitle className="text-4xl leading-none tracking-tight lg:text-6xl">
                Shared studio workbench primitives for Manifesto.
              </CardTitle>
              <CardDescription className="max-w-3xl text-base">
                `ui-core` holds generic primitives. `studio-ui` composes studio-core
                projections into graph, findings, and action inspection surfaces that can
                later be reused in webapp and devtool shells.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button onClick={resetDemo} variant="secondary">
                Reset Runtime
              </Button>
              <div className="text-sm text-muted-foreground">{lastEvent}</div>
            </CardContent>
          </Card>
          <MetricCard
            label="Graph nodes"
            value={String(graph.nodeCount)}
            tone="accent"
          />
          <MetricCard
            label="Ready actions"
            value={`${readyActions}/${actionCount}`}
            tone="success"
          />
          <MetricCard
            label="Risk score"
            value={String(getSeverityScore(findings))}
            tone="warning"
          />
        </section>
      }
      sidebar={
        <>
          <ActionAvailabilityList
            availability={availability}
            onSelectAction={(actionId) => {
              setSelectedActionId(asActionId(actionId));
            }}
            selectedActionId={selectedActionId}
          />
          <FindingList
            onSelectFinding={setSelectedFindingId}
            report={findings}
            selectedFindingId={selectedFindingId}
          />
        </>
      }
    />
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  tone: "accent" | "success" | "warning";
};

function MetricCard({ label, value, tone }: MetricCardProps) {
  const toneClass =
    tone === "success"
      ? "text-emerald-300"
      : tone === "warning"
        ? "text-amber-200"
        : "text-primary";

  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={toneClass}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
