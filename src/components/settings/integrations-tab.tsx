"use client";

import { useState, useEffect } from "react";
import {
  Mail,
  Copy,
  ExternalLink,
  Inbox,
  MessageCircle,
  Check,
  RefreshCw,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { GmailSyncFilters } from "@/lib/types/pipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useGmailConnections,
  useDeleteGmailConnection,
  useUpdateGmailConnection,
  useTriggerGmailSync,
  useGmailImport,
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

export function IntegrationsTab() {
  const { t } = useDictionary("settings");
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: connections = [], isLoading: connectionsLoading } = useGmailConnections();
  const deleteConnection = useDeleteGmailConnection();
  const updateConnection = useUpdateGmailConnection();
  const triggerSync = useTriggerGmailSync();
  const gmailImport = useGmailImport();

  const [copied, setCopied] = useState(false);
  const [importStarted, setImportStarted] = useState(false);

  const [isFirstConnect, setIsFirstConnect] = useState(false);

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

  const forwardingAddress = companyId
    ? `leads-${companyId.slice(0, 8)}@inbound.opsapp.co`
    : "";

  const companyConnections = connections.filter((c) => c.type === "company");
  const individualConnections = connections.filter((c) => c.type === "individual");
  const hasAnyConnection = connections.length > 0;

  function handleConnectGmail(type: "company" | "individual") {
    const params = new URLSearchParams({
      companyId,
      type,
      ...(type === "individual" && currentUser?.id ? { userId: currentUser.id } : {}),
    });
    window.location.href = `/api/integrations/gmail?${params}`;
  }

  function handleCopyForwardingAddress() {
    navigator.clipboard.writeText(forwardingAddress).then(() => {
      setCopied(true);
      toast.success(t("integrations.toast.forwardingCopied"));
      setTimeout(() => setCopied(false), 2000);
    });
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
    updateConnection.mutate(
      { id, data: { id, syncFilters: filters } },
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

    setImportStarted(true);
    gmailImport.startImport.mutate(
      { connectionId: firstConnection.id, importAfter: dateStr },
      {
        onSuccess: () => toast.success("Historical import started"),
        onError: (err) => {
          toast.error("Failed to start import", { description: err.message });
          setImportStarted(false);
        },
      }
    );
  }

  return (
    <div className="space-y-3 max-w-[600px]">
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
                        <ToggleRight className="w-[16px] h-[16px] text-[#6B8F71]" />
                      ) : (
                        <ToggleLeft className="w-[16px] h-[16px] text-text-disabled" />
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
            <div className="pt-[4px]">
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

          {/* Advanced Filters */}
          {hasAnyConnection && (
            <details className="pt-[4px]">
              <summary className="font-kosugi text-[11px] text-text-disabled cursor-pointer hover:text-text-secondary">
                Advanced email filters
              </summary>
              <div className="mt-1 space-y-1.5 pl-[4px] border-l-2 border-border">
                {/* Blocked Domains */}
                <div>
                  <label className="font-kosugi text-[10px] text-text-disabled block mb-[2px]">
                    Blocked domains (one per line)
                  </label>
                  <textarea
                    defaultValue={(companyConnections[0]?.syncFilters.excludeDomains ?? []).join("\n")}
                    onBlur={(e) => {
                      const conn = companyConnections[0];
                      if (!conn) return;
                      const domains = e.target.value
                        .split("\n")
                        .map((d) => d.trim().toLowerCase())
                        .filter(Boolean);
                      handleUpdateFilters(conn.id, { ...conn.syncFilters, excludeDomains: domains });
                    }}
                    rows={3}
                    className="w-full bg-background-input border border-border rounded px-1.5 py-[6px] font-mono text-[11px] text-text-primary resize-y"
                    placeholder="example.com&#10;spammer.com"
                  />
                </div>

                {/* Subject Keyword Exclusions */}
                <div>
                  <label className="font-kosugi text-[10px] text-text-disabled block mb-[2px]">
                    Exclude subjects containing (one per line)
                  </label>
                  <textarea
                    defaultValue={(companyConnections[0]?.syncFilters.excludeSubjectKeywords ?? []).join("\n")}
                    onBlur={(e) => {
                      const conn = companyConnections[0];
                      if (!conn) return;
                      const keywords = e.target.value
                        .split("\n")
                        .map((k) => k.trim())
                        .filter(Boolean);
                      handleUpdateFilters(conn.id, { ...conn.syncFilters, excludeSubjectKeywords: keywords });
                    }}
                    rows={2}
                    className="w-full bg-background-input border border-border rounded px-1.5 py-[6px] font-mono text-[11px] text-text-primary resize-y"
                    placeholder="unsubscribe&#10;out of office"
                  />
                </div>

                {/* Preset blocklist toggle */}
                <div className="flex items-center gap-[6px]">
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
                      <ToggleRight className="w-[16px] h-[16px] text-[#6B8F71]" />
                    ) : (
                      <ToggleLeft className="w-[16px] h-[16px] text-text-disabled" />
                    )}
                  </button>
                  <span className="font-kosugi text-[11px] text-text-secondary">
                    Block known newsletter & notification domains (60+ pre-configured)
                  </span>
                </div>
              </div>
            </details>
          )}

          {hasAnyConnection && !importStarted && (
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
              </div>
            </div>
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

      {/* Email Forwarding */}
      <Card>
        <CardHeader>
          <CardTitle>{t("integrations.emailForwarding")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            {t("integrations.forwardingDesc")}
          </p>
          <div className="flex items-center gap-1">
            <div className="flex-1 bg-background-input border border-border rounded px-1.5 py-[8px]">
              <div className="flex items-center gap-[6px]">
                <Inbox className="w-[14px] h-[14px] text-text-disabled shrink-0" />
                <span className="font-mono text-data-sm text-ops-accent truncate">
                  {forwardingAddress || "Loading..."}
                </span>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="gap-[4px] shrink-0"
              onClick={handleCopyForwardingAddress}
              disabled={!forwardingAddress}
            >
              <Copy className="w-[14px] h-[14px]" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled">
            {t("integrations.forwardingHelper")}
          </p>
        </CardContent>
      </Card>

      {/* Follow-up Monitoring */}
      <Card>
        <CardHeader>
          <CardTitle>{t("integrations.followUpMonitoring")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1.5 py-[4px]">
            <MessageCircle className="w-[24px] h-[24px] text-ops-accent shrink-0" />
            <div>
              <p className="font-mohave text-body text-text-primary">{t("integrations.active")}</p>
              <p className="font-kosugi text-[11px] text-text-disabled">
                {t("integrations.followUpDesc")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
