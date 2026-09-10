"use client";

/** Shared panel chrome for the engine console: the `//` label, a skeleton, a status line. */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export function PanelLabel({ id, children, count }: { id?: string; children: ReactNode; count?: number }) {
  return (
    <h2 id={id} className="flex items-baseline gap-1 font-mono text-micro uppercase tracking-wider text-text-3">
      <span>{children}</span>
      {typeof count === "number" && <span className="tabular-nums text-text-2">{count}</span>}
    </h2>
  );
}

export function PanelSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("mt-1 space-y-1", className)} role="status" aria-label="loading" data-testid="panel-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-6 animate-pulse rounded-panel bg-fill-neutral-dim motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export function PanelStatus({ children, tone = "quiet", action }: { children: ReactNode; tone?: "quiet" | "error"; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mt-1 flex items-center gap-2 border-l-2 border-line py-1 pl-2" role={tone === "error" ? "alert" : undefined}>
      <p className={cn("font-mohave text-body-sm", tone === "error" ? "text-rose" : "text-text-3")}>{children}</p>
      {action && (
        <Button variant="ghost" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
