import type * as React from "react";

import { cn } from "@manifesto-ai/ui-core";

export type StudioWorkbenchProps = {
  masthead: React.ReactNode;
  sidebar: React.ReactNode;
  canvas: React.ReactNode;
  inspector: React.ReactNode;
  footer?: React.ReactNode;
  sidebarWidth?: string;
  inspectorWidth?: string;
  footerHeight?: string;
};

export function StudioWorkbench({
  masthead,
  sidebar,
  canvas,
  inspector,
  footer,
  sidebarWidth = "380px",
  inspectorWidth = "360px",
  footerHeight = "280px"
}: StudioWorkbenchProps) {
  return (
    <main className="flex h-screen w-full flex-col gap-3 overflow-hidden p-3">
      {masthead}
      <section
        className="grid min-h-0 flex-1 gap-3"
        style={{
          gridTemplateColumns: `${sidebarWidth} minmax(0, 1fr) ${inspectorWidth}`,
          gridTemplateRows: footer ? `minmax(0, 1fr) ${footerHeight}` : "minmax(0, 1fr)"
        }}
      >
        <div className={cn("flex min-h-0 flex-col gap-3 overflow-hidden")}>
          {sidebar}
        </div>
        <div
          className={cn("min-h-0 overflow-hidden", footer ? "row-span-1" : "row-span-1")}
        >
          {canvas}
        </div>
        <div className={cn("flex min-h-0 flex-col gap-3 overflow-hidden")}>
          {inspector}
        </div>
        {footer ? (
          <div className="col-span-3 min-h-0 overflow-hidden">{footer}</div>
        ) : null}
      </section>
    </main>
  );
}
