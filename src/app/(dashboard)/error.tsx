"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, LayoutDashboard, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpsLockup } from "@/components/brand";
import { cn } from "@/lib/utils/cn";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error("[OPS Dashboard] Route error:", error);
  }, [error]);

  return (
    <div
      className="flex items-start justify-center min-h-[calc(100vh-4rem)] px-6 py-10"
      role="alert"
    >
      <div className="w-full max-w-[520px] flex flex-col gap-3">
        {/* Tactical header strip */}
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-status-rose animate-pulse-live"
          />
          <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
            SYS :: ROUTE FAULT
          </span>
          <span className="font-mono text-micro text-text-mute">{"//"}</span>
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            HANDLER STOPPED
          </span>
        </div>

        {/* Title block */}
        <div className="flex flex-col gap-1">
          <h2 className="font-cakemono font-light uppercase text-[28px] leading-[1.1] text-text">
            Something broke
          </h2>
          <p className="font-mohave text-body-sm text-text-3 leading-relaxed">
            An unexpected error halted this view. The rest of the dashboard is
            unaffected. Retry the action or fall back to the home deck.
          </p>
        </div>

        {/* Glass diagnostic panel */}
        <div className="glass-surface px-3 py-2 mt-1">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between text-left -mx-1 px-1 py-1 rounded-[5px] hover:bg-surface-hover-subtle transition-colors"
            aria-expanded={showDetails}
          >
            <span className="font-mono text-micro uppercase tracking-wider text-text-3">
              {"// DIAGNOSTIC"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                {showDetails ? "HIDE" : "SHOW"}
              </span>
              <ChevronDown
                className={cn(
                  "w-[12px] h-[12px] text-text-mute transition-transform duration-200",
                  showDetails && "rotate-180"
                )}
                aria-hidden="true"
              />
            </span>
          </button>

          {showDetails && (
            <div className="mt-2 pt-2 border-t border-border-subtle animate-fade-in flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-micro uppercase tracking-wider text-text-mute shrink-0">
                  [MSG]
                </span>
                <p className="font-mono text-data-sm text-text-2 break-all leading-relaxed">
                  {error.message || "Unknown error"}
                </p>
              </div>
              {error.digest && (
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-micro uppercase tracking-wider text-text-mute shrink-0">
                    [DIGEST]
                  </span>
                  <p className="font-mono text-micro text-text-3 break-all">
                    {error.digest}
                  </p>
                </div>
              )}
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-micro uppercase tracking-wider text-text-mute shrink-0">
                  [TIME]
                </span>
                <p className="font-mono text-micro text-text-3">
                  {new Date().toISOString()}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-1">
          <Button
            variant="primary"
            size="sm"
            onClick={reset}
            className="gap-1.5"
          >
            <RefreshCw className="w-[14px] h-[14px]" aria-hidden="true" />
            Retry
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => router.push("/dashboard")}
            className="gap-1.5"
          >
            <LayoutDashboard className="w-[14px] h-[14px]" aria-hidden="true" />
            Dashboard
          </Button>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-1.5 mt-4 opacity-40">
          <OpsLockup
            orientation="horizontal"
            title=""
            className="select-none h-3 w-auto text-text-mute"
          />
          <span className="font-mono text-micro text-text-mute select-none uppercase tracking-wider">
            {"// ERROR BOUNDARY"}
          </span>
        </div>
      </div>
    </div>
  );
}
