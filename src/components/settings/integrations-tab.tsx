"use client";

import { useState, useEffect } from "react";
import {
  Mail,
  ExternalLink,
  MessageCircle,
  Check,
  RefreshCw,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Clock,
  AlertTriangle,
  CheckCircle,
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
  useCompanySettings,
  useUpdateCompanySettings,
} from "@/lib/hooks";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";

function formatTimeAgo(date: Date | null): string {
  if (!date) return "Never";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function FollowUpMonitoringCard() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { data: settings, isLoading } = useCompanySettings();
  const updateSettings = useUpdateCompanySettings();

  const followUpDays = settings?.followUpReminderDays ?? 3;
  const isEnabled = followUpDays > 0;

  function handleToggle() {
    if (!can("settings.integrations")) return;
    updateSettings.mutate(
      { followUpReminderDays: isEnabled ? 0 : 3 },
      {
        onSuccess: () => toast.success(t("preferences.toast.settingUpdated")),
        onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("integrations.followUpMonitoring")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between py-[4px]">
          <div className="flex items-center gap-1.5">
            <MessageCircle className="w-[24px] h-[24px] text-ops-accent shrink-0" />
            <div>
              <p className="font-mohave text-body text-text-primary">
                {isLoading ? "..." : isEnabled ? t("integrations.active") : t("integrations.disabled") ?? "Disabled"}
              </p>
              <p className="font-kosugi text-[11px] text-text-disabled">
                {t("integrations.followUpDesc")}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={isLoading}
            className={cn(
              "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
              isEnabled ? "bg-ops-accent" : "bg-background-elevated"
            )}
          >
            <span
              className={cn(
                "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                isEnabled ? "right-[2px]" : "left-[2px]"
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export function IntegrationsTab() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { company, currentUser } = useAuthStore();
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
  const individualConnections = connections.filter((c) => c.type === "individual");
  const hasAnyConnection = connections.length > 0;
  const wizardDone = companyConnections[0]?.syncFilters?.wizardCompleted === true;

  function handleConnectGmail(type: "company" | "individual") {
    if (!can("settings.integrations")) return;
    const params = new URLSearchParams({
      companyId,
      type,
      ...(type === "individual" && currentUser?.id ? { userId: currentUser.id } : {}),
    });
    window.location.href = `/api/integrations/gmail?${params}`;
  }

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

  function openWizard() {
    setWizardOpen(true);
  }

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
                      onClick={() => handleToggleSync(conn.id, conn.syncEnabled)}
                      title={conn.syncEnabled ? t("integrations.pauseSync") : t("integrations.enableSync")}
                    >
                      {conn.syncEnabled ? (
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
          ) : (
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
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openWizard()}
                  className="gap-[6px]"
                >
                  <Mail className="w-[14px] h-[14px]" />
                  Complete Setup
                </Button>
              )}
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

          {/* Before wizard: setup CTA */}
          {hasAnyConnection && !wizardDone && (
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openWizard()}
                    className="ml-auto gap-[4px] font-kosugi text-[11px] text-text-disabled hover:text-ops-accent"
                  >
                    Re-import
                  </Button>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Personal Gmail */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("integrations.myGmail")}</CardTitle>
            {individualConnections.length > 0 && (
              <span className="inline-flex items-center gap-[4px] px-1 py-[3px] rounded-sm font-kosugi text-[10px] uppercase tracking-wider bg-[rgba(107,143,113,0.15)] text-[#6B8F71]">
                <Check className="w-[12px] h-[12px]" />
                {t("integrations.connected")}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            {t("integrations.myGmailDesc")}
          </p>

          {individualConnections.length > 0 ? (
            <div className="space-y-1">
              {individualConnections.map((conn) => (
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDisconnect(conn.id)}
                    className="text-text-disabled hover:text-ops-error shrink-0"
                  >
                    <Trash2 className="w-[14px] h-[14px]" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => handleConnectGmail("individual")}
              className="gap-[6px]"
            >
              <ExternalLink className="w-[14px] h-[14px]" />
              {t("integrations.connectMyGmail")}
            </Button>
          )}
        </CardContent>
      </Card>

      </div>

      {/* Follow-up Monitoring */}
      <FollowUpMonitoringCard />
    </div>
  );
}
