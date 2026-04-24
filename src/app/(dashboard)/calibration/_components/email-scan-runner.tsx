"use client";

/**
 * EmailScanRunner — extracted from the stopgap ai-setup page.
 *
 * Starts a gmail scan job via /api/integrations/ai-setup/email-scan and polls
 * its status every 3s. Resolves via onComplete once the job hits "complete"
 * status. Preserves the existing 3s polling cadence — Supabase realtime
 * migration is deferred (plan note in E4).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Mail } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { getIdToken } from "@/lib/firebase/auth";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export function EmailScanRunner({ onComplete, onSkip }: Props) {
  const { t } = useDictionary("ai-setup");
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? "";

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{
    total: number;
    processed: number;
    factsExtracted: number;
    status: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const data = await res.json().catch(() => ({
          error: "Failed to start scan",
        }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const { jobId } = await res.json();

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
      <p className="font-mohave text-body-sm text-text-2">
        {t("emailScan.description")}
      </p>

      {error && (
        <div className="px-2 py-1.5 rounded border border-[rgba(147,50,26,0.3)] bg-[rgba(147,50,26,0.08)]">
          <span className="font-mohave text-body-sm text-[#FF6B4A]">
            {error}
          </span>
        </div>
      )}

      {scanning && progress ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[rgba(111,148,176,0.2)] bg-[rgba(111,148,176,0.06)]">
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
                  width: `${
                    progress.total > 0
                      ? (progress.processed / progress.total) * 100
                      : 0
                  }%`,
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
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[rgba(111,148,176,0.2)] bg-[rgba(111,148,176,0.06)]">
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
