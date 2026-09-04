"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  className?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary for OPS.
 * Class component is required -- React does not support error boundaries
 * with function components / hooks.
 */
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[OPS ErrorBoundary] Uncaught error:", error);
    console.error("[OPS ErrorBoundary] Component stack:", errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className={cn(
            "flex min-h-[400px] flex-col justify-center gap-6 p-8",
            "bg-background text-text",
            this.props.className
          )}
          role="alert"
        >
          {/* Error icon */}
          <div
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded",
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
          <div className="flex flex-col gap-2">
            <h2 className="font-mohave text-heading-md text-text">
              Something went wrong
            </h2>
            <p className="max-w-md font-mohave text-body-sm text-text-2">
              An unexpected error occurred. You can try again or contact support
              if the problem persists.
            </p>
          </div>

          {/* Error details */}
          {this.state.error && (
            <div
              className={cn(
                "w-full max-w-lg rounded p-4",
                "border border-border-primary bg-fill-neutral-dim"
              )}
            >
              <p className="font-mono text-xs leading-relaxed text-text-3 break-all">
                {this.state.error.message}
              </p>
            </div>
          )}

          {/* Retry button — the one primary CTA on the fallback */}
          <Button
            type="button"
            variant="primary"
            onClick={this.handleReset}
            className="w-fit"
          >
            <RefreshCw className="h-icon-16 w-icon-16" aria-hidden="true" />
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
