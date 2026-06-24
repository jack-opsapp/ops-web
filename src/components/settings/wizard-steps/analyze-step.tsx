"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Mail, Zap, MessageCircle, CheckCircle, Minimize2 } from "lucide-react";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { useDictionary } from "@/i18n/client";
import type { AnalysisResult } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;

// building_leads is a transient Phase A status — map it to analyzing_threads for display
const normalizeStatus = (s: string) => s === 'building_leads' ? 'analyzing_threads' : s;

const STAGES = [
  { key: "analyzing_sent", icon: Mail, labelKey: "analyze.stage.analyzing_sent", range: [5, 35] },
  { key: "detecting_platforms", icon: Search, labelKey: "analyze.stage.detecting_platforms", range: [35, 50] },
  { key: "classifying_ai", icon: Zap, labelKey: "analyze.stage.classifying_ai", range: [50, 70] },
  { key: "analyzing_threads", icon: MessageCircle, labelKey: "analyze.stage.analyzing_threads", range: [70, 95] },
  { key: "complete", icon: CheckCircle, labelKey: "analyze.stage.complete", range: [100, 100] },
];

interface AnalyzeStepProps {
  connectionId: string;
  companyId: string;
  existingJobId?: string;
  onComplete: (result: AnalysisResult["result"]) => void;
  onMinimize?: () => void;
  onJobStarted?: (jobId: string) => void;
  onProgressUpdate?: (percent: number, message: string, status: string) => void;
}

export function AnalyzeStep({ connectionId, companyId, existingJobId, onComplete, onMinimize, onJobStarted, onProgressUpdate }: AnalyzeStepProps) {
  const { t } = useDictionary("import-wizard");
  const [jobId, setJobId] = useState<string | null>(existingJobId || null);
  const [status, setStatus] = useState<string>(existingJobId ? "analyzing_sent" : "pending");
  const [serverProgress, setServerProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [message, setMessage] = useState(existingJobId ? t("analyze.reconnecting") : t("analyze.starting"));
  const [error, setError] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());
  const [showMinimize, setShowMinimize] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [leadCount, setLeadCount] = useState(0);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const startedRef = useRef(false);
  const interpolateRef = useRef<NodeJS.Timeout | null>(null);
  const completeResultRef = useRef<AnalysisResult["result"] | null>(null);

  // ─── Fading discovered names ──────────────────────────────────────────────
  const [discoveredNames, setDiscoveredNames] = useState<string[]>([]);
  const [visibleName, setVisibleName] = useState<string | null>(null);
  const nameIndexRef = useRef(0);

  // Stable refs for callbacks
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onJobStartedRef = useRef(onJobStarted);
  onJobStartedRef.current = onJobStarted;
  const onProgressUpdateRef = useRef(onProgressUpdate);
  onProgressUpdateRef.current = onProgressUpdate;

  // Show minimize button after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowMinimize(true), 10000);
    return () => clearTimeout(timer);
  }, []);

  // ─── Cycle through discovered names with fade ─────────────────────────────
  useEffect(() => {
    if (discoveredNames.length === 0 || isComplete) return;

    const cycle = () => {
      const idx = nameIndexRef.current % discoveredNames.length;
      setVisibleName(discoveredNames[idx]);
      nameIndexRef.current++;
    };

    cycle(); // Show first immediately
    const interval = setInterval(cycle, 2500);
    return () => clearInterval(interval);
  }, [discoveredNames, isComplete]);

  // ─── Smooth progress interpolation ───────────────────────────────────────
  useEffect(() => {
    if (isComplete || status === "error" || status === "pending") return;

    const currentStage = STAGES.find((s) => s.key === status);
    const maxForStage = currentStage ? currentStage.range[1] - 1 : displayProgress;

    interpolateRef.current = setInterval(() => {
      setDisplayProgress((prev) => {
        if (prev >= maxForStage) return prev;
        return Math.min(prev + 0.15, maxForStage);
      });
    }, 100);

    return () => {
      if (interpolateRef.current) clearInterval(interpolateRef.current);
    };
  }, [status, isComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snap displayProgress when serverProgress jumps ahead
  useEffect(() => {
    if (serverProgress > displayProgress) {
      setDisplayProgress(serverProgress);
    }
  }, [serverProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start analysis (or reconnect to existing job)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (existingJobId) {
      setJobId(existingJobId);
      return;
    }

    const startAnalysis = async () => {
      try {
        const res = await fetch("/api/integrations/email/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId, companyId }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
          return;
        }
        setJobId(data.jobId);
        onJobStartedRef.current?.(data.jobId);
      } catch {
        setError(t("analyze.failedToStart"));
      }
    };

    startAnalysis();
  }, [connectionId, companyId, existingJobId, t]);

  // Poll for status
  const pollCallback = useCallback(async (currentJobId: string) => {
    try {
      // authedFetch attaches the Firebase ID token and retries once on 401
      // with a force-refreshed token. Without this, long analyses lose the
      // progress feed the moment the token ages out.
      const res = await authedFetch(`/api/integrations/email/analyze-status?jobId=${currentJobId}`);
      const data = await res.json();

      setStatus(normalizeStatus(data.status));
      if (data.progress) {
        setServerProgress(data.progress.percent);
        setMessage(data.progress.message);
        onProgressUpdateRef.current?.(data.progress.percent, data.progress.message, data.status);

        const stageIndex = STAGES.findIndex((s) => s.key === normalizeStatus(data.progress.stage));
        if (stageIndex >= 0) {
          setCompletedStages((prev) => {
            const next = new Set(prev);
            for (let i = 0; i < stageIndex; i++) {
              next.add(STAGES[i].key);
            }
            return next;
          });
        }
      }

      if (data.status === "complete" && data.result) {
        // ─── Completion celebration ─────────────────────────────────────
        // 1. Snap progress to 100% and turn bar green
        setServerProgress(100);
        setDisplayProgress(100);
        setIsComplete(true);
        setLeadCount(data.result.leads?.length ?? 0);
        completeResultRef.current = data.result;

        // Mark all stages as completed
        setCompletedStages(new Set(STAGES.map((s) => s.key)));

        // Collect discovered names for final display
        if (data.result.leads?.length) {
          const names = data.result.leads
            .slice(0, 8)
            .map((l: { client?: { name?: string } }) => l.client?.name)
            .filter(Boolean) as string[];
          setDiscoveredNames(names);
        }

        // 2. Hold for 2.5s so the user sees the green success state
        setTimeout(() => onCompleteRef.current(data.result), 2500);
        return;
      }

      if (data.status === "error") {
        setError(data.error || t("analyze.analysisFailed"));
        return;
      }

      // Extract discovered lead names from result preview (if server provides them)
      if (data.progress?.discoveredLeadNames?.length) {
        setDiscoveredNames(data.progress.discoveredLeadNames);
      }

      pollRef.current = setTimeout(() => pollCallback(currentJobId), 2000);
    } catch {
      pollRef.current = setTimeout(() => pollCallback(currentJobId), 3000);
    }
  }, [t]);

  useEffect(() => {
    if (!jobId) return;
    pollCallback(jobId);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [jobId, pollCallback]);

  // Progress bar color — olive (semantic success) when complete; neutral fill
  // during analysis. Accent is reserved for the primary CTA + focus rings only,
  // so an indeterminate progress bar must read on the neutral fill ladder.
  // Concrete literals (not token vars) on purpose: this value is a framer-motion
  // `animate` interpolation target and CSS `var()` cannot be tweened across the
  // rgba→olive transition. olive literal === --olive token value (#9DB582).
  const barColor = isComplete ? "#9DB582" : "rgba(255,255,255,0.45)";
  const percentText = isComplete
    ? t("analyze.leadsFound", { count: leadCount })
    : t("analyze.percentComplete", { percent: Math.round(displayProgress) });

  return (
    <div>
      <p className="font-mohave text-[15px] text-text-2 mb-8">
        {existingJobId
          ? t("analyze.reconnectingIntro")
          : t("analyze.intro")}
      </p>

      {error ? (
        <div className="p-4 border border-brick-line bg-rose-soft rounded">
          <p className="font-mohave text-[14px] text-rose">{error}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Progress bar */}
          <div>
            <div className="h-[2px] w-full bg-white/5 overflow-hidden rounded-bar">
              <motion.div
                className="h-full"
                initial={{ width: "0%" }}
                animate={{
                  width: `${Math.round(displayProgress)}%`,
                  backgroundColor: barColor,
                }}
                transition={{ duration: 0.6, ease: EASE }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="font-mono text-[12px] tabular-nums transition-colors duration-500" style={{ color: isComplete ? "var(--olive)" : "var(--text-3)" }}>
                {isComplete && <CheckCircle size={11} className="inline mr-1 -mt-0.5" />}
                {percentText}
              </p>
              {/* Fading discovered name — inline next to progress */}
              <div className="h-4 overflow-hidden">
                <AnimatePresence mode="wait">
                  {visibleName && !isComplete && (
                    <motion.span
                      key={visibleName}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.5 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.4, ease: EASE }}
                      className="font-mohave text-[11px] text-text-2"
                    >
                      {visibleName}
                    </motion.span>
                  )}
                  {isComplete && (
                    <motion.span
                      key="complete"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.5, ease: EASE }}
                      className="font-mohave text-[11px] text-olive"
                    >
                      {t("analyze.preparing")}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Stage indicators */}
          <div className="space-y-2">
            {STAGES.map((stage, i) => {
              const isStageCompleted = completedStages.has(stage.key);
              const isCurrent = stage.key === status && !isComplete;
              const Icon = stage.icon;

              return (
                <motion.div
                  key={stage.key}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{
                    opacity: isStageCompleted || isCurrent || i === 0 ? 1 : 0.3,
                    x: 0,
                  }}
                  transition={{ delay: i * 0.1, duration: 0.4, ease: EASE }}
                  className="flex items-center gap-3 py-2"
                >
                  <div
                    className={`w-7 h-7 flex items-center justify-center border rounded-chip transition-all duration-300 ${
                      isStageCompleted
                        ? "border-olive-line bg-olive-soft"
                        : isCurrent
                          ? "border-border-medium bg-surface-active"
                          : "border-border bg-transparent"
                    }`}
                  >
                    {isStageCompleted ? (
                      <CheckCircle size={14} className="text-olive" />
                    ) : isCurrent ? (
                      <div className="w-3 h-3 border-2 border-text-3/40 border-t-text rounded-full animate-spin" />
                    ) : (
                      <Icon size={14} className="text-text-3" />
                    )}
                  </div>
                  <span
                    className="font-mohave text-[13px] transition-colors duration-300"
                    style={{
                      color: isStageCompleted ? "var(--olive)" : isCurrent ? "var(--text)" : "var(--text-3)",
                    }}
                  >
                    {t(stage.labelKey)}
                  </span>
                  {isCurrent && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="font-mohave text-[11px] text-text-3 ml-auto"
                    >
                      {message}
                    </motion.span>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Minimize button */}
          {showMinimize && onMinimize && !isComplete && status !== 'error' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="mt-6 pt-4 border-t border-border"
            >
              <button
                onClick={onMinimize}
                className="flex items-center gap-2 px-4 py-2 border border-border bg-white/5 hover:bg-surface-hover hover:border-border-medium transition-all font-mohave text-[13px] text-text-2 hover:text-text rounded"
              >
                <Minimize2 size={14} />
                {t("analyze.minimize")}
              </button>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
