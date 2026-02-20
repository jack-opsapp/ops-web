"use client";

import { useState, useEffect } from "react";
import { Database, Play, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { getIdToken } from "@/lib/firebase/auth";

const LAST_SYNC_KEY = "ops_migration_last_sync";

interface MigrationResult {
  success: boolean;
  stats?: {
    syncMode: "full" | "incremental";
    syncedAt: string;
    companies: number;
    users: number;
    clients: number;
    subClients: number;
    taskTypes: number;
    projects: number;
    calendarEvents: number;
    projectTasks: number;
    opsContacts: number;
    pipelineRefsUpdated: number;
    errorCount: number;
    errors: string[];
  };
  error?: string;
}

export function DeveloperTab() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [confirmMode, setConfirmMode] = useState<"full" | "incremental" | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  useEffect(() => {
    setLastSyncAt(localStorage.getItem(LAST_SYNC_KEY));
  }, []);

  const handleMigrate = async (mode: "full" | "incremental") => {
    if (!currentUser?.id) return;

    setConfirmMode(null);
    setIsRunning(true);
    setResult(null);

    try {
      const idToken = await getIdToken();

      if (!idToken) {
        setResult({ success: false, error: "Could not get auth token. Please re-login." });
        setIsRunning(false);
        return;
      }

      const body: Record<string, string> = {};
      if (mode === "incremental") {
        // Use stored timestamp or default to 7 days ago
        const since = lastSyncAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        body.sinceDate = since;
      }

      const resp = await fetch("/api/admin/migrate-bubble", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });

      const data: MigrationResult = await resp.json();
      setResult(data);

      // Store sync timestamp for next incremental run
      if (data.success && data.stats?.syncedAt) {
        localStorage.setItem(LAST_SYNC_KEY, data.stats.syncedAt);
        setLastSyncAt(data.stats.syncedAt);
      }
    } catch (e) {
      setResult({
        success: false,
        error: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const formattedLastSync = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString()
    : null;

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-lg font-semibold text-[#E5E5E5]">Developer Tools</h2>
        <p className="text-sm text-[#999] mt-1">
          These tools are only visible to users with developer permissions.
        </p>
      </div>

      {/* Migration Section */}
      <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-5">
        <div className="flex items-start gap-3">
          <Database className="h-5 w-5 text-[#417394] mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-[#E5E5E5]">
              Migrate Bubble → Supabase
            </h3>
            <p className="text-sm text-[#999] mt-1">
              Imports data from Bubble.io into Supabase. Safe to re-run —
              existing records are updated, not duplicated.
            </p>
            {formattedLastSync && (
              <p className="text-xs text-[#666] mt-1">
                Last synced: {formattedLastSync}
              </p>
            )}

            <div className="mt-4 space-y-3">
              {!confirmMode && !isRunning && (
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Sync Changes — incremental, only modified records */}
                  <button
                    onClick={() => setConfirmMode("incremental")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Sync Changes
                  </button>
                  {/* Full Migration — always available */}
                  <button
                    onClick={() => setConfirmMode("full")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[rgba(255,255,255,0.15)] text-[#999] text-sm font-medium hover:text-[#E5E5E5] hover:border-[rgba(255,255,255,0.3)] transition-colors"
                  >
                    <Play className="h-4 w-4" />
                    Full Migration
                  </button>
                </div>
              )}

              {confirmMode && !isRunning && (
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-sm text-[#C4A868]">
                    {confirmMode === "incremental"
                      ? `Sync records modified since ${formattedLastSync ?? "7 days ago"}?`
                      : "Fetch ALL data from Bubble and overwrite Supabase. Continue?"}
                  </p>
                  <button
                    onClick={() => handleMigrate(confirmMode)}
                    className="px-4 py-2 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors"
                  >
                    Yes, {confirmMode === "incremental" ? "sync" : "migrate"}
                  </button>
                  <button
                    onClick={() => setConfirmMode(null)}
                    className="px-4 py-2 rounded-md border border-[rgba(255,255,255,0.15)] text-[#999] text-sm hover:text-[#E5E5E5] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {isRunning && (
                <div className="flex items-center gap-3 text-sm text-[#999]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#417394]" />
                  {confirmMode === "incremental"
                    ? "Syncing recent changes from Bubble..."
                    : "Migrating all data from Bubble... This may take a few minutes."}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div
          className={`rounded-lg border p-5 ${
            result.success
              ? "border-green-500/30 bg-green-500/5"
              : "border-red-500/30 bg-red-500/5"
          }`}
        >
          <div className="flex items-start gap-3">
            {result.success ? (
              <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            )}
            <div className="flex-1">
              <h3 className="text-sm font-medium text-[#E5E5E5]">
                {result.success ? "Migration Complete" : "Migration Failed"}
              </h3>

              {result.error && (
                <p className="text-sm text-red-400 mt-1">{result.error}</p>
              )}

              {result.stats && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                  {Object.entries(result.stats)
                    .filter(([key]) => !["errorCount", "errors", "syncedAt"].includes(key))
                    .map(([key, value]) => (
                      <div key={key} className="text-sm">
                        <span className="text-[#999]">{formatLabel(key)}:</span>{" "}
                        <span className="text-[#E5E5E5] font-medium">{String(value)}</span>
                      </div>
                    ))}
                </div>
              )}

              {result.stats && result.stats.errorCount > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-[#C4A868]">
                    {result.stats.errorCount} error{result.stats.errorCount === 1 ? "" : "s"}:
                  </p>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded bg-black/50 p-3">
                    {result.stats.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-300/80 font-mono">
                        {err}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
