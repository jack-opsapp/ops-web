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
import type { GmailSyncFilters } from "@/lib/types/pipeline";
import { Button } from "@/components/ui/button";
import { EmailFilterBuilder } from "@/components/settings/email-filter-builder";
import { EmailSetupWizard } from "@/components/settings/email-setup-wizard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useGmailConnections,
  useDeleteGmailConnection,
  useUpdateGmailConnection,
  useTriggerGmailSync,
  useGmailImport,
  useCompanySettings,
  useUpdateCompanySettings,
} from "@/lib/hooks";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

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
  const { data: settings, isLoading } = useCompanySettings();
  const updateSettings = useUpdateCompanySettings();

  const followUpDays = settings?.followUpReminderDays ?? 3;
  const isEnabled = followUpDays > 0;

  function handleToggle() {
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
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: connections = [], isLoading: connectionsLoading } = useGmailConnections();
  const deleteConnection = useDeleteGmailConnection();
  const updateConnection = useUpdateGmailConnection();
  const triggerSync = useTriggerGmailSync();
  const gmailImport = useGmailImport();

  const [importStarted, setImportStarted] = useState(false);
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState("");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitialStep, setWizardInitialStep] = useState<string | undefined>();
  const [isFirstConnect, setIsFirstConnect] = useState(false);
  const [scanState, setScanState] = useState<{
    scanning: boolean;
    progress?: { stage: string; message: string };
  }>({ scanning: false });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "integrations" && params.get("status") === "connected") {
      toast.success(t("integrations.toast.gmailConnected"));
      if (params.get("firstConnect") === "true") {
        setIsFirstConnect(true);
      }
      window.history.replaceState({}, "", "/settings?tab=integrations");
    }
  }, []);

  useEffect(() => {
    if (!isFirstConnect) return;
    // Wait for connections to load, then scroll to import section
    const timer = setTimeout(() => {
      const importSection = document.getElementById("gmail-import-section");
      if (importSection) {
        importSection.scrollIntoView({ behavior: "smooth", block: "center" });
        importSection.classList.add("ring-2", "ring-ops-accent", "ring-opacity-50");
        setTimeout(() => {
          importSection.classList.remove("ring-2", "ring-ops-accent", "ring-opacity-50");
        }, 3000);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [isFirstConnect]);

  const companyConnections = connections.filter((c) => c.type === "company");
  const individualConnections = connections.filter((c) => c.type === "individual");
  const hasAnyConnection = connections.length > 0;
  const wizardDone = companyConnections[0]?.syncFilters?.wizardCompleted === true;
  const hasSavedScan = !wizardDone && !!companyConnections[0]?.syncFilters?.lastScanJobId;
  const savedScanSummary = companyConnections[0]?.syncFilters?.lastScanSummary;
  const savedScanTotal = companyConnections[0]?.syncFilters?.lastScanTotal;
  const savedScanImportCount = companyConnections[0]?.syncFilters?.lastScanImportCount;
  const savedWizardStep = companyConnections[0]?.syncFilters?.wizardStep;

  function handleConnectGmail(type: "company" | "individual") {
    const params = new URLSearchParams({
      companyId,
      type,
      ...(type === "individual" && currentUser?.id ? { userId: currentUser.id } : {}),
    });
    window.location.href = `/api/integrations/gmail?${params}`;
  }

  function handleDisconnect(id: string) {
    deleteConnection.mutate(id, {
      onSuccess: () => toast.success(t("integrations.toast.disconnected")),
      onError: (err) => toast.error(t("integrations.toast.disconnectFailed"), { description: err.message }),
    });
  }

  function handleToggleSync(id: string, currentEnabled: boolean) {
    updateConnection.mutate(
      { id, data: { id, syncEnabled: !currentEnabled } },
      {
        onSuccess: () => toast.success(currentEnabled ? t("integrations.toast.syncPaused") : t("integrations.toast.syncEnabled")),
        onError: (err) => toast.error(t("integrations.toast.updateFailed"), { description: err.message }),
      }
    );
  }

  function handleSync() {
    triggerSync.mutate(undefined, {
      onSuccess: () => toast.success(t("integrations.toast.syncTriggered")),
      onError: (err) => toast.error(t("integrations.toast.syncFailed"), { description: err.message }),
    });
  }

  function handleUpdateSyncInterval(id: string, minutes: number) {
    updateConnection.mutate(
      { id, data: { id, syncIntervalMinutes: minutes } },
      {
        onSuccess: () => toast.success("Sync frequency updated"),
        onError: (err) => toast.error("Failed to update", { description: err.message }),
      }
    );
  }

  function handleUpdateFilters(id: string, filters: GmailSyncFilters) {
    // Strip empty rules before saving — prevents blank rule rows from persisting
    const cleaned = {
      ...filters,
      rules: (filters.rules ?? []).filter((r) => r.value.trim() !== ""),
    };
    if (cleaned.rules.length === 0) delete (cleaned as Record<string, unknown>).rules;
    updateConnection.mutate(
      { id, data: { id, syncFilters: cleaned } },
      {
        onSuccess: () => toast.success("Email filters updated"),
        onError: (err) => toast.error("Failed to update filters", { description: err.message }),
      }
    );
  }

  function handleStartImport(daysBack: number) {
    const firstConnection = connections[0];
    if (!firstConnection) return;

    const importAfter = new Date();
    importAfter.setDate(importAfter.getDate() - daysBack);
    const dateStr = importAfter.toISOString().split("T")[0];

    startImportFromDate(firstConnection.id, dateStr);
  }

  function handleStartImportCustom() {
    const firstConnection = connections[0];
    if (!firstConnection || !customDate) return;
    startImportFromDate(firstConnection.id, customDate);
  }

  function startImportFromDate(connectionId: string, dateStr: string) {
    setImportStarted(true);
    gmailImport.startImport.mutate(
      { companyId, connectionId, importAfter: dateStr },
      {
        onSuccess: () => toast.success("Historical import started"),
        onError: (err) => {
          toast.error("Failed to start import", { description: err.message });
          setImportStarted(false);
        },
      }
    );
  }

  function openWizard(step?: string) {
    setWizardInitialStep(step);
    setWizardOpen(true);
  }

  return (
    <div className="space-y-3">
      {/* Email Setup Wizard */}
      <EmailSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialStep={wizardInitialStep}
        onScanStateChange={setScanState}
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
            <Button onClick={() => handleConnectGmail("company")} className="gap-[6px]">
              <ExternalLink className="w-[14px] h-[14px]" />
              {t("integrations.connectCompanyGmail")}
            </Button>
          )}

          {hasAnyConnection && (
            <div className="pt-[4px] flex items-center gap-[6px]">
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openWizard()}
                className="gap-[4px] font-kosugi text-[11px] text-text-disabled hover:text-ops-accent"
              >
                Setup Wizard
              </Button>
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

          {/* Before wizard: warning + setup CTA */}
          {hasAnyConnection && !wizardDone && (
            <div className="space-y-1.5">
              {/* Scan in progress indicator */}
              {scanState.scanning ? (
                <button
                  onClick={() => openWizard("scan")}
                  className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-ops-accent/30 bg-ops-accent/5 hover:bg-ops-accent/10 hover:border-ops-accent/50 transition-colors text-left"
                >
                  <Loader2 className="w-[18px] h-[18px] text-ops-accent shrink-0 animate-spin" />
                  <div className="flex-1 min-w-0">
                    <span className="font-mohave text-body text-ops-accent block">
                      Email scan in progress
                    </span>
                    <span className="font-kosugi text-[10px] text-text-disabled">
                      {scanState.progress?.message || "Analyzing your inbox..."}
                    </span>
                  </div>
                </button>
              ) : (
                <>
                  {hasSavedScan ? (
                    <>
                      {/* AI analysis complete — resume CTA */}
                      <button
                        onClick={() => openWizard(savedWizardStep ?? "filters")}
                        className="w-full flex items-center gap-[8px] px-2 py-2.5 rounded border border-[#9DB582]/40 bg-[#9DB582]/8 hover:bg-[#9DB582]/14 hover:border-[#9DB582]/60 transition-colors text-left"
                      >
                        <CheckCircle className="w-[18px] h-[18px] text-[#9DB582] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mohave text-body text-[#9DB582] block">
                            AI Analysis Complete
                          </span>
                          <span className="font-kosugi text-[10px] text-text-tertiary block mt-[1px]">
                            {savedScanTotal && savedScanImportCount != null
                              ? `${savedScanTotal} emails scanned · ${savedScanImportCount} to import`
                              : "Continue setting up your email import"}
                          </span>
                        </div>
                        <span className="font-mohave text-body-sm text-[#9DB582] shrink-0">
                          Continue →
                        </span>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Warning banner */}
                      <div className="flex items-start gap-[8px] px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/8">
                        <AlertTriangle className="w-[16px] h-[16px] text-amber-500 shrink-0 mt-[2px]" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mohave text-body-sm text-amber-600 dark:text-amber-400 block">
                            Email sync is paused
                          </span>
                          <span className="font-kosugi text-[10px] text-text-disabled">
                            Filters are not configured. Complete the setup wizard to start syncing emails into your pipeline.
                          </span>
                        </div>
                      </div>

                      {/* Setup CTA */}
                      <button
                        onClick={() => openWizard()}
                        className="w-full flex items-center gap-[8px] px-2 py-2 rounded border border-ops-accent/30 bg-ops-accent/5 hover:bg-ops-accent/10 hover:border-ops-accent/50 transition-colors text-left"
                      >
                        <Mail className="w-[18px] h-[18px] text-ops-accent shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mohave text-body text-ops-accent block">
                            Set Up Email Import
                          </span>
                          <span className="font-kosugi text-[10px] text-text-disabled">
                            Configure filters and import historical emails from your inbox
                          </span>
                        </div>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* After wizard: show advanced filters + import */}
          {hasAnyConnection && wizardDone && (
            <>
              <details className="pt-[4px]">
                <summary className="font-kosugi text-[11px] text-text-disabled cursor-pointer hover:text-text-secondary">
                  Advanced email filters
                </summary>
                <div className="mt-1 mb-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openWizard("filters")}
                    className="gap-[4px] font-kosugi text-[11px] text-text-disabled hover:text-ops-accent"
                  >
                    Re-run Filter Wizard
                  </Button>
                </div>
                <div className="mt-1 space-y-1.5 pl-[4px] border-l-2 border-border">
                  {/* Filter Builder */}
                  {companyConnections[0] && (
                    <div>
                      <label className="font-kosugi text-[10px] text-text-disabled block mb-[4px]">
                        Filter rules — only import/sync emails that match
                      </label>
                      <EmailFilterBuilder
                        filters={companyConnections[0].syncFilters}
                        connectionId={companyConnections[0].id}
                        onUpdate={(updated) =>
                          handleUpdateFilters(companyConnections[0].id, updated)
                        }
                      />
                    </div>
                  )}

                  {/* Preset blocklist toggle */}
                  <div className="flex items-center gap-[6px] pt-[4px]">
                    <button
                      onClick={() => {
                        const conn = companyConnections[0];
                        if (!conn) return;
                        handleUpdateFilters(conn.id, {
                          ...conn.syncFilters,
                          usePresetBlocklist: !conn.syncFilters.usePresetBlocklist,
                        });
                      }}
                      className="shrink-0"
                    >
                      {companyConnections[0]?.syncFilters.usePresetBlocklist ? (
                        <ToggleRight className="w-[28px] h-[28px] text-[#6B8F71]" />
                      ) : (
                        <ToggleLeft className="w-[28px] h-[28px] text-text-disabled" />
                      )}
                    </button>
                    <span className="font-kosugi text-[11px] text-text-secondary">
                      Block known newsletter & notification domains (60+ pre-configured)
                    </span>
                  </div>
                </div>
              </details>

              {!importStarted && (
                <div id="gmail-import-section" className="pt-[4px] space-y-[6px] transition-all duration-300">
                  <label className="flex items-center gap-[6px] font-kosugi text-[11px] text-text-secondary">
                    <Mail className="w-[14px] h-[14px] text-text-disabled" />
                    Import Historical Emails
                  </label>
                  <p className="font-mohave text-body-sm text-text-disabled">
                    Scan past emails for leads that may already be in your inbox.
                  </p>
                  <div className="flex flex-wrap gap-[6px]">
                    {[
                      { label: "Last 7 days", days: 7 },
                      { label: "Last 30 days", days: 30 },
                      { label: "Last 90 days", days: 90 },
                      { label: "6 months", days: 180 },
                    ].map((preset) => (
                      <Button
                        key={preset.days}
                        variant="secondary"
                        size="sm"
                        onClick={() => handleStartImport(preset.days)}
                        disabled={gmailImport.isImporting}
                        className="font-kosugi text-[11px]"
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowCustomDate(!showCustomDate)}
                      disabled={gmailImport.isImporting}
                      className="font-kosugi text-[11px]"
                    >
                      Custom
                    </Button>
                  </div>
                  {showCustomDate && (
                    <div className="flex items-center gap-[6px] mt-[6px]">
                      <input
                        type="date"
                        value={customDate}
                        onChange={(e) => setCustomDate(e.target.value)}
                        max={new Date().toISOString().split("T")[0]}
                        className="bg-background-input border border-border rounded px-1.5 py-[6px] font-mohave text-body-sm text-text-primary"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleStartImportCustom}
                        disabled={!customDate || gmailImport.isImporting}
                        className="font-kosugi text-[11px]"
                      >
                        Import
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {importStarted && gmailImport.isImporting && (
            <div className="flex items-center gap-[6px] pt-[4px]">
              <Loader2 className="w-[14px] h-[14px] text-ops-accent animate-spin" />
              <span className="font-mohave text-body-sm text-text-secondary">
                Importing emails&hellip;{" "}
                {gmailImport.status?.processedEmails != null && (
                  <span className="text-text-disabled">
                    ({gmailImport.status.processedEmails} processed)
                  </span>
                )}
              </span>
            </div>
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
