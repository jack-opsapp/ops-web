"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { AdsSyncStatus } from "@/lib/admin/ads-history-types";

export function SyncStatusBar() {
  const [dailySync, setDailySync] = useState<AdsSyncStatus | null>(null);
  const [backfill, setBackfill] = useState<AdsSyncStatus | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/google-ads/sync-status");
      if (!res.ok) return;
      const data = await res.json();
      setDailySync(data.dailySync);
      setBackfill(data.backfill);
      setBackfillRunning(data.backfill?.status === "running");
    } catch { /* silent */ }
  }, []);

  // Poll while backfill is running
  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [fetchStatus]);

  useEffect(() => {
    if (!backfillRunning) return;
    const poll = () => {
      pollRef.current = setTimeout(async () => {
        await fetchStatus();
        poll();
      }, 3000);
    };
    poll();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [backfillRunning, fetchStatus]);

  const handleBackfill = useCallback(async () => {
    setStartError(null);
    setBackfillRunning(true);
    try {
      const res = await fetch("/api/admin/google-ads/backfill", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
        setStartError(msg);
        setBackfillRunning(false);
        return;
      }
      // Kick status polling immediately — the server queued the job.
      await fetchStatus();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
      setBackfillRunning(false);
    }
  }, [fetchStatus]);

  const progress = backfill?.backfill_progress;
  const pct = progress ? Math.round((progress.completedDays / progress.totalDays) * 100) : 0;

  return (
    <div className="flex items-center gap-4 font-mohave text-[12px]">
      {/* Last synced */}
      {dailySync?.last_synced_date && (
        <span className="text-[#6B6B6B]">
          [synced through {dailySync.last_synced_date}]
        </span>
      )}

      {/* Backfill state */}
      {backfillRunning && progress ? (
        <div className="flex items-center gap-2">
          <div className="w-24 h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#597794] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[#597794]">{pct}% — {progress.currentDate}</span>
        </div>
      ) : backfill?.status === "complete" ? (
        <span className="text-[#A5B368]">History imported</span>
      ) : (
        <button
          onClick={handleBackfill}
          className="text-[#597794] hover:text-[#E5E5E5] transition-colors duration-100 uppercase tracking-wider"
        >
          Import History
        </button>
      )}

      {/* Error */}
      {startError ? (
        <span className="text-[#93321A] truncate max-w-[300px]" title={startError}>
          {startError}
        </span>
      ) : (backfill?.status === "failed" && backfill.error) ? (
        <span className="text-[#93321A] truncate max-w-[300px]" title={backfill.error}>
          {backfill.error}
        </span>
      ) : null}
    </div>
  );
}
