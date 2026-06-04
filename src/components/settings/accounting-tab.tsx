"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Link2, Unlink, Clock, CheckCircle2, XCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useAccountingConnections,
  useInitiateOAuth,
  useDisconnectProvider,
  useUpdateSyncEnabled,
  useUpdateSyncMode,
  useTriggerSync,
  useSyncHistory,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { AccountingProvider } from "@/lib/types/pipeline";

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  partial: AlertTriangle,
  error: XCircle,
};

const STATUS_COLORS: Record<string, string> = {
  success: "text-green-400",
  partial: "text-yellow-400",
  error: "text-red-400",
};

function ProviderCard({ provider, label }: { provider: AccountingProvider; label: string }) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: connections, isLoading } = useAccountingConnections();
  const initiateOAuth = useInitiateOAuth();
  const disconnect = useDisconnectProvider();
  const updateSyncEnabled = useUpdateSyncEnabled();
  const updateSyncMode = useUpdateSyncMode();
  const triggerSync = useTriggerSync();
  const [confirmFullCrud, setConfirmFullCrud] = useState(false);

  const connection = connections?.find((c) => c.provider === provider);
  const isConnected = connection?.isConnected ?? false;
  const isFullCrud = connection?.syncDirection === "bidirectional";
  const propagateDeletes = connection?.propagateDeletes ?? false;

  function setMode(syncDirection: "pull_only" | "bidirectional", deletes: boolean) {
    if (!can("accounting.manage_connections")) return;
    updateSyncMode.mutate(
      { companyId, provider, syncDirection, propagateDeletes: deletes },
      {
        onSuccess: () => toast.success(t("accounting.toast.syncModeUpdated")),
        onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
      }
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-[20px] h-[20px] text-text-2 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{label}</CardTitle>
          {isConnected && (
            <span className="flex items-center gap-1 text-green-400 font-mono text-[11px]">
              <CheckCircle2 className="w-[14px] h-[14px]" />
              {t("integrations.connected")}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isConnected ? (
          <>
            {connection?.lastSyncAt && (
              <div className="flex items-center gap-1.5 text-text-3 font-mono text-[11px]">
                <Clock className="w-[12px] h-[12px]" />
                {t("integrations.lastSynced")} {new Date(connection.lastSyncAt).toLocaleString()}
              </div>
            )}

            <div className="flex items-center justify-between py-[6px]">
              <div>
                <p className="font-mohave text-body text-text">{t("accounting.syncEnabled")}</p>
                <p className="font-mono text-[11px] text-text-mute">{t("accounting.syncEnabledDesc")}</p>
              </div>
              <button
                onClick={() => {
                  if (!can("accounting.manage_connections")) return;
                  const newValue = !(connection?.syncEnabled ?? false);
                  updateSyncEnabled.mutate(
                    { companyId, provider, syncEnabled: newValue },
                    {
                      onSuccess: () => toast.success(t(newValue ? "accounting.toast.syncEnabled" : "accounting.toast.syncDisabled")),
                      onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
                    }
                  );
                }}
                disabled={updateSyncEnabled.isPending}
                className={cn(
                  "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
                  connection?.syncEnabled ? "bg-text-2" : "bg-fill-neutral-dim"
                )}
              >
                <span
                  className={cn(
                    "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                    connection?.syncEnabled ? "right-[2px]" : "left-[2px]"
                  )}
                />
              </button>
            </div>

            {/* Sync mode: read-only ↔ full CRUD (two-way). Full CRUD writes are
                gated server-side until the outbound engine ships. */}
            <div className="space-y-1.5 py-[6px] border-t border-border">
              <p className="font-mohave text-body text-text">{t("accounting.syncMode")}</p>
              <p className="font-mono text-[11px] text-text-mute">{t("accounting.syncModeDesc")}</p>
              <div className="inline-flex rounded-btn border border-border overflow-hidden">
                <button
                  data-testid={`sync-mode-readonly-${provider}`}
                  onClick={() => {
                    setConfirmFullCrud(false);
                    if (isFullCrud) setMode("pull_only", false);
                  }}
                  disabled={updateSyncMode.isPending}
                  className={cn(
                    "px-2.5 h-[28px] font-mono text-[11px] transition-colors",
                    !isFullCrud ? "bg-text-2 text-black" : "text-text-3 hover:text-text-2"
                  )}
                >
                  {t("accounting.modeReadOnly")}
                </button>
                <button
                  data-testid={`sync-mode-fullcrud-${provider}`}
                  onClick={() => { if (!isFullCrud) setConfirmFullCrud(true); }}
                  disabled={updateSyncMode.isPending}
                  className={cn(
                    "px-2.5 h-[28px] font-mono text-[11px] transition-colors border-l border-border",
                    isFullCrud ? "bg-text-2 text-black" : "text-text-3 hover:text-text-2"
                  )}
                >
                  {t("accounting.modeFullCrud")}
                </button>
              </div>

              {confirmFullCrud && !isFullCrud && (
                <div
                  data-testid={`sync-mode-confirm-${provider}`}
                  className="rounded-panel border border-[#C4A868] p-2.5 space-y-2"
                >
                  <div className="flex items-start gap-1.5">
                    <ShieldAlert className="w-[14px] h-[14px] text-[#C4A868] mt-0.5 shrink-0" />
                    <p className="font-mono text-[11px] text-text-2 leading-snug">
                      {t("accounting.fullCrudWarning")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => { setConfirmFullCrud(false); setMode("bidirectional", propagateDeletes); }}
                      disabled={updateSyncMode.isPending}
                    >
                      {t("accounting.fullCrudConfirm")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmFullCrud(false)}>
                      {t("accounting.cancel")}
                    </Button>
                  </div>
                </div>
              )}

              {isFullCrud && (
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <p className="font-mohave text-body-sm text-text">{t("accounting.propagateDeletes")}</p>
                    <p className="font-mono text-[11px] text-text-mute">{t("accounting.propagateDeletesDesc")}</p>
                  </div>
                  <button
                    data-testid={`propagate-deletes-${provider}`}
                    onClick={() => setMode("bidirectional", !propagateDeletes)}
                    disabled={updateSyncMode.isPending}
                    className={cn(
                      "w-[40px] h-[22px] rounded-full transition-colors relative shrink-0",
                      propagateDeletes ? "bg-text-2" : "bg-fill-neutral-dim"
                    )}
                  >
                    <span className={cn(
                      "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                      propagateDeletes ? "right-[2px]" : "left-[2px]"
                    )} />
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  if (!can("accounting.manage_connections")) return;
                  triggerSync.mutate(
                    { companyId, provider },
                    {
                      onSuccess: () => toast.success(t("accounting.toast.syncTriggered")),
                      onError: (err) => toast.error(t("accounting.toast.syncFailed"), { description: err.message }),
                    }
                  );
                }}
                disabled={triggerSync.isPending}
              >
                <RefreshCw className={cn("w-[14px] h-[14px] mr-1", triggerSync.isPending && "animate-spin")} />
                {t("integrations.syncNow")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!can("accounting.manage_connections")) return;
                  disconnect.mutate(
                    { companyId, provider },
                    {
                      onSuccess: () => toast.success(t("accounting.toast.disconnected")),
                      onError: (err) => toast.error(t("accounting.toast.disconnectFailed"), { description: err.message }),
                    }
                  );
                }}
                disabled={disconnect.isPending}
                className="text-red-400 hover:text-red-300"
              >
                <Unlink className="w-[14px] h-[14px] mr-1" />
                {t("accounting.disconnect")}
              </Button>
            </div>
          </>
        ) : (
          <Button
            onClick={() => { if (!can("accounting.manage_connections")) return; initiateOAuth.mutate({ companyId, provider }); }}
            disabled={initiateOAuth.isPending}
          >
            <Link2 className="w-[14px] h-[14px] mr-1" />
            {t("accounting.connect")} {label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SyncHistoryCard() {
  const { t } = useDictionary("settings");
  const { data: history, isLoading } = useSyncHistory();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("accounting.syncHistory")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[20px] h-[20px] text-text-2 animate-spin" />
          </div>
        ) : !history || history.length === 0 ? (
          <p className="font-mono text-[11px] text-text-mute">{t("accounting.noSyncHistory")}</p>
        ) : (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {history.map((entry) => {
              const StatusIcon = STATUS_ICONS[entry.status] ?? CheckCircle2;
              return (
                <div key={entry.id} className="flex items-start gap-2 py-1.5 border-b border-border last:border-0">
                  <StatusIcon className={cn("w-[14px] h-[14px] mt-0.5 shrink-0", STATUS_COLORS[entry.status] ?? "text-text-3")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mohave text-body-sm text-text capitalize">{entry.provider}</span>
                      <span className="font-mono text-micro text-text-mute">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {entry.details && (
                      <p className="font-mono text-[11px] text-text-3 truncate">{entry.details}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AccountingTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <ProviderCard provider={AccountingProvider.QuickBooks} label="QuickBooks" />
      <ProviderCard provider={AccountingProvider.Sage} label="Sage" />
      <SyncHistoryCard />
    </div>
  );
}
