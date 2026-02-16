"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[OPS] Global error:", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "2rem",
          backgroundColor: "#000000",
          color: "#E5E5E5",
          fontFamily:
            "'Mohave', ui-sans-serif, system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Error icon */}
        <div
          style={{
            display: "flex",
            height: "4rem",
            width: "4rem",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: "1px solid rgba(147, 50, 26, 0.4)",
            backgroundColor: "rgba(147, 50, 26, 0.1)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#93321A"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ height: "2rem", width: "2rem" }}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        {/* Message */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.5rem",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 600,
              color: "#E5E5E5",
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              margin: 0,
              maxWidth: "28rem",
              fontSize: "0.875rem",
              color: "#9CA3AF",
              lineHeight: 1.6,
            }}
          >
            A critical error occurred. Please try refreshing the page. If the
            problem persists, contact support.
          </p>
        </div>

        {/* Error details */}
        <div
          style={{
            width: "100%",
            maxWidth: "32rem",
            borderRadius: "0.5rem",
            padding: "1rem",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            backgroundColor: "rgba(255, 255, 255, 0.05)",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              lineHeight: 1.6,
              color: "#6B7280",
              wordBreak: "break-all",
            }}
          >
            {error.message}
          </p>
          {error.digest && (
            <p
              style={{
                margin: "0.5rem 0 0 0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#4B5563",
              }}
            >
              Digest: {error.digest}
            </p>
          )}
        </div>

        {/* Retry button */}
        <button
          type="button"
          onClick={reset}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            borderRadius: "0.5rem",
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            fontWeight: 500,
            fontFamily:
              "'Mohave', ui-sans-serif, system-ui, -apple-system, sans-serif",
            backgroundColor: "#417394",
            color: "#FFFFFF",
            border: "none",
            cursor: "pointer",
            transition: "background-color 0.15s",
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.backgroundColor = "rgba(65, 115, 148, 0.8)")
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.backgroundColor = "#417394")
          }
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ height: "1rem", width: "1rem" }}
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Try again
        </button>
      </body>
    </html>
  );
}
