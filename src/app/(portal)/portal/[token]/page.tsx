"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle, Mail } from "lucide-react";

export default function MagicLinkLandingPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [status, setStatus] = useState<"loading" | "valid" | "expired" | "error">("loading");
  const [email, setEmail] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Validate token on mount
  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch(`/api/portal/auth/validate-token?token=${token}`);
        const data = await res.json();
        if (data.valid) {
          setStatus("valid");
        } else if (data.reason === "expired") {
          setStatus("expired");
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    }
    validateToken();
  }, [token]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setIsVerifying(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/portal/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: email.trim() }),
      });

      if (res.ok) {
        router.push("/portal/home");
      } else {
        const data = await res.json();
        setErrorMessage(data.error ?? "Verification failed");
      }
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--portal-bg, #0A0A0A)" }}
    >
      <div
        className="w-full max-w-md rounded-xl p-8"
        style={{
          backgroundColor: "var(--portal-card, #191919)",
          border: "1px solid var(--portal-border, rgba(255,255,255,0.08))",
        }}
      >
        {/* Loading */}
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--portal-accent, #417394)" }} />
            <p style={{ color: "var(--portal-text-secondary, #A7A7A7)" }} className="text-sm">
              Validating your link...
            </p>
          </div>
        )}

        {/* Token valid — show email form */}
        {status === "valid" && (
          <>
            <div className="flex flex-col items-center gap-2 mb-6">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "var(--portal-accent, #417394)" }}
              >
                <Mail className="w-6 h-6 text-white" />
              </div>
              <h1
                className="text-xl font-semibold text-center"
                style={{
                  color: "var(--portal-text, #E5E5E5)",
                  fontFamily: "var(--portal-heading-font, inherit)",
                }}
              >
                Verify your email
              </h1>
              <p
                className="text-sm text-center"
                style={{ color: "var(--portal-text-secondary, #A7A7A7)" }}
              >
                Enter the email address associated with your account to access your portal.
              </p>
            </div>

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    backgroundColor: "var(--portal-bg, #0A0A0A)",
                    color: "var(--portal-text, #E5E5E5)",
                    border: "1px solid var(--portal-border-strong, rgba(255,255,255,0.15))",
                  }}
                />
              </div>

              {errorMessage && (
                <p className="text-sm flex items-center gap-1.5" style={{ color: "var(--portal-error, #B58289)" }}>
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={isVerifying || !email.trim()}
                className="w-full py-3 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "var(--portal-accent, #417394)" }}
              >
                {isVerifying ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "Access Portal"
                )}
              </button>
            </form>
          </>
        )}

        {/* Token expired */}
        {status === "expired" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <AlertCircle className="w-10 h-10" style={{ color: "var(--portal-warning, #C4A868)" }} />
            <h1
              className="text-lg font-semibold"
              style={{ color: "var(--portal-text, #E5E5E5)" }}
            >
              Link expired
            </h1>
            <p className="text-sm" style={{ color: "var(--portal-text-secondary, #A7A7A7)" }}>
              This portal link has expired. Please contact the company for a new link.
            </p>
          </div>
        )}

        {/* Token invalid */}
        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <AlertCircle className="w-10 h-10" style={{ color: "var(--portal-error, #B58289)" }} />
            <h1
              className="text-lg font-semibold"
              style={{ color: "var(--portal-text, #E5E5E5)" }}
            >
              Invalid link
            </h1>
            <p className="text-sm" style={{ color: "var(--portal-text-secondary, #A7A7A7)" }}>
              This link is not valid. Please check your email for the correct link or contact the company.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
