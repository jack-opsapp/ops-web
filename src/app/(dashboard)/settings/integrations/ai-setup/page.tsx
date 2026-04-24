"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  ChevronLeft,
  Loader2,
  Mail,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import { usePageTitle } from "@/lib/hooks";
import { useRouter } from "next/navigation";
import { AiIntakeInterview } from "@/components/settings/ai-intake-interview";
import { AiDatabaseMining } from "@/components/settings/ai-database-mining";
import { AiSetupDashboard } from "@/components/settings/ai-setup-dashboard";
import { useInterviewStore } from "@/stores/ai-interview-store";
import { getIdToken } from "@/lib/firebase/auth";

// ─── Animation ──────────────────────────────────────────────────────────────────

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

const sectionVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};

const sectionVariantsReduced = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.01 } },
};

// ─── Setup phases ───────────────────────────────────────────────────────────────

type SetupPhase =
  | "interview"
  | "email_scan"
  | "mining"
  | "dashboard";

// ─── Email Scan Section ─────────────────────────────────────────────────────────

function EmailScanSection({ onComplete, onSkip }: { onComplete: () => void; onSkip: () => void }) {
  const { t } = useDictionary("ai-setup");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{
    total: number;
    processed: number;
    factsExtracted: number;
    status: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const startScan = useCallback(async () => {
    setScanning(true);
    setError(null);

    try {
      const idToken = await getIdToken();
      const res = await fetch("/api/integrations/ai-setup/email-scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ companyId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to start scan" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const { jobId } = await res.json();

      // Poll for progress
      const poll = async () => {
        try {
          const pollRes = await fetch(
            `/api/integrations/ai-setup/email-scan?jobId=${jobId}`
          );
          if (!pollRes.ok) {
            pollRef.current = setTimeout(poll, 3000);
            return;
          }

          const data = await pollRes.json();

          if (data.progress) {
            setProgress({
              total: data.progress.total ?? 0,
              processed: data.progress.processed ?? 0,
              factsExtracted: data.progress.factsExtracted ?? 0,
              status: data.status,
            });
          }

          if (data.status === "complete") {
            setScanning(false);
            onComplete();
            return;
          }

          if (data.status === "error") {
            setScanning(false);
            setError(data.progress?.error ?? "Scan failed");
            return;
          }

          pollRef.current = setTimeout(poll, 3000);
        } catch {
          pollRef.current = setTimeout(poll, 5000);
        }
      };

      pollRef.current = setTimeout(poll, 2000);
    } catch (err) {
      setScanning(false);
      setError(err instanceof Error ? err.message : "Failed to start scan");
    }
  }, [companyId, onComplete]);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Mail className="w-[16px] h-[16px] text-text-3" />
        <span className="font-cakemono text-body font-light uppercase tracking-wide text-text">
          {t("emailScan.title")}
        </span>
      </div>
      <p className="font-mohave text-body-sm text-text-2">
        {t("emailScan.description")}
      </p>

      {error && (
        <div className="px-2 py-1.5 rounded border border-[rgba(147,50,26,0.3)] bg-[rgba(147,50,26,0.08)]">
          <span className="font-mohave text-body-sm text-[#FF6B4A]">{error}</span>
        </div>
      )}

      {scanning && progress ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[rgba(111, 148, 176,0.2)] bg-[rgba(111, 148, 176,0.06)]">
            <Loader2 className="w-[12px] h-[12px] text-[#6F94B0] animate-spin shrink-0" />
            <span className="font-mohave text-body-sm text-[#6F94B0]">
              {t("emailScan.progress")
                .replace("{processed}", String(progress.processed))
                .replace("{total}", String(progress.total))}
            </span>
          </div>
          {progress.total > 0 && (
            <div className="h-[3px] rounded-full overflow-hidden bg-[rgba(255,255,255,0.06)]">
              <motion.div
                className="h-full bg-text-2 rounded-full"
                animate={{
                  width: `${progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}%`,
                }}
                transition={{
                  duration: 0.4,
                  ease: prefersReducedMotion ? "linear" : EASE_SMOOTH,
                }}
              />
            </div>
          )}
        </div>
      ) : scanning ? (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[rgba(111, 148, 176,0.2)] bg-[rgba(111, 148, 176,0.06)]">
          <Loader2 className="w-[12px] h-[12px] text-[#6F94B0] animate-spin shrink-0" />
          <span className="font-mohave text-body-sm text-[#6F94B0]">
            {t("emailScan.scanning")}
          </span>
        </div>
      ) : null}

      {!scanning && (
        <div className="flex gap-2">
          <button
            onClick={startScan}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.1)] text-text font-mohave text-body-sm transition-colors"
          >
            <Mail className="w-[14px] h-[14px] text-[#6F94B0]" />
            {t("emailScan.start")}
          </button>
          <button
            onClick={onSkip}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-[rgba(255,255,255,0.06)] bg-transparent hover:bg-[rgba(255,255,255,0.04)] text-text-mute font-mohave text-body-sm transition-colors"
          >
            {t("emailScan.skip")}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Coming Soon State ──────────────────────────────────────────────────────────

function ComingSoonState() {
  const { t } = useDictionary("ai-setup");

  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <div className="flex items-center gap-2">
        <Lock className="w-[20px] h-[20px] text-text-mute" />
        <h2 className="font-cakemono text-title font-light uppercase tracking-wide text-text">
          {t("page.comingSoon")}
        </h2>
      </div>
      <p className="font-mohave text-body-sm text-text-2 max-w-[480px]">
        {t("page.comingSoonDesc")}
      </p>
      <button
        className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-text-2 font-mohave text-body-sm transition-colors cursor-not-allowed opacity-60"
        disabled
      >
        {t("page.requestAccess")}
      </button>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function AiSetupPage() {
  const { t } = useDictionary("ai-setup");
  const router = useRouter();
  usePageTitle("AI Setup");

  const canAccessFeature = useFeatureFlagsStore((s) => s.canAccessFeature);
  const phaseCEnabled = canAccessFeature("phase_c");

  const interviewPhase = useInterviewStore((s) => s.phase);
  const resetInterview = useInterviewStore((s) => s.resetInterview);

  // Determine the current setup phase based on interview state
  const [activePhase, setActivePhase] = useState<SetupPhase>(() => {
    if (interviewPhase === "completed") return "email_scan";
    return "interview";
  });

  // Track what's been completed in this session
  const [emailScanDone, setEmailScanDone] = useState(false);
  const [miningDone, setMiningDone] = useState(false);

  // Track which phases the user has visited — separate from *Done flags so
  // "Skip" paths still unlock nav back to the skipped phase. Bug fcac6fcf.
  const [visitedPhases, setVisitedPhases] = useState<Set<SetupPhase>>(
    () => new Set<SetupPhase>(["interview"])
  );

  // Keep visitedPhases in sync whenever activePhase changes.
  useEffect(() => {
    setVisitedPhases((prev) => {
      if (prev.has(activePhase)) return prev;
      const next = new Set(prev);
      next.add(activePhase);
      return next;
    });
  }, [activePhase]);

  // Auto-advance to dashboard if everything is done
  useEffect(() => {
    if (interviewPhase === "completed" && emailScanDone && miningDone) {
      setActivePhase("dashboard");
    }
  }, [interviewPhase, emailScanDone, miningDone]);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const variants = prefersReducedMotion ? sectionVariantsReduced : sectionVariants;

  const handleInterviewComplete = useCallback(() => {
    setActivePhase("email_scan");
  }, []);

  const handleEmailScanComplete = useCallback(() => {
    setEmailScanDone(true);
    setActivePhase("mining");
  }, []);

  const handleEmailScanSkip = useCallback(() => {
    setActivePhase("mining");
  }, []);

  const handleMiningComplete = useCallback(() => {
    setMiningDone(true);
    setActivePhase("dashboard");
  }, []);

  const handleRescanEmails = useCallback(() => {
    setActivePhase("email_scan");
    setEmailScanDone(false);
  }, []);

  const handleRemine = useCallback(() => {
    setActivePhase("mining");
    setMiningDone(false);
  }, []);

  const handleReinterview = useCallback(() => {
    resetInterview();
    setActivePhase("interview");
  }, [resetInterview]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push("/settings?tab=integrations")}
          className="flex items-center justify-center w-[32px] h-[32px] rounded-md hover:bg-[rgba(255,255,255,0.06)] text-text-mute hover:text-text-2 transition-colors"
        >
          <ChevronLeft className="w-[18px] h-[18px]" />
        </button>
        <div className="flex items-center gap-1.5">
          <Brain className="w-[18px] h-[18px] text-[#6F94B0]" />
          <h1 className="font-cakemono text-title font-light uppercase tracking-wide text-text">
            {t("page.title")}
          </h1>
        </div>
      </div>
      <p className="font-mohave text-body-sm text-text-2 pl-[42px]">
        {t("page.subtitle")}
      </p>

      {/* Feature gate */}
      {!phaseCEnabled ? (
        <div className="pl-[42px]">
          <ComingSoonState />
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 pl-[42px]">
          {/* Step indicators */}
          <div className="flex items-center gap-[6px] mb-4">
            {(
              [
                { key: "interview" as const, label: "1" },
                { key: "email_scan" as const, label: "2" },
                { key: "mining" as const, label: "3" },
                { key: "dashboard" as const, label: "4" },
              ] as const
            ).map((step, i) => {
              const isActive = step.key === activePhase;
              // A phase is navigable if either (a) the user has visited it
              // before (including via skip), or (b) it's been completed. The
              // visited check keeps skip paths from trapping the user on a
              // downstream tab. Bug fcac6fcf.
              const isCompleted =
                (step.key === "interview" && interviewPhase === "completed") ||
                (step.key === "email_scan" && emailScanDone) ||
                (step.key === "mining" && miningDone);
              const isPast = isCompleted || visitedPhases.has(step.key);

              return (
                <div key={step.key} className="flex items-center gap-[6px]">
                  <button
                    onClick={() => {
                      if (isPast || isActive) setActivePhase(step.key);
                    }}
                    disabled={!isPast && !isActive}
                    className={cn(
                      "w-[24px] h-[24px] rounded-full flex items-center justify-center font-mohave text-[12px] font-semibold transition-colors",
                      isActive
                        ? "bg-text-2 text-background"
                        : isCompleted
                          ? "bg-[rgba(157,181,130,0.2)] text-[#9DB582] cursor-pointer"
                          : isPast
                            ? "bg-[rgba(255,255,255,0.08)] text-text-2 cursor-pointer"
                            : "bg-[rgba(255,255,255,0.06)] text-text-mute cursor-not-allowed"
                    )}
                  >
                    {step.label}
                  </button>
                  {i < 3 && (
                    <div
                      className={cn(
                        "w-[20px] h-[1px]",
                        isCompleted
                          ? "bg-[rgba(157,181,130,0.3)]"
                          : "bg-[rgba(255,255,255,0.06)]"
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Active content */}
          <div className="glass-surface rounded-panel p-4 flex-1 min-h-0 overflow-y-auto">
            <AnimatePresence mode="wait">
              {activePhase === "interview" && (
                <motion.div key="interview" variants={variants} initial="initial" animate="animate" exit="exit" className="h-full">
                  <AiIntakeInterview onComplete={handleInterviewComplete} />
                </motion.div>
              )}

              {activePhase === "email_scan" && (
                <motion.div key="email_scan" variants={variants} initial="initial" animate="animate" exit="exit">
                  <EmailScanSection
                    onComplete={handleEmailScanComplete}
                    onSkip={handleEmailScanSkip}
                  />
                </motion.div>
              )}

              {activePhase === "mining" && (
                <motion.div key="mining" variants={variants} initial="initial" animate="animate" exit="exit">
                  <AiDatabaseMining onComplete={handleMiningComplete} />
                </motion.div>
              )}

              {activePhase === "dashboard" && (
                <motion.div key="dashboard" variants={variants} initial="initial" animate="animate" exit="exit">
                  <AiSetupDashboard
                    onRescanEmails={handleRescanEmails}
                    onRemine={handleRemine}
                    onReinterview={handleReinterview}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
