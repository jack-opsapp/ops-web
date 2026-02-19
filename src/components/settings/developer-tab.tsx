"use client";

import { useState } from "react";
import { Database, Play, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";

interface MigrationResult {
  success: boolean;
  stats?: {
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
  const [showConfirm, setShowConfirm] = useState(false);

  const handleMigrate = async () => {
    if (!currentUser?.id) return;

    setShowConfirm(false);
    setIsRunning(true);
    setResult(null);

    try {
      const resp = await fetch("/api/admin/migrate-bubble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id }),
      });

      const data: MigrationResult = await resp.json();
      setResult(data);
    } catch (e) {
      setResult({
        success: false,
        error: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setIsRunning(false);
    }
  };

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
              Imports all companies, users, clients, projects, tasks, calendar
              events, and task types from Bubble.io into Supabase. Safe to run
              multiple times — existing records are updated, not duplicated.
            </p>

            <div className="mt-4">
              {!showConfirm && !isRunning && (
                <button
                  onClick={() => setShowConfirm(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors"
                >
                  <Play className="h-4 w-4" />
                  Run Migration
                </button>
              )}

              {showConfirm && !isRunning && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-[#C4A868]">
                    This will fetch all data from Bubble and insert into Supabase. Continue?
                  </p>
                  <button
                    onClick={handleMigrate}
                    className="px-4 py-2 rounded-md bg-[#417394] text-white text-sm font-medium hover:bg-[#4e8aab] transition-colors"
                  >
                    Yes, migrate
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="px-4 py-2 rounded-md border border-[rgba(255,255,255,0.15)] text-[#999] text-sm hover:text-[#E5E5E5] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {isRunning && (
                <div className="flex items-center gap-3 text-sm text-[#999]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#417394]" />
                  Migrating data from Bubble... This may take a few minutes.
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
                    .filter(([key]) => !["errorCount", "errors"].includes(key))
                    .map(([key, value]) => (
                      <div key={key} className="text-sm">
                        <span className="text-[#999]">{formatLabel(key)}:</span>{" "}
                        <span className="text-[#E5E5E5] font-medium">{value}</span>
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
