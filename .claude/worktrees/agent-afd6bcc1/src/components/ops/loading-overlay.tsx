"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface LoadingOverlayProps {
  message?: string;
  className?: string;
}

function LoadingOverlay({ message, className }: LoadingOverlayProps) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-[100]",
        "flex flex-col items-center justify-center gap-2",
        "bg-black/90 backdrop-blur-xs",
        className
      )}
      role="status"
      aria-live="polite"
    >
      {/* Scan-line container */}
      <div className="relative w-[200px] h-[4px] overflow-hidden rounded-full bg-background-elevated">
        <div
          className={cn(
            "absolute top-0 left-0 h-full w-1/3 rounded-full",
            "bg-gradient-to-r from-transparent via-ops-accent to-transparent",
            "animate-[scan-line-x_1.5s_ease-in-out_infinite]"
          )}
        />
      </div>

      {/* Outer glow ring */}
      <div className="relative mt-2">
        <div
          className={cn(
            "h-[64px] w-[64px] rounded-full",
            "border border-ops-accent/30",
            "flex items-center justify-center"
          )}
        >
          <div
            className={cn(
              "h-[40px] w-[40px] rounded-full",
              "border-2 border-transparent border-t-ops-accent",
              "animate-spin"
            )}
          />
        </div>
        <div className="absolute inset-0 rounded-full shadow-glow-accent-lg animate-pulse-live" />
      </div>

      {message && (
        <p className="mt-2 font-mohave text-body-sm text-text-secondary animate-pulse-live">
          {message}
        </p>
      )}
      <span className="sr-only">Loading{message ? `: ${message}` : ""}</span>
    </div>
  );
}
LoadingOverlay.displayName = "LoadingOverlay";

export { LoadingOverlay };
