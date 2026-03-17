"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Search, Mail, Zap, MessageCircle, CheckCircle, Minimize2 } from "lucide-react";
import type { AnalysisResult } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;

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
  existingJobId?: string; // If set, reconnect to this job instead of starting new
  onComplete: (result: AnalysisResult["result"]) => void;
  onMinimize?: () => void; // Closes the wizard — analysis continues server-side
}

export function AnalyzeStep({ connectionId, companyId, existingJobId, onComplete, onMinimize }: AnalyzeStepProps) {
  const [jobId, setJobId] = useState<string | null>(existingJobId || null);
  const [status, setStatus] = useState<string>("pending");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Starting analysis...");
  const [error, setError] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());
  const [showMinimize, setShowMinimize] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const startedRef = useRef(false);

  // Show minimize button after 10 seconds of analysis
  useEffect(() => {
    const timer = setTimeout(() => setShowMinimize(true), 10000);
    return () => clearTimeout(timer);
  }, []);

  // Start analysis (or reconnect to existing job)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // If we have an existing job ID, skip starting a new analysis — go straight to polling
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
      } catch {
        setError("Failed to start analysis");
      }
    };

    startAnalysis();
  }, [connectionId, companyId, existingJobId]);

  // Poll for status
  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/integrations/email/analyze-status?jobId=${jobId}`);
        const data = await res.json();

        setStatus(data.status);
        if (data.progress) {
          setProgress(data.progress.percent);
          setMessage(data.progress.message);

          // Track completed stages
          const stageIndex = STAGES.findIndex((s) => s.key === data.progress.stage);
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
          // Brief celebration pause before advancing
          setTimeout(() => onComplete(data.result), 1200);
          return;
        }

        if (data.status === "error") {
          setError(data.error || "Analysis failed");
          return;
        }

        pollRef.current = setTimeout(poll, 2000);
      } catch {
        pollRef.current = setTimeout(poll, 3000);
      }
    };

    poll();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [jobId, onComplete]);

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
        <div className="space-y-6">
          {/* Progress bar */}
          <div>
            <div className="h-[2px] w-full bg-white/5 overflow-hidden" style={{ borderRadius: 1 }}>
              <motion.div
                className="h-full bg-[#597794]"
                initial={{ width: "0%" }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.8, ease: EASE }}
              />
            </div>
            <p className="font-mohave text-[12px] text-[#666] mt-2">
              {progress}% complete
            </p>
          </div>

          {/* Stage indicators */}
          <div className="space-y-2">
            {STAGES.map((stage, i) => {
              const isCompleted = completedStages.has(stage.key);
              const isCurrent = stage.key === status;
              const Icon = stage.icon;

              return (
                <motion.div
                  key={stage.key}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{
                    opacity: isCompleted || isCurrent || i === 0 ? 1 : 0.3,
                    x: 0,
                  }}
                  transition={{ delay: i * 0.1, duration: 0.4, ease: EASE }}
                  className="flex items-center gap-3 py-2"
                >
                  <div
                    className="w-7 h-7 flex items-center justify-center border transition-all duration-300"
                    style={{
                      borderRadius: 2,
                      borderColor: isCompleted
                        ? "rgba(157,181,130,0.5)"
                        : isCurrent
                          ? "rgba(89,119,148,0.5)"
                          : "rgba(255,255,255,0.08)",
                      background: isCompleted
                        ? "rgba(157,181,130,0.1)"
                        : isCurrent
                          ? "rgba(89,119,148,0.1)"
                          : "transparent",
                    }}
                  >
                    {isCompleted ? (
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
                      color: isCompleted ? "#9DB582" : isCurrent ? "#fff" : "#666",
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

          {/* Minimize button — appears after 10s so user can close wizard while analysis continues */}
          {showMinimize && onMinimize && status !== 'complete' && status !== 'error' && (
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
