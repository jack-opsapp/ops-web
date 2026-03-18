"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Mail, Zap, MessageCircle, CheckCircle, Minimize2 } from "lucide-react";
import type { AnalysisResult } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;

// building_leads is a transient Phase A status — map it to analyzing_threads for display
const normalizeStatus = (s: string) => s === 'building_leads' ? 'analyzing_threads' : s;

const STAGES = [
  { key: "analyzing_sent", icon: Mail, label: "Analyzing sent emails", range: [5, 35] },
  { key: "detecting_platforms", icon: Search, label: "Detecting form platforms", range: [35, 50] },
  { key: "classifying_ai", icon: Zap, label: "Classifying with AI", range: [50, 70] },
  { key: "analyzing_threads", icon: MessageCircle, label: "Analyzing threads", range: [70, 95] },
  { key: "complete", icon: CheckCircle, label: "Analysis complete", range: [100, 100] },
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
  const [jobId, setJobId] = useState<string | null>(existingJobId || null);
  const [status, setStatus] = useState<string>(existingJobId ? "analyzing_sent" : "pending");
  const [serverProgress, setServerProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [message, setMessage] = useState(existingJobId ? "Reconnecting to analysis..." : "Starting analysis...");
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
        setError("Failed to start analysis");
      }
    };

    startAnalysis();
  }, [connectionId, companyId, existingJobId]);

  // Poll for status
  const pollCallback = useCallback(async (currentJobId: string) => {
    try {
      const res = await fetch(`/api/integrations/email/analyze-status?jobId=${currentJobId}`);
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
        setError(data.error || "Analysis failed");
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
  }, []);

  useEffect(() => {
    if (!jobId) return;
    pollCallback(jobId);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [jobId, pollCallback]);

  // Progress bar color — green when complete, accent during analysis
  const barColor = isComplete ? "#9DB582" : "#597794";
  const percentText = isComplete
    ? `${leadCount} lead${leadCount !== 1 ? "s" : ""} found`
    : `${Math.round(displayProgress)}% complete`;

  return (
    <div>
      <p className="font-mohave text-[15px] text-[#999] mb-8">
        {existingJobId
          ? "Reconnecting to your running analysis..."
          : "Scanning your inbox for business patterns and potential leads."}
      </p>

      {error ? (
        <div className="p-4 border border-[#93321A]/30 bg-[#93321A]/10" style={{ borderRadius: 3 }}>
          <p className="font-mohave text-[14px] text-[#FF6B4A]">{error}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Progress bar */}
          <div>
            <div className="h-[2px] w-full bg-white/5 overflow-hidden" style={{ borderRadius: 1 }}>
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
              <p className="font-mohave text-[12px] transition-colors duration-500" style={{ color: isComplete ? "#9DB582" : "#666" }}>
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
                      className="font-mohave text-[11px] text-[#597794]"
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
                      className="font-mohave text-[11px] text-[#9DB582]"
                    >
                      Preparing results...
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
                    className="w-7 h-7 flex items-center justify-center border transition-all duration-300"
                    style={{
                      borderRadius: 2,
                      borderColor: isStageCompleted
                        ? "rgba(157,181,130,0.5)"
                        : isCurrent
                          ? "rgba(89,119,148,0.5)"
                          : "rgba(255,255,255,0.08)",
                      background: isStageCompleted
                        ? "rgba(157,181,130,0.1)"
                        : isCurrent
                          ? "rgba(89,119,148,0.1)"
                          : "transparent",
                    }}
                  >
                    {isStageCompleted ? (
                      <CheckCircle size={14} className="text-[#9DB582]" />
                    ) : isCurrent ? (
                      <div className="w-3 h-3 border-2 border-[#597794]/40 border-t-[#597794] rounded-full animate-spin" />
                    ) : (
                      <Icon size={14} className="text-[#666]" />
                    )}
                  </div>
                  <span
                    className="font-mohave text-[13px] transition-colors duration-300"
                    style={{
                      color: isStageCompleted ? "#9DB582" : isCurrent ? "#fff" : "#666",
                    }}
                  >
                    {stage.label}
                  </span>
                  {isCurrent && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="font-mohave text-[11px] text-[#597794] ml-auto"
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
              className="mt-6 pt-4 border-t border-white/8"
            >
              <button
                onClick={onMinimize}
                className="flex items-center gap-2 px-4 py-2 border border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/15 transition-all font-mohave text-[13px] text-[#999] hover:text-white"
                style={{ borderRadius: 3 }}
              >
                <Minimize2 size={14} />
                Minimize — we&apos;ll notify you when it&apos;s ready
              </button>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
