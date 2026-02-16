"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[OPS Dashboard] Route error:", error);
  }, [error]);

  return (
    <div
      className={cn(
        "flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-6 p-8",
        "bg-background text-text-primary"
      )}
      role="alert"
    >
      {/* Error icon */}
      <div
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-full",
          "border border-ops-error/40 bg-ops-error/10"
        )}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-8 w-8 text-ops-error"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      {/* Message */}
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-mohave text-heading-md text-text-primary">
          Something went wrong
        </h2>
        <p className="max-w-md font-mohave text-body-sm text-text-secondary">
          An unexpected error occurred in the dashboard. You can try again or
          navigate to a different page.
        </p>
      </div>

      {/* Error details */}
      <div
        className={cn(
          "w-full max-w-lg rounded-lg p-4",
          "border border-border-primary bg-background-elevated"
        )}
      >
        <p className="font-mono text-xs leading-relaxed text-text-tertiary break-all">
          {error.message}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-text-disabled">
            Digest: {error.digest}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3",
            "font-mohave text-body-md font-medium",
            "bg-ops-accent text-white",
            "transition-colors hover:bg-ops-accent/80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Try again
        </button>

        <a
          href="/dashboard"
          className={cn(
            "inline-flex items-center justify-center rounded-lg px-6 py-3",
            "font-mohave text-body-md font-medium",
            "border border-border-primary text-text-secondary",
            "transition-colors hover:bg-background-elevated hover:text-text-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
        >
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}
