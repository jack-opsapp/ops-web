"use client";

import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

/**
 * QueryErrorState — fallback UI for TanStack Query errors on core
 * operations pages (calendar, map, team, projects). Renders the failure
 * in OPS tactical voice (`// FAILED ::` prefix, brick-bordered panel) and
 * exposes a retry path so users on flaky connections can recover without
 * a full page reload (bug 03241853).
 *
 * Keep this lean and dictionary-free — every consumer passes copy in
 * already-translated strings; this component just provides the layout
 * and retry affordance.
 */

export interface QueryErrorStateProps {
  /** One-line headline, e.g. "Could not load schedule." */
  title: string;
  /**
   * Optional supporting paragraph. Recommended copy: explain what part
   * of the page failed and that the data may be stale.
   */
  description?: string;
  /** Bracketed [TECHNICAL CODE] shown small below the headline. */
  errorCode?: string;
  /** Click handler for the retry button. */
  onRetry?: () => void;
  /** Disable the retry button while a refetch is in flight. */
  isRetrying?: boolean;
  /** Override the retry label. Defaults to "Retry". */
  retryLabel?: string;
  className?: string;
}

const QueryErrorState = React.forwardRef<HTMLDivElement, QueryErrorStateProps>(
  (
    {
      title,
      description,
      errorCode,
      onRetry,
      isRetrying = false,
      retryLabel = "Retry",
      className,
    },
    ref,
  ) => (
    <div
      ref={ref}
      role="alert"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 px-4 py-4 max-w-[480px]",
        "border-l-2 border-l-[#93321A]",
        "bg-[rgba(147,50,26,0.05)] rounded-r-sm",
        className,
      )}
    >
      <AlertTriangle
        className="w-[18px] h-[18px] text-[#B58289] shrink-0 mt-[2px]"
        aria-hidden="true"
      />
      <div className="flex flex-col items-start gap-1 min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#B58289]">
          {"// FAILED ::"}
        </span>
        <h3 className="font-mohave text-body-lg text-text">{title}</h3>
        {description && (
          <p className="font-mohave text-body-sm text-text-3 max-w-[400px]">
            {description}
          </p>
        )}
        {errorCode && (
          <span className="font-mono text-[10px] text-text-mute mt-0.5">
            [{errorCode}]
          </span>
        )}
        {onRetry && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
            disabled={isRetrying}
            className="mt-2 gap-1.5"
          >
            <RotateCw
              className={cn(
                "w-[14px] h-[14px]",
                isRetrying && "animate-spin",
              )}
            />
            {isRetrying ? "Retrying…" : retryLabel}
          </Button>
        )}
      </div>
    </div>
  ),
);
QueryErrorState.displayName = "QueryErrorState";

export { QueryErrorState };
