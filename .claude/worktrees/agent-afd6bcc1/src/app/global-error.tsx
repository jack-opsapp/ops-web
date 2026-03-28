"use client";

import { useEffect, useState } from "react";

/**
 * Global error boundary — last resort when the root layout itself fails.
 * Must render its own <html>/<body> and cannot use Tailwind or components.
 * All styles inline, matching OPS design tokens.
 */

const COLORS = {
  bg: "#000000",
  cardBg: "rgba(13, 13, 13, 0.6)",
  border: "rgba(255, 255, 255, 0.2)",
  borderSubtle: "rgba(255, 255, 255, 0.05)",
  textPrimary: "#E5E5E5",
  textTertiary: "#777777",
  textDisabled: "#555555",
  accent: "#417394",
  accentHover: "#4d83a6",
  error: "#93321A",
  errorMuted: "rgba(147, 50, 26, 0.15)",
  errorBorder: "rgba(147, 50, 26, 0.2)",
};

const FONTS = {
  mohave: "'Mohave', ui-sans-serif, system-ui, -apple-system, sans-serif",
  kosugi: "'Kosugi', sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

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
          padding: "24px",
          backgroundColor: COLORS.bg,
          color: COLORS.textPrimary,
          fontFamily: FONTS.mohave,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            maxWidth: "440px",
            width: "100%",
          }}
        >
          {/* Error icon */}
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "12px",
              backgroundColor: COLORS.errorMuted,
              border: `1px solid ${COLORS.errorBorder}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "24px",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke={COLORS.error}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: "28px", height: "28px" }}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          {/* Title */}
          <h2
            style={{
              margin: 0,
              fontSize: "28px",
              fontWeight: 600,
              lineHeight: 1.2,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              textAlign: "center",
            }}
          >
            Critical Error
          </h2>

          {/* Subtitle */}
          <p
            style={{
              margin: "8px 0 0 0",
              fontSize: "14px",
              fontWeight: 300,
              lineHeight: 1.5,
              color: COLORS.textTertiary,
              textAlign: "center",
              maxWidth: "360px",
            }}
          >
            The application encountered a fatal error. Try refreshing the page.
          </p>

          {/* Error details - collapsible */}
          <div
            style={{
              width: "100%",
              marginTop: "24px",
              background: COLORS.cardBg,
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: `1px solid ${COLORS.border}`,
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => setShowDetails(!showDetails)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: COLORS.textDisabled,
                fontFamily: FONTS.kosugi,
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              <span>Error Details</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  width: "14px",
                  height: "14px",
                  transition: "transform 0.2s",
                  transform: showDetails ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showDetails && (
              <div
                style={{
                  padding: "0 16px 16px 16px",
                  borderTop: `1px solid ${COLORS.borderSubtle}`,
                }}
              >
                <p
                  style={{
                    margin: "12px 0 0 0",
                    fontFamily: FONTS.mono,
                    fontSize: "13px",
                    lineHeight: 1.5,
                    color: COLORS.textTertiary,
                    wordBreak: "break-all",
                  }}
                >
                  {error.message}
                </p>
                {error.digest && (
                  <p
                    style={{
                      margin: "8px 0 0 0",
                      fontFamily: FONTS.mono,
                      fontSize: "10px",
                      color: COLORS.textDisabled,
                    }}
                  >
                    DIGEST: {error.digest}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action */}
          <button
            type="button"
            onClick={reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              width: "100%",
              marginTop: "16px",
              height: "40px",
              padding: "0 16px",
              borderRadius: "5px",
              fontSize: "14px",
              fontWeight: 500,
              fontFamily: FONTS.mohave,
              textTransform: "uppercase",
              backgroundColor: COLORS.accent,
              color: "#FFFFFF",
              border: `1px solid ${COLORS.accent}`,
              cursor: "pointer",
              transition: "background-color 0.15s",
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.backgroundColor = COLORS.accentHover)
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.backgroundColor = COLORS.accent)
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
              style={{ width: "14px", height: "14px" }}
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Retry
          </button>

          {/* Branding */}
          <div
            style={{
              marginTop: "40px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              opacity: 0.3,
              userSelect: "none",
            }}
          >
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: "10px",
                color: COLORS.textDisabled,
              }}
            >
              OPS ERROR BOUNDARY
            </span>
          </div>
        </div>
      </body>
    </html>
  );
}
