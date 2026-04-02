import { useState } from "react";
import { FindingList } from "@manifesto-ai/studio-ui";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger
} from "@manifesto-ai/ui-core";

import { useStudioState } from "../../context/studio-context.js";
import { useFindings } from "../../hooks/use-studio.js";
import { formatDiagnostic } from "../../authoring.js";
import type { Diagnostic } from "@manifesto-ai/compiler";

export function DiagnosticsFooter() {
  const [tab, setTab] = useState("diagnostics");

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="pb-3">
        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            <TabsTrigger value="findings">Findings</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {tab === "diagnostics" ? <DiagnosticsPanel /> : <FindingsPanel />}
      </CardContent>
    </Card>
  );
}

function DiagnosticsPanel() {
  const state = useStudioState();
  const diagnostics = state.compilerDiagnostics;
  const errors = diagnostics.filter((d: Diagnostic) => d.severity === "error");
  const warnings = diagnostics.filter((d: Diagnostic) => d.severity === "warning");

  return (
    <ScrollArea className="h-full rounded-2xl border border-border/70 bg-background/20">
      <div className="grid gap-3 p-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="destructive">{errors.length} errors</Badge>
          <Badge variant="warning">{warnings.length} warnings</Badge>
        </div>
        {diagnostics.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No compiler diagnostics. The draft is structurally clean.
          </p>
        ) : (
          diagnostics.map((d: Diagnostic, i: number) => (
            <div
              className="rounded-xl border border-border/70 bg-background/40 p-3"
              key={`${d.code}:${i}`}
            >
              <div className="flex items-center justify-between gap-3">
                <Badge
                  variant={
                    d.severity === "error"
                      ? "destructive"
                      : d.severity === "warning"
                        ? "warning"
                        : "outline"
                  }
                >
                  {d.severity}
                </Badge>
                <span className="text-xs text-muted-foreground">{d.code}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {formatDiagnostic(d)}
              </p>
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  );
}

function FindingsPanel() {
  const findings = useFindings();

  if (!findings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Compile a valid draft to run studio analysis.
      </div>
    );
  }

  if (findings.findings.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No studio findings. The current compiled graph looks clean.
      </div>
    );
  }

  return <FindingList report={findings} />;
}
