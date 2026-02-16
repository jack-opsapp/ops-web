"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

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
            "flex min-h-[400px] flex-col items-center justify-center gap-6 p-8",
            "bg-background text-text-primary",
            this.props.className
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
              An unexpected error occurred. You can try again or contact support
              if the problem persists.
            </p>
          </div>

          {/* Error details */}
          {this.state.error && (
            <div
              className={cn(
                "w-full max-w-lg rounded-lg p-4",
                "border border-border-primary bg-background-elevated"
              )}
            >
              <p className="font-mono text-xs leading-relaxed text-text-tertiary break-all">
                {this.state.error.message}
              </p>
            </div>
          )}

          {/* Retry button */}
          <button
            type="button"
            onClick={this.handleReset}
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
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
