import type * as React from "react";

import { cn } from "@manifesto-ai/ui-core";

export type StudioWorkbenchProps = {
  masthead: React.ReactNode;
  sidebar: React.ReactNode;
  canvas: React.ReactNode;
  inspector: React.ReactNode;
  footer?: React.ReactNode;
};

export function StudioWorkbench({
  masthead,
  sidebar,
  canvas,
  inspector,
  footer
}: StudioWorkbenchProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-4 px-4 py-6 lg:px-6">
      {masthead}
      <section className="grid flex-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
        <div className={cn("flex min-h-[360px] flex-col gap-4")}>{sidebar}</div>
        <div className={cn("min-h-[540px]")}>{canvas}</div>
        <div className={cn("flex min-h-[360px] flex-col gap-4")}>{inspector}</div>
      </section>
      {footer ? <section>{footer}</section> : null}
    </main>
  );
}
