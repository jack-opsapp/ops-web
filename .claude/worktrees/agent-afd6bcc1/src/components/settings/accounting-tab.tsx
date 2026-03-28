"use client";

import { Loader2, RefreshCw, Link2, Unlink, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useAccountingConnections,
  useInitiateOAuth,
  useDisconnectProvider,
  useUpdateSyncEnabled,
  useTriggerSync,
  useSyncHistory,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
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
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: connections, isLoading } = useAccountingConnections();
  const initiateOAuth = useInitiateOAuth();
  const disconnect = useDisconnectProvider();
  const updateSyncEnabled = useUpdateSyncEnabled();
  const triggerSync = useTriggerSync();

  const connection = connections?.find((c) => c.provider === provider);
  const isConnected = connection?.isConnected ?? false;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
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
            <span className="flex items-center gap-1 text-green-400 font-kosugi text-[11px]">
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
              <div className="flex items-center gap-1.5 text-text-tertiary font-kosugi text-[11px]">
                <Clock className="w-[12px] h-[12px]" />
                {t("integrations.lastSynced")} {new Date(connection.lastSyncAt).toLocaleString()}
              </div>
            )}

            <div className="flex items-center justify-between py-[6px]">
              <div>
                <p className="font-mohave text-body text-text-primary">{t("accounting.syncEnabled")}</p>
                <p className="font-kosugi text-[11px] text-text-disabled">{t("accounting.syncEnabledDesc")}</p>
              </div>
              <button
                onClick={() => {
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
                  connection?.syncEnabled ? "bg-ops-accent" : "bg-background-elevated"
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

            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
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
            onClick={() => initiateOAuth.mutate({ companyId, provider })}
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
            <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
          </div>
        ) : !history || history.length === 0 ? (
          <p className="font-kosugi text-[11px] text-text-disabled">{t("accounting.noSyncHistory")}</p>
        ) : (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {history.map((entry) => {
              const StatusIcon = STATUS_ICONS[entry.status] ?? CheckCircle2;
              return (
                <div key={entry.id} className="flex items-start gap-2 py-1.5 border-b border-border last:border-0">
                  <StatusIcon className={cn("w-[14px] h-[14px] mt-0.5 shrink-0", STATUS_COLORS[entry.status] ?? "text-text-tertiary")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mohave text-body-sm text-text-primary capitalize">{entry.provider}</span>
                      <span className="font-kosugi text-[10px] text-text-disabled">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {entry.details && (
                      <p className="font-kosugi text-[11px] text-text-tertiary truncate">{entry.details}</p>
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
