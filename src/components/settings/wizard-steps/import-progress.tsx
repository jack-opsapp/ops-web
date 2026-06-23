"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Users, FileText, Tag, CheckCircle, Loader2, Minimize2 } from "lucide-react";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { useDictionary } from "@/i18n/client";
import type { ImportResult } from "@/lib/types/email-import";

const EASE = [0.22, 1, 0.36, 1] as const;

interface ImportProgressProps {
  jobId: string;
  totalLeads: number;
  onComplete: (result: ImportResult) => void;
  onMinimize?: () => void;
  onProgressUpdate?: (percent: number, message: string) => void;
}

interface ImportProgressData {
  clientsCreated: number;
  leadsCreated: number;
  labelsApplied: number;
}

export function ImportProgress({
  jobId,
  totalLeads,
  onComplete,
  onMinimize,
  onProgressUpdate,
}: ImportProgressProps) {
  const { t } = useDictionary("import-wizard");
  const [status, setStatus] = useState<string>("importing");
  const [serverProgress, setServerProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [message, setMessage] = useState(t("importProgress.importingLead", { current: 0, total: totalLeads }));
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ImportProgressData>({
    clientsCreated: 0,
    leadsCreated: 0,
    labelsApplied: 0,
  });

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const interpolateRef = useRef<NodeJS.Timeout | null>(null);
  const lastProgressChangeRef = useRef<number>(Date.now());
  const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes with no progress change = stale

  // Stable refs for callbacks to avoid re-triggering poll effect
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onProgressUpdateRef = useRef(onProgressUpdate);
  onProgressUpdateRef.current = onProgressUpdate;

  // ─── Smooth progress interpolation ───────────────────────────────────────
  // Between server polls, slowly animate progress toward 95% max.
  // When a new server value arrives, snap to it if higher (handled below).
  useEffect(() => {
    if (status === "import_complete" || status === "import_error") return;

    interpolateRef.current = setInterval(() => {
      setDisplayProgress((prev) => {
        if (prev >= 95) return prev;
        // Creep ~1.5% per second (every 100ms = 0.15%)
        return Math.min(prev + 0.15, 95);
      });
    }, 100);

    return () => {
      if (interpolateRef.current) clearInterval(interpolateRef.current);
    };
  }, [status]);

  // Snap displayProgress when serverProgress jumps ahead
  useEffect(() => {
    if (serverProgress > displayProgress) {
      setDisplayProgress(serverProgress);
    }
  }, [serverProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Poll for status ─────────────────────────────────────────────────────
  const pollCallback = useCallback(async (currentJobId: string) => {
    try {
      // authedFetch attaches the Firebase ID token and auto-retries on 401
      // with a force-refreshed token. Long imports can outlive the initial
      // token's lifetime, so the retry prevents the UI from going silent
      // when the token expires mid-poll.
      const res = await authedFetch(
        `/api/integrations/email/analyze-status?jobId=${currentJobId}`
      );
      const data = await res.json();

      setStatus(data.status);

      if (data.progress) {
        // Track progress changes for stale detection
        if (data.progress.percent !== serverProgress) {
          lastProgressChangeRef.current = Date.now();
        }

        setServerProgress(data.progress.percent);
        setMessage(data.progress.message);
        onProgressUpdateRef.current?.(
          data.progress.percent,
          data.progress.message
        );

        // Update live stats from progress payload
        if (
          data.progress.clientsCreated !== undefined ||
          data.progress.leadsCreated !== undefined ||
          data.progress.labelsApplied !== undefined
        ) {
          setStats({
            clientsCreated: data.progress.clientsCreated ?? 0,
            leadsCreated: data.progress.leadsCreated ?? 0,
            labelsApplied: data.progress.labelsApplied ?? 0,
          });
        }
      }

      // Stale job detection — if no progress change for 5 minutes, treat as failed
      if (
        data.status === "importing" &&
        Date.now() - lastProgressChangeRef.current > STALE_TIMEOUT_MS
      ) {
        setError(t("importProgress.stalled"));
        return;
      }

      if (data.status === "import_complete" && data.result) {
        setServerProgress(100);
        setDisplayProgress(100);
        // Final stats from result
        setStats({
          clientsCreated: data.result.clientsCreated,
          leadsCreated: data.result.leadsCreated,
          labelsApplied: data.result.labelsApplied,
        });
        // Brief celebration pause before advancing
        setTimeout(() => onCompleteRef.current(data.result), 1200);
        return;
      }

      if (data.status === "import_error") {
        setError(data.error || t("importProgress.failed"));
        return;
      }

      pollRef.current = setTimeout(() => pollCallback(currentJobId), 2000);
    } catch {
      pollRef.current = setTimeout(() => pollCallback(currentJobId), 3000);
    }
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start polling when mounted
  useEffect(() => {
    if (!jobId) return;

    pollCallback(jobId);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [jobId, pollCallback]);

  const isComplete = status === "import_complete";

  const statBoxes = [
    {
      icon: Users,
      label: t("importProgress.clientsCreated"),
      value: stats.clientsCreated,
    },
    {
      icon: FileText,
      label: t("importProgress.leadsCreated"),
      value: stats.leadsCreated,
    },
    {
      icon: Tag,
      label: t("importProgress.labelsApplied"),
      value: stats.labelsApplied,
    },
  ];

  return (
    <div>
      <p className="font-mohave text-[15px] text-text-2 mb-8">
        {t("importProgress.intro")}
      </p>

      {error ? (
        <div
          className="p-4 border border-rose-line bg-rose-soft"
          style={{ borderRadius: 5 }}
        >
          <p className="font-mohave text-[14px] text-rose">{error}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Progress bar */}
          <div>
            <div
              className="h-[2px] w-full bg-border-subtle overflow-hidden"
              style={{ borderRadius: 2 }}
            >
              <motion.div
                className="h-full bg-text-2"
                initial={{ width: "0%" }}
                animate={{ width: `${Math.round(displayProgress)}%` }}
                transition={{ duration: 0.6, ease: EASE }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="font-mohave text-[13px] text-text-2">
                {isComplete ? (
                  <span className="flex items-center gap-1.5 text-olive">
                    <CheckCircle size={14} />
                    {t("importProgress.complete")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin text-text-3" />
                    {message}
                  </span>
                )}
              </p>
              <p className="font-mono text-[12px] text-text-mute tabular-nums">
                {Math.round(displayProgress)}%
              </p>
            </div>
          </div>

          {/* Stat boxes */}
          <motion.div
            className="grid grid-cols-3 gap-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5, ease: EASE }}
          >
            {statBoxes.map((stat) => {
              const Icon = stat.icon;
              return (
                <div
                  key={stat.label}
                  className="p-3 border border-border bg-surface-input"
                  style={{ borderRadius: 5 }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={16} className="text-text-3" />
                    <span className="font-mono text-micro uppercase tracking-wider text-text-3">
                      {stat.label}
                    </span>
                  </div>
                  <motion.p
                    className="font-mono text-[22px] text-text tabular-nums"
                    key={stat.value}
                    initial={{ opacity: 0.5, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    {stat.value}
                  </motion.p>
                </div>
              );
            })}
          </motion.div>

          {/* Minimize button — always available since import is non-interactive */}
          {onMinimize && !isComplete && status !== "import_error" && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5, ease: EASE }}
              className="mt-6 pt-4 border-t border-border"
            >
              {/* Not the kit Button: its forced Cake-Mono UPPERCASE would shout
                  this full sentence. Hand-styled secondary on tokens instead —
                  borders-only depth, text-ladder colors, sentence-case content. */}
              <button
                onClick={onMinimize}
                className="flex items-center gap-2 px-4 py-2 border border-border bg-surface-hover hover:bg-surface-active hover:border-border-medium transition-all font-mohave text-[13px] text-text-2 hover:text-text"
                style={{ borderRadius: 5 }}
              >
                <Minimize2 size={16} />
                {t("importProgress.minimize")}
              </button>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
