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
  Database,
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
import { useActionPromptStore } from "@/stores/action-prompt-store";

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
  const { showPrompt, removePrompt } = useActionPromptStore();

  // Use refs for callbacks to avoid re-triggering the poll effect
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const showPromptRef = useRef(showPrompt);
  showPromptRef.current = showPrompt;
  const removePromptRef = useRef(removePrompt);
  removePromptRef.current = removePrompt;

  useEffect(() => {
    // Don't poll when the wizard is open — the wizard handles its own polling
    if (wizardOpen) {
      if (pollRef.current) clearTimeout(pollRef.current);
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/integrations/email/analyze-status?jobId=${jobId}`);
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

          // Fire action prompt notification
          showPromptRef.current({
            id: "email-analysis-complete",
            icon: CheckCircle,
            title: "Pipeline analysis complete",
            description: `Found ${data.result.leads?.length ?? 0} leads from ${data.result.totalScanned ?? 0} emails`,
            ctaLabel: "Review Leads",
            ctaAction: () => {
              removePromptRef.current("email-analysis-complete");
              onCompleteRef.current();
            },
            persistent: false,
            dismissable: true,
            variant: "accent",
          });

          // Phase C background indexing toast — fires after Phase B completion.
          // Navigates to /intel where the activation animation plays.
          setTimeout(() => {
            showPromptRef.current({
              id: `phase-c-indexing-${jobId}`,
              icon: Database,
              title: "New intel available",
              description: "Your business data is being indexed.",
              ctaLabel: "View Intel",
              ctaAction: () => {
                removePromptRef.current(`phase-c-indexing-${jobId}`);
                window.location.href = "/intel";
              },
              persistent: false,
              dismissable: true,
              autoDismissMs: 8000,
              variant: "accent",
            });
          }, 2000); // Slight delay so it doesn't overlap the Phase B toast
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
          <span className="font-kosugi text-[10px] text-text-disabled">
            {totalScanned} emails scanned
          </span>
        </div>
        <span className="font-mohave text-[12px] text-[#597794] shrink-0">
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
          <span className="font-kosugi text-[10px] text-text-disabled">
            {message}
          </span>
        </div>
        <span className="font-mohave text-[12px] text-[#597794] shrink-0">
          Retry
        </span>
      </button>
    );
  }

  // In-progress state
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-[8px] px-2 py-1.5 rounded border border-[#597794]/30 bg-[#597794]/08 hover:bg-[#597794]/12 transition-colors text-left"
    >
      <Search className="w-[16px] h-[16px] text-[#597794] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mohave text-body-sm text-[#597794] block">
            Analyzing your inbox...
          </span>
          <span className="font-mohave text-[11px] text-[#666]">
            {progress}%
          </span>
        </div>
        <div className="mt-1 h-[2px] w-full bg-white/5 overflow-hidden" style={{ borderRadius: 1 }}>
          <motion.div
            className="h-full bg-[#597794]"
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

  // ─── Abandoned wizard prompt ──────────────────────────────────────────────
  // If the wizard was started but not completed, nudge the user to finish.
  const { showPrompt: showActionPrompt, removePrompt: removeActionPrompt } = useActionPromptStore();
  const abandonedPromptFiredRef = useRef(false);
  useEffect(() => {
    if (abandonedPromptFiredRef.current || !hasAnyConnection) return;
    const conn = companyConnections[0];
    if (!conn) return;
    const filters = conn.syncFilters as unknown as Record<string, unknown> | undefined;
    if (!filters) return;
    // Only prompt if analysis is done but wizard was never completed
    if (filters.lastScanComplete === true && filters.wizardCompleted !== true) {
      abandonedPromptFiredRef.current = true;
      showActionPrompt({
        id: "email-wizard-abandoned",
        icon: Mail,
        title: "You have leads waiting",
        description: "Your inbox analysis found leads. Finish the import to add them to your pipeline.",
        ctaLabel: "Continue Import",
        ctaAction: () => {
          removeActionPrompt("email-wizard-abandoned");
          setWizardOpen(true);
        },
        persistent: false,
        dismissable: true,
        variant: "accent",
      });
    }
  }, [hasAnyConnection, companyConnections]); // eslint-disable-line react-hooks/exhaustive-deps
  const wizardDone = companyConnections[0]?.syncFilters?.wizardCompleted === true;

  // Determine if there's a running analysis job to show progress for
  const activeJobId = (!wizardDone && companyConnections[0]?.syncFilters?.lastScanJobId) || null;

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

  const openWizard = useCallback(() => {
    setWizardOpen(true);
  }, []);

  return (
    <div className="space-y-3">
      {/* Import Pipeline Wizard */}
      <ImportPipelineWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        connectionId={companyConnections[0]?.id}
        companyId={companyId}
        onComplete={() => {
          setWizardOpen(false);
          toast.success("Pipeline import complete");
          queryClient.invalidateQueries({ queryKey: queryKeys.gmailConnections.all });
        }}
      />

      {/* Company Gmail */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("integrations.companyGmail")}</CardTitle>
            {companyConnections.length > 0 && (
              <span className="inline-flex items-center gap-[4px] px-1 py-[3px] rounded-sm font-kosugi text-[10px] uppercase tracking-wider bg-[rgba(107,143,113,0.15)] text-[#6B8F71]">
                <Check className="w-[12px] h-[12px]" />
                {t("integrations.connected")}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            {t("integrations.companyGmailDesc")}
          </p>

          {connectionsLoading ? (
            <div className="flex items-center gap-[6px] py-1">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mohave text-body-sm text-text-disabled">Loading...</span>
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
                      <span className="font-kosugi text-[10px] text-text-disabled">
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
                        <ToggleLeft className="w-[28px] h-[28px] text-text-disabled" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(conn.id)}
                      className="text-text-disabled hover:text-ops-error"
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
              className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-ops-accent/30 bg-ops-accent/5 hover:bg-ops-accent/10 hover:border-ops-accent/50 transition-colors text-left"
            >
              <div className="relative w-[18px] h-[18px] shrink-0">
                <div className="w-full h-full border-2 border-ops-accent/30 border-t-ops-accent rounded-full animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-mohave text-body text-ops-accent block">
                  Analysis in progress...
                </span>
                <span className="font-kosugi text-[10px] text-text-disabled">
                  Click to view progress
                </span>
              </div>
            </button>
          ) : !wizardDone ? (
            <button
              onClick={() => openWizard()}
              className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-ops-accent/30 bg-ops-accent/5 hover:bg-ops-accent/10 hover:border-ops-accent/50 transition-colors text-left"
            >
              <Mail className="w-[18px] h-[18px] text-ops-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-mohave text-body text-ops-accent block">
                  Import Your Pipeline
                </span>
                <span className="font-kosugi text-[10px] text-text-disabled">
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
              ) : !activeJobId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openWizard()}
                  className="gap-[6px]"
                >
                  <Mail className="w-[14px] h-[14px]" />
                  Complete Setup
                </Button>
              ) : null}
            </div>
          )}

          {companyConnections.length > 0 && (
            <div className="pt-[4px]">
              <label className="flex items-center gap-[6px] font-kosugi text-[11px] text-text-secondary">
                <Clock className="w-[14px] h-[14px] text-text-disabled" />
                Sync Frequency
              </label>
              <select
                className="mt-[4px] w-full bg-background-input border border-border rounded px-1.5 py-[6px] font-mohave text-body-sm text-text-primary"
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
              <div className="flex items-start gap-[8px] px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/8">
                <AlertTriangle className="w-[16px] h-[16px] text-amber-500 shrink-0 mt-[2px]" />
                <div className="flex-1 min-w-0">
                  <span className="font-mohave text-body-sm text-amber-600 dark:text-amber-400 block">
                    Pipeline import not configured
                  </span>
                  <span className="font-kosugi text-[10px] text-text-disabled">
                    Run the import wizard to discover leads in your inbox and activate ongoing sync.
                  </span>
                </div>
              </div>

              <button
                onClick={() => openWizard()}
                className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-ops-accent/30 bg-ops-accent/5 hover:bg-ops-accent/10 hover:border-ops-accent/50 transition-colors text-left"
              >
                <Mail className="w-[18px] h-[18px] text-ops-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-mohave text-body text-ops-accent block">
                    Import Your Pipeline
                  </span>
                  <span className="font-kosugi text-[10px] text-text-disabled">
                    Automatically discover leads, classify with AI, and import into your pipeline
                  </span>
                </div>
              </button>
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
                    onClick={() => openWizard()}
                    className="ml-auto font-kosugi text-[10px] text-text-disabled/50 hover:text-text-disabled transition-colors"
                  >
                    re-scan
                  </button>
                </div>
              </div>

              {/* Sync History — last 3 import jobs */}
              {importHistory.length > 0 && (
                <div className="pt-[4px] space-y-[6px]">
                  <label className="flex items-center gap-[6px] font-kosugi text-[11px] text-text-secondary">
                    <Clock className="w-[14px] h-[14px] text-text-disabled" />
                    Recent Import History
                  </label>
                  <div className="space-y-[4px]">
                    {importHistory.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between px-1.5 py-[6px] rounded border border-border bg-background-elevated/40"
                      >
                        <div className="flex items-center gap-[6px] min-w-0">
                          {job.status === "completed" ? (
                            <CheckCircle className="w-[14px] h-[14px] text-[#6B8F71] shrink-0" />
                          ) : job.status === "running" ? (
                            <Loader2 className="w-[14px] h-[14px] text-ops-accent shrink-0 animate-spin" />
                          ) : (
                            <AlertTriangle className="w-[14px] h-[14px] text-ops-error shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="font-mohave text-body-sm text-text-primary block">
                              {job.status === "completed"
                                ? `${job.processed} emails · ${job.clientsCreated} client${job.clientsCreated !== 1 ? "s" : ""} · ${job.leadsCreated} lead${job.leadsCreated !== 1 ? "s" : ""}`
                                : job.status === "running"
                                  ? `Importing... ${job.processed}/${job.totalEmails} emails`
                                  : `Failed${job.error ? `: ${job.error}` : ""}`}
                            </span>
                            <span className="font-kosugi text-[10px] text-text-disabled">
                              {formatTimeAgo(new Date(job.createdAt))}
                            </span>
                          </div>
                        </div>
                        <span
                          className={cn(
                            "px-[6px] py-[2px] rounded-sm font-kosugi text-[9px] uppercase tracking-wider shrink-0",
                            job.status === "completed" && "bg-[rgba(107,143,113,0.15)] text-[#6B8F71]",
                            job.status === "running" && "bg-ops-accent/15 text-ops-accent",
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

          <p className="font-kosugi text-[11px] text-text-disabled">
            {t("integrations.gmailHelper")}
          </p>
        </CardContent>
      </Card>

    </div>
  );
}
