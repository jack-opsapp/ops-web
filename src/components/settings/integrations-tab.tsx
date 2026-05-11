"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Mail,
  Check,
  RefreshCw,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Clock,
  AlertTriangle,
  CheckCircle,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { ImportPipelineWizard } from "./import-pipeline-wizard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useGmailConnections,
  useDeleteGmailConnection,
  useUpdateGmailConnection,
  useTriggerGmailSync,
  useImportHistory,
} from "@/lib/hooks";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useCreateNotification } from "@/lib/hooks/use-notifications";
import { AutoSendSettings } from "./auto-send-settings";
import { AutonomyStatusPanel } from "./autonomy-status-panel";
import { useRouter } from "next/navigation";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { Brain } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

function formatTimeAgo(date: Date | null): string {
  if (!date) return "Never";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ─── Analysis Progress Banner ─────────────────────────────────────────────────
// Shows inline progress when analysis is running and the wizard is closed

interface AnalysisProgressBannerProps {
  jobId: string;
  wizardOpen: boolean;
  onComplete: () => void;
  onClick: () => void;
}

function AnalysisProgressBanner({ jobId, wizardOpen, onComplete, onClick }: AnalysisProgressBannerProps) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Analyzing...");
  const [status, setStatus] = useState<string>("pending");
  const [leadCount, setLeadCount] = useState<number | null>(null);
  const [totalScanned, setTotalScanned] = useState<number | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const completeFiredRef = useRef(false);
  const notify = useCreateNotification();

  // Use refs for callbacks to avoid re-triggering the poll effect
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    // Don't poll when the wizard is open — the wizard handles its own polling
    if (wizardOpen) {
      if (pollRef.current) clearTimeout(pollRef.current);
      return;
    }

    const poll = async () => {
      try {
        // authedFetch attaches the Firebase ID token and retries once on 401
        // so long-running analyses keep streaming progress even when the
        // user's token expires mid-session.
        const res = await authedFetch(`/api/integrations/email/analyze-status?jobId=${jobId}`);
        if (!res.ok) return;
        const data = await res.json();

        setStatus(data.status);
        if (data.progress) {
          setProgress(data.progress.percent);
          setMessage(data.progress.message);
        }

        if (data.status === "complete" && data.result && !completeFiredRef.current) {
          completeFiredRef.current = true;
          setLeadCount(data.result.leads?.length ?? 0);
          setTotalScanned(data.result.totalScanned ?? 0);

          // Create DB notification — appears in the header rail
          notifyRef.current({
            type: "pipeline_complete",
            title: "Pipeline analysis complete",
            body: `Found ${data.result.leads?.length ?? 0} leads from ${data.result.totalScanned ?? 0} emails`,
            actionUrl: "/settings?tab=integrations",
            actionLabel: "Review Leads",
          });

          // Phase C background indexing notification
          notifyRef.current({
            type: "intel_available",
            title: "New intel available",
            body: "Your business data is being indexed.",
            actionUrl: "/intel",
            actionLabel: "View Intel",
          });

          onCompleteRef.current();
          return;
        }

        if (data.status === "error") {
          setMessage(data.error || "Analysis failed");
          return;
        }

        pollRef.current = setTimeout(poll, 3000);
      } catch {
        pollRef.current = setTimeout(poll, 5000);
      }
    };

    poll();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [jobId, wizardOpen]); // Only re-run when jobId or wizardOpen changes

  const isComplete = status === "complete";
  const isError = status === "error";

  if (isComplete) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-[8px] px-2 py-1.5 rounded border border-[rgba(157,181,130,0.3)] bg-[rgba(157,181,130,0.08)] hover:bg-[rgba(157,181,130,0.15)] transition-colors text-left"
      >
        <CheckCircle className="w-[16px] h-[16px] text-[#9DB582] shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-mohave text-body-sm text-[#9DB582] block">
            Analysis complete — {leadCount} lead{leadCount !== 1 ? "s" : ""} found
          </span>
          <span className="font-mono text-micro text-text-mute">
            {totalScanned} emails scanned
          </span>
        </div>
        <span className="font-mohave text-[12px] text-[#6F94B0] shrink-0">
          Review Leads
        </span>
      </button>
    );
  }

  if (isError) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-[8px] px-2 py-1.5 rounded border border-[#93321A]/30 bg-[#93321A]/08 hover:bg-[#93321A]/15 transition-colors text-left"
      >
        <AlertTriangle className="w-[16px] h-[16px] text-[#FF6B4A] shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-mohave text-body-sm text-[#FF6B4A] block">
            Analysis failed
          </span>
          <span className="font-mono text-micro text-text-mute">
            {message}
          </span>
        </div>
        <span className="font-mohave text-[12px] text-[#6F94B0] shrink-0">
          Retry
        </span>
      </button>
    );
  }

  // In-progress state
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-[8px] px-2 py-1.5 rounded border border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.05)] transition-colors text-left"
    >
      <Search className="w-[16px] h-[16px] text-text-2 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mohave text-body-sm text-text-2 block">
            Analyzing your inbox...
          </span>
          <span className="font-mohave text-[11px] text-text-mute">
            {progress}%
          </span>
        </div>
        <div className="mt-1 h-[2px] w-full bg-white/5 overflow-hidden" style={{ borderRadius: 1 }}>
          <motion.div
            className="h-full bg-text-2"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: EASE }}
          />
        </div>
      </div>
    </button>
  );
}

export function IntegrationsTab() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: connections = [], isLoading: connectionsLoading } = useGmailConnections();
  const deleteConnection = useDeleteGmailConnection();
  const updateConnection = useUpdateGmailConnection();
  const triggerSync = useTriggerGmailSync();
  const { data: importHistory = [] } = useImportHistory(companyId || undefined);

  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "integrations" && params.get("status") === "connected") {
      toast.success(t("integrations.toast.gmailConnected"));
      // Auto-open the wizard for first-time connection
      if (params.get("firstConnect") === "true") {
        setWizardOpen(true);
      }
      window.history.replaceState({}, "", "/settings?tab=integrations");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount
  }, []);

  const companyConnections = connections.filter((c) => c.type === "company");
  const hasAnyConnection = connections.length > 0;

  // ─── Abandoned wizard notification ───────────────────────────────────────
  // If the wizard was started but not completed, create a notification in the rail.
  const notify = useCreateNotification();
  const abandonedPromptFiredRef = useRef(false);
  useEffect(() => {
    if (abandonedPromptFiredRef.current || !hasAnyConnection) return;
    const conn = companyConnections[0];
    if (!conn) return;
    const filters = conn.syncFilters as unknown as Record<string, unknown> | undefined;
    if (!filters) return;
    // Only notify if analysis is done but wizard was never completed
    if (filters.lastScanComplete === true && filters.wizardCompleted !== true) {
      abandonedPromptFiredRef.current = true;
      notify({
        type: "leads_waiting",
        title: "You have leads waiting",
        body: "Your inbox analysis found leads. Finish the import to add them to your pipeline.",
        persistent: true,
        actionUrl: "/settings?tab=integrations",
        actionLabel: "Continue Import",
      });
    }
  }, [hasAnyConnection, companyConnections]); // eslint-disable-line react-hooks/exhaustive-deps
  // wizardDone must accept EITHER signal. After activation, the activate route
  // flips `status` to 'active' but there's a refetch race where `syncFilters`
  // can still read the stale pre-activation flag. Treating `status === 'active'`
  // as authoritative lets the UI flip to the "active" state immediately,
  // without flashing the amber "Pipeline import not configured" CTA.
  const wizardDone =
    companyConnections[0]?.syncFilters?.wizardCompleted === true ||
    companyConnections[0]?.status === "active";
  const importComplete = companyConnections[0]?.syncFilters?.importComplete === true;

  // Determine if there's a running analysis job to show progress for
  // Hide the analysis banner once import is complete — user should finish activation in wizard
  const activeJobId = (!wizardDone && !importComplete && companyConnections[0]?.syncFilters?.lastScanJobId) || null;

  function handleDisconnect(id: string) {
    if (!can("settings.integrations")) return;
    deleteConnection.mutate(id, {
      onSuccess: () => toast.success(t("integrations.toast.disconnected")),
      onError: (err) => toast.error(t("integrations.toast.disconnectFailed"), { description: err.message }),
    });
  }

  function handleToggleSync(id: string, currentEnabled: boolean) {
    if (!can("settings.integrations")) return;
    updateConnection.mutate(
      { id, data: { id, syncEnabled: !currentEnabled } },
      {
        onSuccess: () => toast.success(currentEnabled ? t("integrations.toast.syncPaused") : t("integrations.toast.syncEnabled")),
        onError: (err) => toast.error(t("integrations.toast.updateFailed"), { description: err.message }),
      }
    );
  }

  function handleSync() {
    if (!can("settings.integrations")) return;
    triggerSync.mutate(undefined, {
      onSuccess: () => toast.success(t("integrations.toast.syncTriggered")),
      onError: (err) => toast.error(t("integrations.toast.syncFailed"), { description: err.message }),
    });
  }

  function handleUpdateSyncInterval(id: string, minutes: number) {
    if (!can("settings.integrations")) return;
    updateConnection.mutate(
      { id, data: { id, syncIntervalMinutes: minutes } },
      {
        onSuccess: () => toast.success("Sync frequency updated"),
        onError: (err) => toast.error("Failed to update", { description: err.message }),
      }
    );
  }

  // Invalidate connections query when wizard analysis starts (via onComplete or page load)
  const queryClient = useQueryClient();

  // Tracks whether the operator opened the wizard via the "re-scan"
  // affordance on an already-active connection. The wizard reads this
  // flag and starts a fresh analyze run at step 2 instead of jumping to
  // the activation confirmation (step 5). Reset to false whenever the
  // wizard closes so the next normal open goes back to default behavior.
  const [wizardRescan, setWizardRescan] = useState(false);

  const openWizard = useCallback((opts?: { rescan?: boolean }) => {
    setWizardRescan(!!opts?.rescan);
    setWizardOpen(true);
  }, []);

  return (
    <div className="space-y-3">
      {/* Import Pipeline Wizard */}
      <ImportPipelineWizard
        open={wizardOpen}
        onOpenChange={(o) => {
          setWizardOpen(o);
          if (!o) setWizardRescan(false);
        }}
        connectionId={companyConnections[0]?.id}
        companyId={companyId}
        rescan={wizardRescan}
        onComplete={async () => {
          setWizardOpen(false);
          setWizardRescan(false);
          toast.success("Pipeline import complete");
          // Await both invalidation AND refetch so the tile re-renders with the
          // post-activation connection data (status='active', syncFilters.wizardCompleted=true)
          // before any other guard reads stale cache.
          await queryClient.invalidateQueries({ queryKey: queryKeys.gmailConnections.all });
          await queryClient.refetchQueries({ queryKey: queryKeys.gmailConnections.all });
        }}
      />

      {/* Company Gmail */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("integrations.companyGmail")}</CardTitle>
            {companyConnections.length > 0 && (
              <span className="inline-flex items-center gap-[4px] px-1 py-[3px] rounded-sm font-mono text-micro uppercase tracking-wider bg-[rgba(107,143,113,0.15)] text-[#6B8F71]">
                <Check className="w-[12px] h-[12px]" />
                {t("integrations.connected")}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-2">
            {t("integrations.companyGmailDesc")}
          </p>

          {connectionsLoading ? (
            <div className="flex items-center gap-[6px] py-1">
              <Loader2 className="w-[16px] h-[16px] text-text-mute animate-spin" />
              <span className="font-mohave text-body-sm text-text-mute">Loading...</span>
            </div>
          ) : companyConnections.length > 0 ? (
            <div className="space-y-1">
              {companyConnections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between px-1.5 py-1 bg-[rgba(107,143,113,0.08)] border border-[rgba(107,143,113,0.2)] rounded"
                >
                  <div className="flex items-center gap-[6px] min-w-0">
                    <Mail className="w-[16px] h-[16px] text-[#6B8F71] shrink-0" />
                    <div className="min-w-0">
                      <span className="font-mono text-data-sm text-[#6B8F71] block truncate">
                        {conn.email}
                      </span>
                      <span className="font-mono text-micro text-text-mute">
                        {t("integrations.lastSynced")} {formatTimeAgo(conn.lastSyncedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-[4px] shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => wizardDone && handleToggleSync(conn.id, conn.syncEnabled)}
                      title={!wizardDone ? "Complete pipeline import first" : conn.syncEnabled ? t("integrations.pauseSync") : t("integrations.enableSync")}
                      className={!wizardDone ? "opacity-40 cursor-not-allowed" : ""}
                      disabled={!wizardDone}
                    >
                      {conn.syncEnabled && wizardDone ? (
                        <ToggleRight className="w-[28px] h-[28px] text-[#6B8F71]" />
                      ) : (
                        <ToggleLeft className="w-[28px] h-[28px] text-text-mute" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(conn.id)}
                      className="text-text-mute hover:text-ops-error"
                    >
                      <Trash2 className="w-[14px] h-[14px]" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : activeJobId && !wizardDone ? (
            <button
              onClick={() => openWizard()}
              className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.20)] transition-colors text-left"
            >
              <div className="relative w-[18px] h-[18px] shrink-0">
                <div className="w-full h-full border-2 border-[rgba(255,255,255,0.15)] border-t-text-2 rounded-full animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-mohave text-body text-text-2 block">
                  Analysis in progress...
                </span>
                <span className="font-mono text-micro text-text-mute">
                  Click to view progress
                </span>
              </div>
            </button>
          ) : !wizardDone ? (
            <button
              onClick={() => openWizard()}
              className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.20)] transition-colors text-left"
            >
              <Mail className="w-[18px] h-[18px] text-text-2 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-mohave text-body text-text block">
                  Import Your Pipeline
                </span>
                <span className="font-mono text-micro text-text-mute">
                  Connect your email and automatically import leads into your pipeline
                </span>
              </div>
            </button>
          ) : null}

          {/* Analysis Progress Banner — shows when analysis is running/complete and wizard is closed */}
          {hasAnyConnection && !wizardDone && activeJobId && (
            <AnalysisProgressBanner
              jobId={activeJobId}
              wizardOpen={wizardOpen}
              onComplete={openWizard}
              onClick={openWizard}
            />
          )}

          {hasAnyConnection && (
            <div className="pt-[4px] flex items-center gap-[6px]">
              {wizardDone ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSync}
                  loading={triggerSync.isPending}
                  className="gap-[6px]"
                >
                  <RefreshCw className={cn("w-[14px] h-[14px]", triggerSync.isPending && "animate-spin")} />
                  {t("integrations.syncNow")}
                </Button>
              ) : !activeJobId && !importComplete ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openWizard()}
                  className="gap-[6px]"
                >
                  <Mail className="w-[14px] h-[14px]" />
                  Complete Setup
                </Button>
              ) : !wizardDone && importComplete ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openWizard()}
                  className="gap-[6px]"
                >
                  <CheckCircle className="w-[14px] h-[14px]" />
                  Activate Sync
                </Button>
              ) : null}
            </div>
          )}

          {companyConnections.length > 0 && (
            <div className="pt-[4px]">
              <label className="flex items-center gap-[6px] font-mono text-[11px] text-text-2">
                <Clock className="w-[14px] h-[14px] text-text-mute" />
                Sync Frequency
              </label>
              <select
                className="mt-[4px] w-full bg-surface-input border border-border rounded px-1.5 py-[6px] font-mohave text-body-sm text-text"
                value={companyConnections[0].syncIntervalMinutes}
                onChange={(e) =>
                  handleUpdateSyncInterval(companyConnections[0].id, Number(e.target.value))
                }
              >
                <option value={15}>Every 15 min</option>
                <option value={30}>Every 30 min</option>
                <option value={60}>Every hour</option>
                <option value={240}>Every 4 hours</option>
                <option value={0}>Manual only</option>
              </select>
            </div>
          )}

          {/* Before wizard: setup CTA (only show if no active analysis job) */}
          {hasAnyConnection && !wizardDone && !activeJobId && (
            <div className="space-y-1.5">
              {importComplete ? (
                /* Import done but activation pending — prompt to finish */
                <button
                  onClick={() => openWizard()}
                  className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-[rgba(157,181,130,0.3)] bg-[rgba(157,181,130,0.08)] hover:bg-[rgba(157,181,130,0.15)] transition-colors text-left"
                >
                  <CheckCircle className="w-[18px] h-[18px] text-[#9DB582] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-mohave text-body text-[#9DB582] block">
                      Import complete — activate sync
                    </span>
                    <span className="font-mono text-micro text-text-mute">
                      Your leads are in the pipeline. Finish setup to enable ongoing sync.
                    </span>
                  </div>
                </button>
              ) : (
                <>
                  <div className="flex items-start gap-[8px] px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/8">
                    <AlertTriangle className="w-[16px] h-[16px] text-amber-500 shrink-0 mt-[2px]" />
                    <div className="flex-1 min-w-0">
                      <span className="font-mohave text-body-sm text-amber-600 dark:text-amber-400 block">
                        Pipeline import not configured
                      </span>
                      <span className="font-mono text-micro text-text-mute">
                        Run the import wizard to discover leads in your inbox and activate ongoing sync.
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => openWizard()}
                    className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.20)] transition-colors text-left"
                  >
                    <Mail className="w-[18px] h-[18px] text-text-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-mohave text-body text-text block">
                        Import Your Pipeline
                      </span>
                      <span className="font-mono text-micro text-text-mute">
                        Automatically discover leads, classify with AI, and import into your pipeline
                      </span>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}

          {/* After wizard: sync active + re-run option */}
          {hasAnyConnection && wizardDone && (
            <>
              <div className="pt-[4px]">
                <div className="flex items-center gap-[6px] px-2 py-1.5 rounded border border-[rgba(107,143,113,0.2)] bg-[rgba(107,143,113,0.08)]">
                  <CheckCircle className="w-[16px] h-[16px] text-[#6B8F71] shrink-0" />
                  <span className="font-mohave text-body-sm text-[#6B8F71]">
                    Pipeline sync is active
                  </span>
                  <button
                    onClick={() => openWizard({ rescan: true })}
                    className="ml-auto font-mono text-micro text-text-mute/50 hover:text-text-mute transition-colors"
                  >
                    re-scan
                  </button>
                </div>
              </div>

              {/* Sync History — last 3 import jobs */}
              {importHistory.length > 0 && (
                <div className="pt-[4px] space-y-[6px]">
                  <label className="flex items-center gap-[6px] font-mono text-[11px] text-text-2">
                    <Clock className="w-[14px] h-[14px] text-text-mute" />
                    Recent Import History
                  </label>
                  <div className="space-y-[4px]">
                    {importHistory.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between px-1.5 py-[6px] rounded border border-border bg-fill-neutral-dim/40"
                      >
                        <div className="flex items-center gap-[6px] min-w-0">
                          {job.status === "completed" ? (
                            <CheckCircle className="w-[14px] h-[14px] text-[#6B8F71] shrink-0" />
                          ) : job.status === "running" ? (
                            <Loader2 className="w-[14px] h-[14px] text-text-2 shrink-0 animate-spin" />
                          ) : (
                            <AlertTriangle className="w-[14px] h-[14px] text-ops-error shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="font-mohave text-body-sm text-text block">
                              {job.status === "completed"
                                ? `${job.processed} emails · ${job.clientsCreated} client${job.clientsCreated !== 1 ? "s" : ""} · ${job.leadsCreated} lead${job.leadsCreated !== 1 ? "s" : ""}`
                                : job.status === "running"
                                  ? `Importing... ${job.processed}/${job.totalEmails} emails`
                                  : `Failed${job.error ? `: ${job.error}` : ""}`}
                            </span>
                            <span className="font-mono text-micro text-text-mute">
                              {formatTimeAgo(new Date(job.createdAt))}
                            </span>
                          </div>
                        </div>
                        <span
                          className={cn(
                            "px-[6px] py-[2px] rounded-sm font-mono text-micro uppercase tracking-wider shrink-0",
                            job.status === "completed" && "bg-[rgba(107,143,113,0.15)] text-[#6B8F71]",
                            job.status === "running" && "bg-[rgba(255,255,255,0.06)] text-text-2",
                            job.status === "failed" && "bg-ops-error/15 text-ops-error",
                          )}
                        >
                          {job.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <p className="font-mono text-[11px] text-text-mute">
            {t("integrations.gmailHelper")}
          </p>

          {/* AI Autonomy Status + Auto-Draft + Per-Category — visible after wizard is done */}
          {hasAnyConnection && wizardDone && companyConnections[0] && (
            <div className="pt-2 border-t border-[rgba(255,255,255,0.04)]">
              <AutonomyStatusPanel connectionId={companyConnections[0].id} />
            </div>
          )}

          {/* Auto-Send Settings — visible after wizard is done */}
          {hasAnyConnection && wizardDone && companyConnections[0] && (
            <div className="pt-2 border-t border-[rgba(255,255,255,0.04)]">
              <AutoSendSettings connectionId={companyConnections[0].id} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Setup Card */}
      <AiSetupCard />

    </div>
  );
}

// ─── AI Setup Card ──────────────────────────────────────────────────────────────

function AiSetupCard() {
  const { t } = useDictionary("ai-setup");
  const router = useRouter();
  const canAccessFeature = useFeatureFlagsStore((s) => s.canAccessFeature);
  const phaseCEnabled = canAccessFeature("phase_c");

  if (!phaseCEnabled) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            <div className="flex items-center gap-[6px]">
              <Brain className="w-[16px] h-[16px] text-[#6F94B0]" />
              {t("nav.cardTitle")}
            </div>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <button
          onClick={() => router.push("/settings/integrations/ai-setup")}
          className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-[rgba(111, 148, 176,0.2)] bg-[rgba(111, 148, 176,0.06)] hover:bg-[rgba(111, 148, 176,0.12)] hover:border-[rgba(111, 148, 176,0.3)] transition-colors text-left"
        >
          <Brain className="w-[18px] h-[18px] text-[#6F94B0] shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-mohave text-body text-[#6F94B0] block">
              {t("nav.cardAction")}
            </span>
            <span className="font-mono text-micro text-text-mute">
              {t("nav.cardDesc")}
            </span>
          </div>
        </button>
      </CardContent>
    </Card>
  );
}
