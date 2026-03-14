/**
 * AccountTypeScreen — Full-screen decision: "Run a Crew" or "Join a Crew"
 *
 * Canvas particle field background with typewriter headline,
 * staggered feature cascade, and inline crew code input for the join path.
 *
 * Routing:
 *   - "Run a Crew"  → /setup (3-phase company onboarding)
 *   - "Join a Crew" → join-company API → /employee-setup (4-step employee onboarding)
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AccountTypeCanvas } from "./AccountTypeCanvas";
import { TypewriterText } from "@/components/ui/typewriter-text";
import { useAuthStore } from "@/lib/store/auth-store";
import { getIdToken } from "@/lib/firebase/auth";

/* ------------------------------------------------------------------ */
/*  Content data                                                       */
/* ------------------------------------------------------------------ */

const OPTIONS = [
  { id: "company", label: "Run a Crew" },
  { id: "join", label: "Join a Crew" },
];

const CONTENT: Record<string, { headline: string; features: string[] }> = {
  company: {
    headline: "REGISTER YOUR COMPANY. RUN YOUR JOBS.",
    features: [
      "Create projects in seconds",
      "Assign crew with one tap",
      "See progress from the truck",
      "Works offline, syncs later",
    ],
  },
  join: {
    headline: "SEE YOUR JOBS. GET TO WORK.",
    features: [
      "Stay briefed on all your jobs",
      "One-tap directions to the site",
      "No more missed details",
      "Mark complete when done",
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AccountTypeScreen() {
  const router = useRouter();
  const { currentUser, setUser, setCompany } = useAuthStore();

  const [selected, setSelected] = useState<string | null>(null);
  const [crewCode, setCrewCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [showCodeInfo, setShowCodeInfo] = useState(false);
  const [companyPreview, setCompanyPreview] = useState<{
    name: string;
    logo: string | null;
    id: string;
  } | null>(null);
  const [joining, setJoining] = useState(false);
  const [headlineDone, setHeadlineDone] = useState(false);
  const [visibleFeatures, setVisibleFeatures] = useState<number>(0);

  const content = selected ? CONTENT[selected] : null;

  // Reset headline completion on selection change
  useEffect(() => {
    setHeadlineDone(false);
  }, [selected]);

  // Staggered feature reveal after headline completes
  useEffect(() => {
    if (!headlineDone || !content) {
      setVisibleFeatures(0);
      return;
    }

    let count = 0;
    const interval = setInterval(() => {
      count++;
      setVisibleFeatures(count);
      if (count >= content.features.length) clearInterval(interval);
    }, 80);

    return () => clearInterval(interval);
  }, [headlineDone, content]);

  // Reset reveals on selection change
  useEffect(() => {
    setVisibleFeatures(0);
    setCompanyPreview(null);
    setCrewCode("");
    setCodeError("");
    setShowCodeInfo(false);
  }, [selected]);

  // Close tooltip when clicking outside
  useEffect(() => {
    if (!showCodeInfo) return;
    const close = () => setShowCodeInfo(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showCodeInfo]);

  const handleSelect = useCallback((id: string) => {
    setSelected(id);
  }, []);

  const validateCode = async () => {
    const code = crewCode.trim().toUpperCase();
    if (!code) {
      setCodeError("Enter your crew code");
      return;
    }

    setCodeLoading(true);
    setCodeError("");

    try {
      const res = await fetch(
        `/api/auth/validate-code?code=${encodeURIComponent(code)}`
      );
      const data = await res.json();

      if (!res.ok || !data.valid) {
        setCodeError(data.error || "Invalid code");
        setCompanyPreview(null);
        return;
      }

      setCompanyPreview({
        name: data.companyName,
        logo: data.companyLogo,
        id: data.companyId,
      });
    } catch {
      setCodeError("Failed to validate code. Try again.");
    } finally {
      setCodeLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!selected) return;

    if (selected === "company") {
      // Company creator path → 3-phase setup
      router.push("/setup");
    } else if (selected === "join" && companyPreview) {
      // Join path → call join-company API → employee setup
      setJoining(true);
      try {
        const idToken = await getIdToken();
        if (!idToken) {
          router.push("/register");
          return;
        }

        const res = await fetch("/api/auth/join-company", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            companyCode: crewCode.trim().toUpperCase(),
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setCodeError(data.error || "Failed to join. Try again.");
          return;
        }

        // Update auth store with returned user and company
        if (data.user) setUser(data.user);
        if (data.company) setCompany(data.company);

        // Joined → employee onboarding
        router.push("/employee-setup");
      } catch {
        setCodeError("Something went wrong. Try again.");
      } finally {
        setJoining(false);
      }
    }
  };

  const canContinue =
    selected === "company" ||
    (selected === "join" && companyPreview !== null);

  const displayName =
    currentUser?.firstName || currentUser?.email?.split("@")[0] || "there";

  return (
    <div className="relative w-full h-full min-h-screen flex flex-col">
      {/* Canvas background */}
      <div className="absolute inset-0 z-0">
        <AccountTypeCanvas
          options={OPTIONS}
          selected={selected}
          onSelect={handleSelect}
        />
      </div>

      {/* Content overlay */}
      <div className="relative z-10 flex flex-col items-center justify-end flex-1 pb-12 px-6 pointer-events-none">
        {/* Welcome + Header — stacked at top with safe spacing */}
        <div className="absolute top-0 left-0 right-0 pt-6 sm:pt-8 px-6 text-center space-y-2">
          <p className="font-kosugi text-[11px] text-text-disabled tracking-wider">
            [welcome,{" "}
            <span className="text-text-secondary">{displayName}</span>]
          </p>
          <h1 className="font-mohave text-[22px] sm:text-[28px] font-semibold uppercase tracking-wide text-text-primary leading-tight">
            HOW ARE YOU USING OPS?
          </h1>
          <p className="font-kosugi text-[11px] sm:text-[12px] text-text-tertiary">
            [choose one to get started]
          </p>
        </div>

        {/* Reveal panel — bottom area */}
        <AnimatePresence mode="wait">
          {selected && content && (
            <motion.div
              key={selected}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-[400px] pointer-events-auto"
            >
              {/* Typewriter headline — full text rendered invisibly to reserve height */}
              <p className="font-mohave text-[20px] font-semibold text-text-primary uppercase tracking-wide text-center mb-4 relative">
                <span className="invisible" aria-hidden="true">
                  {content.headline}
                </span>
                <span className="absolute inset-0">
                  <TypewriterText
                    text={content.headline}
                    typingSpeed={30}
                    onComplete={() => setHeadlineDone(true)}
                  />
                </span>
              </p>

              {/* Feature bullets — opacity only, no transform shift */}
              <div className="space-y-2 mb-6">
                {content.features.map((feature, i) => (
                  <div
                    key={feature}
                    className="flex items-center gap-3"
                    style={{
                      opacity: i < visibleFeatures ? 1 : 0,
                      transition: "opacity 250ms ease",
                    }}
                  >
                    <div className="w-1 h-1 bg-text-tertiary shrink-0" />
                    <span className="font-mohave text-[14px] text-text-secondary">
                      {feature}
                    </span>
                  </div>
                ))}
              </div>

              {/* Crew code input (join path only) */}
              {selected === "join" && headlineDone && (
                <div
                  className="mb-4 animate-fade-in"
                  style={{ animationDelay: "200ms" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <label className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                      crew code
                    </label>
                    <button
                      type="button"
                      className="relative"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCodeInfo((prev) => !prev);
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-text-disabled hover:text-text-tertiary transition-colors"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4" />
                        <path d="M12 8h.01" />
                      </svg>

                      {/* Info tooltip */}
                      {showCodeInfo && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-[rgba(20,20,20,0.95)] border border-[rgba(255,255,255,0.1)] rounded text-left z-50 backdrop-blur-sm">
                          <p className="font-mohave text-[12px] text-text-secondary leading-relaxed">
                            Your crew code is in your invite email or text
                            message. Your admin can also find it in organization
                            settings.
                          </p>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[rgba(255,255,255,0.1)]" />
                        </div>
                      )}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={crewCode}
                      onChange={(e) => {
                        setCrewCode(e.target.value.toUpperCase());
                        setCodeError("");
                        setCompanyPreview(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") validateCode();
                      }}
                      placeholder="Enter code"
                      maxLength={20}
                      className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded px-4 py-3 font-mohave text-[16px] font-medium text-text-primary tracking-widest uppercase outline-none transition-colors focus:border-ops-accent placeholder:text-text-disabled placeholder:tracking-wide placeholder:normal-case"
                    />
                    <button
                      onClick={validateCode}
                      disabled={codeLoading || !crewCode.trim()}
                      className="px-5 py-3 bg-ops-accent/15 border border-ops-accent/30 rounded font-mohave text-[14px] font-semibold text-ops-accent uppercase tracking-wide transition-colors hover:bg-ops-accent/25 hover:border-ops-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {codeLoading ? "..." : "JOIN"}
                    </button>
                  </div>

                  {codeError && (
                    <p className="font-kosugi text-[11px] text-ops-error mt-2">
                      {codeError}
                    </p>
                  )}

                  {/* Company preview */}
                  {companyPreview && (
                    <div className="mt-3 p-3 bg-ops-accent/5 border border-ops-accent/15 rounded flex items-center gap-3 animate-fade-in">
                      <div className="w-9 h-9 rounded-md bg-ops-accent/20 flex items-center justify-center font-mohave font-bold text-[14px] text-ops-accent shrink-0">
                        {companyPreview.name
                          .split(" ")
                          .map((w) => w[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div>
                        <p className="font-mohave text-[14px] font-semibold text-text-primary">
                          {companyPreview.name}
                        </p>
                        <p className="font-kosugi text-[10px] text-text-tertiary">
                          [you&apos;ll join as unassigned until a role is set]
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Continue button */}
              {canContinue && (
                <button
                  onClick={handleContinue}
                  disabled={joining}
                  className="w-full py-4 bg-text-primary rounded-lg font-mohave text-[16px] font-semibold text-background uppercase tracking-wide transition-all hover:bg-white disabled:opacity-60 animate-fade-in"
                >
                  {joining ? "JOINING..." : "CONTINUE"}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
