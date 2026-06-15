"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Mail,
  Check,
  RefreshCw,
  Trash2,
  Loader2,
  Clock,
  AlertTriangle,
  CheckCircle,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RegisterTable,
  Tag,
  TablePrimary,
  TableMono,
} from "@/components/ui/register-table";
import { ImportPipelineWizard } from "./import-pipeline-wizard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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

type Translate = (key: string, fallback?: string) => string;

function formatTimeAgo(date: Date | null, t: Translate): string {
  if (!date) return t("integrations.timeAgo.never", "Never");
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t("integrations.timeAgo.justNow", "Just now");
  if (seconds < 3600)
    return t("integrations.timeAgo.minutes", "{{n}} min ago").replace(
      "{{n}}",
      String(Math.floor(seconds / 60)),
    );
  if (seconds < 86400)
    return t("integrations.timeAgo.hours", "{{n}}h ago").replace(
      "{{n}}",
      String(Math.floor(seconds / 3600)),
    );
  return t("integrations.timeAgo.days", "{{n}}d ago").replace(
    "{{n}}",
    String(Math.floor(seconds / 86400)),
  );
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
  const { t } = useDictionary("settings");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(t("integrations.analysis.analyzing", "Analyzing..."));
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
          setMessage(data.error || t("integrations.analysis.failed", "Analysis failed"));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable; only re-run when jobId or wizardOpen changes
  }, [jobId, wizardOpen]);

  const isComplete = status === "complete";
  const isError = status === "error";

  if (isComplete) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-[8px] px-2 py-1.5 rounded-[5px] border border-olive-line bg-olive-soft hover:bg-olive-soft transition-colors text-left"
      >
        <CheckCircle className="w-[16px] h-[16px] text-olive shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-mohave text-body-sm text-olive block">
            {t("integrations.analysis.completeLeads").replace("{{n}}", String(leadCount ?? 0))}
          </span>
          <span className="font-mono text-micro text-text-mute">
            {t("integrations.analysis.emailsScanned").replace("{{n}}", String(totalScanned ?? 0))}
          </span>
        </div>
        <span className="font-mono text-micro uppercase tracking-[0.12em] text-text-2 shrink-0">
          {t("integrations.analysis.reviewLeads")}
        </span>
      </button>
    );
  }

  if (isError) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-[8px] px-2 py-1.5 rounded-[5px] border border-rose-line bg-rose-soft hover:bg-rose-soft transition-colors text-left"
      >
        <AlertTriangle className="w-[16px] h-[16px] text-rose shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-mohave text-body-sm text-rose block">
            {t("integrations.analysis.failed")}
          </span>
          <span className="font-mono text-micro text-text-mute">
            {message}
          </span>
        </div>
        <span className="font-mono text-micro uppercase tracking-[0.12em] text-text-2 shrink-0">
          {t("integrations.analysis.retry")}
        </span>
      </button>
    );
  }

  // In-progress state
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-[8px] px-2 py-1.5 rounded-[5px] border border-[rgba(255,255,255,0.18)] bg-surface-input hover:bg-surface-hover transition-colors text-left"
    >
      <Search className="w-[16px] h-[16px] text-text-2 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mohave text-body-sm text-text-2 block">
            {t("integrations.analysis.analyzingInbox")}
          </span>
          <span className="font-mono text-micro tabular-nums text-text-mute">
            {progress}%
          </span>
        </div>
        <div className="mt-1 h-[2px] w-full bg-fill-neutral-dim overflow-hidden rounded-[2px]">
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
  const canAccessFeature = useFeatureFlagsStore((s) => s.canAccessFeature);
  const phaseCEnabled = canAccessFeature("phase_c");
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
        onSuccess: () => toast.success(t("integrations.frequencyUpdated")),
        onError: (err) => toast.error(t("integrations.toast.updateFailed"), { description: err.message }),
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
        onComplete={async () => {
          setWizardOpen(false);
          toast.success(t("integrations.toast.importComplete"));
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
            <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
              <span className="text-text-mute">{"// "}</span>
              {t("integrations.companyGmail")}
            </span>
            {companyConnections.length > 0 && (
              <Tag variant="olive">
                <Check className="w-[12px] h-[12px]" />
                {t("integrations.connected")}
              </Tag>
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
              <span className="font-mohave text-body-sm text-text-mute">{t("integrations.loading")}</span>
            </div>
          ) : companyConnections.length > 0 ? (
            <div className="space-y-1">
              {companyConnections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between px-1.5 py-1 bg-olive-soft border border-olive-line rounded-[5px]"
                >
                  <div className="flex items-center gap-[6px] min-w-0">
                    <Mail className="w-[16px] h-[16px] text-olive shrink-0" />
                    <div className="min-w-0">
                      <span className="font-mono text-data-sm text-olive block truncate">
                        {conn.email}
                      </span>
                      <span className="font-mono text-micro text-text-mute">
                        {t("integrations.lastSynced")} {formatTimeAgo(conn.lastSyncedAt, t)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-[8px] shrink-0">
                    <Switch
                      checked={conn.syncEnabled && wizardDone}
                      onCheckedChange={() => handleToggleSync(conn.id, conn.syncEnabled)}
                      disabled={!wizardDone}
                      title={
                        !wizardDone
                          ? t("integrations.completeImportFirst")
                          : conn.syncEnabled
                            ? t("integrations.pauseSync")
                            : t("integrations.enableSync")
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(conn.id)}
                      className="text-text-mute hover:text-rose"
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
              className="w-full flex items-center gap-[8px] px-2 py-2 rounded-[5px] border border-border bg-surface-input hover:bg-surface-hover hover:border-[rgba(255,255,255,0.20)] transition-colors text-left"
            >
              <div className="relative w-[18px] h-[18px] shrink-0">
                <div className="w-full h-full border-2 border-border border-t-text-2 rounded-full animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-mohave text-body text-text-2 block">
                  {t("integrations.analysisInProgress")}
                </span>
                <span className="font-mono text-micro text-text-mute">
                  {t("integrations.clickToViewProgress")}
                </span>
              </div>
            </button>
          ) : !wizardDone ? (
            <button
              onClick={() => openWizard()}
              className="w-full flex items-center gap-[8px] px-2 py-2 rounded-[5px] border border-border bg-surface-input hover:bg-surface-hover hover:border-[rgba(255,255,255,0.20)] transition-colors text-left"
            >
              <Mail className="w-[18px] h-[18px] text-text-2 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-mohave text-body text-text block">
                  {t("integrations.importPipeline")}
                </span>
                <span className="font-mono text-micro text-text-mute">
                  {t("integrations.importPipelineDesc")}
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
                  {t("integrations.completeSetup")}
                </Button>
              ) : !wizardDone && importComplete ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openWizard()}
                  className="gap-[6px]"
                >
                  <CheckCircle className="w-[14px] h-[14px]" />
                  {t("integrations.activateSync")}
                </Button>
              ) : null}
            </div>
          )}

          {companyConnections.length > 0 && (
            <div className="pt-[4px] space-y-[4px]">
              <label className="flex items-center gap-[6px] font-mono text-micro text-text-2">
                <Clock className="w-[14px] h-[14px] text-text-mute" />
                {t("integrations.syncFrequency")}
              </label>
              <Select
                value={String(companyConnections[0].syncIntervalMinutes)}
                onValueChange={(v) =>
                  handleUpdateSyncInterval(companyConnections[0].id, Number(v))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">{t("integrations.every15Min")}</SelectItem>
                  <SelectItem value="30">{t("integrations.every30Min")}</SelectItem>
                  <SelectItem value="60">{t("integrations.everyHour")}</SelectItem>
                  <SelectItem value="240">{t("integrations.every4Hours")}</SelectItem>
                  <SelectItem value="0">{t("integrations.manualOnly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Before wizard: setup CTA (only show if no active analysis job) */}
          {hasAnyConnection && !wizardDone && !activeJobId && (
            <div className="space-y-1.5">
              {importComplete ? (
                /* Import done but activation pending — prompt to finish */
                <button
                  onClick={() => openWizard()}
                  className="w-full flex items-center gap-[8px] px-2 py-2 rounded-[5px] border border-olive-line bg-olive-soft hover:bg-olive-soft transition-colors text-left"
                >
                  <CheckCircle className="w-[18px] h-[18px] text-olive shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-mohave text-body text-olive block">
                      {t("integrations.importCompleteActivate")}
                    </span>
                    <span className="font-mono text-micro text-text-mute">
                      {t("integrations.importCompleteActivateDesc")}
                    </span>
                  </div>
                </button>
              ) : (
                <>
                  <div className="flex items-start gap-[8px] px-2 py-1.5 rounded-[5px] border border-tan-line bg-tan-soft">
                    <AlertTriangle className="w-[16px] h-[16px] text-tan shrink-0 mt-[2px]" />
                    <div className="flex-1 min-w-0">
                      <span className="font-mohave text-body-sm text-tan block">
                        {t("integrations.importNotConfigured")}
                      </span>
                      <span className="font-mono text-micro text-text-mute">
                        {t("integrations.importNotConfiguredDesc")}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => openWizard()}
                    className="w-full flex items-center gap-[8px] px-2 py-2 rounded-[5px] border border-border bg-surface-input hover:bg-surface-hover hover:border-[rgba(255,255,255,0.20)] transition-colors text-left"
                  >
                    <Mail className="w-[18px] h-[18px] text-text-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-mohave text-body text-text block">
                        {t("integrations.importPipeline")}
                      </span>
                      <span className="font-mono text-micro text-text-mute">
                        {t("integrations.importPipelineSortDesc")}
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
                <div className="flex items-center gap-[6px] px-2 py-1.5 rounded-[5px] border border-olive-line bg-olive-soft">
                  <CheckCircle className="w-[16px] h-[16px] text-olive shrink-0" />
                  <span className="font-mohave text-body-sm text-olive">
                    {t("integrations.syncActive")}
                  </span>
                  <button
                    onClick={() => openWizard()}
                    className="ml-auto font-mono text-micro text-text-3 hover:text-text-2 transition-colors"
                  >
                    {t("integrations.reScan")}
                  </button>
                </div>
              </div>

              {/* Sync History — last 3 import jobs */}
              {importHistory.length > 0 && (
                <div className="pt-[4px] space-y-[6px]">
                  <label className="flex items-center gap-[6px] font-mono text-micro text-text-2">
                    <Clock className="w-[14px] h-[14px] text-text-mute" />
                    {t("integrations.recentImportHistory")}
                  </label>
                  <RegisterTable
                    ariaLabel={t("integrations.recentImportHistory")}
                    rows={importHistory}
                    getRowId={(job) => job.id}
                    minWidth={420}
                    columns={[
                      {
                        id: "summary",
                        header: t("integrations.colImport"),
                        cell: (job) => (
                          <div className="min-w-0">
                            <TablePrimary className="max-w-none">
                              {job.status === "completed"
                                ? t("integrations.importSummary.completed")
                                    .replace("{{emails}}", String(job.processed))
                                    .replace("{{clients}}", String(job.clientsCreated))
                                    .replace("{{leads}}", String(job.leadsCreated))
                                : job.status === "running"
                                  ? t("integrations.importSummary.running")
                                      .replace("{{processed}}", String(job.processed))
                                      .replace("{{total}}", String(job.totalEmails))
                                  : t("integrations.importSummary.failed").replace(
                                      "{{error}}",
                                      job.error ?? "",
                                    )}
                            </TablePrimary>
                            <TableMono>{formatTimeAgo(new Date(job.createdAt), t)}</TableMono>
                          </div>
                        ),
                      },
                      {
                        id: "status",
                        header: t("integrations.colStatus"),
                        align: "right",
                        cell: (job) => (
                          <Tag
                            variant={
                              job.status === "completed"
                                ? "olive"
                                : job.status === "failed"
                                  ? "rose"
                                  : "neutral"
                            }
                          >
                            {t(`integrations.jobStatus.${job.status}`)}
                          </Tag>
                        ),
                      },
                    ]}
                  />
                </div>
              )}
            </>
          )}

          <p className="font-mono text-micro text-text-mute">
            {t("integrations.gmailHelper")}
          </p>

          {/* Autonomy Status + Auto-Draft + Per-Category — Phase C only, after wizard */}
          {phaseCEnabled && hasAnyConnection && wizardDone && companyConnections[0] && (
            <div className="pt-2 border-t border-border-subtle">
              <AutonomyStatusPanel connectionId={companyConnections[0].id} />
            </div>
          )}

          {/* Auto-Send Settings — Phase C only, after wizard */}
          {phaseCEnabled && hasAnyConnection && wizardDone && companyConnections[0] && (
            <div className="pt-2 border-t border-border-subtle">
              <AutoSendSettings connectionId={companyConnections[0].id} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Setup Card — Phase C only */}
      {phaseCEnabled && <AiSetupCard />}

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
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("nav.cardTitle")}
        </span>
      </CardHeader>
      <CardContent>
        <button
          onClick={() => router.push("/settings/integrations/ai-setup")}
          className="w-full flex items-center gap-[8px] px-2 py-2 rounded-[5px] border border-border bg-surface-input hover:bg-surface-hover hover:border-[rgba(255,255,255,0.20)] transition-colors text-left"
        >
          <Brain className="w-[18px] h-[18px] text-text-2 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-mohave text-body text-text block">
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
