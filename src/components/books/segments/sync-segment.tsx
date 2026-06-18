"use client";

/**
 * Books — SYNC segment (P3.1). Home for the accounting integrations
 * (capability inventory A6) and the QuickBooks read-only import (A7),
 * absorbed from /accounting?tab=integrations / ?tab=import.
 * Gated on accounting.manage_connections (invisible to everyone else).
 */

import { useMemo } from "react";
import {
  Calculator,
  Link2,
  Link2Off,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { Button } from "@/components/ui/button";
import {
  useAccountingConnections,
  useInitiateOAuth,
  useDisconnectProvider,
  useTriggerSync,
  useSyncHistory,
} from "@/lib/hooks";
import { AccountingProvider } from "@/lib/types/pipeline";
import type { AccountingConnection } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { Tag } from "@/components/ui/tag";
import { QuickBooksImportTab } from "@/components/accounting/qbo/quickbooks-import-tab";
import { FilterChips } from "../segment-toolbar";

export type SyncView = "connections" | "import";

// ─── Provider info (ported from the retired /accounting page; brand-green
//     fills dropped — icons are monochrome metadata per DESIGN.md §11) ───────

const PROVIDER_I18N_KEYS: Record<AccountingProvider, { name: string; description: string }> = {
  [AccountingProvider.QuickBooks]: {
    name: "integrations.quickbooks",
    description: "integrations.quickbooksDesc",
  },
  [AccountingProvider.Sage]: {
    name: "integrations.sage",
    description: "integrations.sageDesc",
  },
};

// ─── Connection card ──────────────────────────────────────────────────────────

function ConnectionCard({
  provider,
  connection,
  onConnect,
  onDisconnect,
  onSync,
  isSyncing,
  t,
}: {
  provider: AccountingProvider;
  connection?: AccountingConnection;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  isSyncing: boolean;
  t: (key: string) => string;
}) {
  const { locale } = useLocale();
  const i18nKeys = PROVIDER_I18N_KEYS[provider];
  const isConnected = connection?.isConnected ?? false;

  return (
    <div className="glass-surface space-y-1.5 p-2">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <div className="flex h-[40px] w-[40px] items-center justify-center rounded-[6px] bg-fill-neutral-dim">
            <Calculator className="h-[20px] w-[20px] text-text-2" />
          </div>
          <div>
            <h3 className="font-mohave text-body-sm text-text">{t(i18nKeys.name)}</h3>
            <p className="mt-[2px] font-mohave text-body-sm text-text-3">{t(i18nKeys.description)}</p>
          </div>
        </div>

        {/* Status tag */}
        <Tag variant={isConnected ? "olive" : "dim"}>
          {isConnected ? (
            <CheckCircle2 className="h-[10px] w-[10px]" />
          ) : (
            <Link2Off className="h-[10px] w-[10px]" />
          )}
          {isConnected ? t("integrations.connected") : t("integrations.notConnected")}
        </Tag>
      </div>

      {/* Connection details — never surface the QuickBooks realm id (customer-
          identifying info; Intuit security req). Status only. */}
      {isConnected && connection && (
        <div className="grid grid-cols-2 gap-1.5 border-t border-border pt-1">
          <div>
            <span className="block font-mono text-micro uppercase tracking-[0.14em] text-text-3">
              {t("integrations.lastSynced")}
            </span>
            <span className="font-mono text-data-sm text-text-2 tabular-nums">
              {connection.lastSyncAt
                ? new Date(connection.lastSyncAt).toLocaleDateString(getDateLocale(locale), {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : t("integrations.never")}
            </span>
          </div>
          <div>
            <span className="block font-mono text-micro uppercase tracking-[0.14em] text-text-3">
              {t("integrations.autoSync")}
            </span>
            <span className="font-mono text-data-sm text-text-2">
              {connection.syncEnabled ? t("integrations.enabled") : t("integrations.disabled")}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 pt-0.5">
        {isConnected ? (
          <>
            <Button variant="default" size="sm" onClick={onSync} disabled={isSyncing} className="gap-1">
              {isSyncing ? (
                <Loader2 className="h-[14px] w-[14px] animate-spin motion-reduce:animate-none" />
              ) : (
                <RefreshCw className="h-[14px] w-[14px]" />
              )}
              {isSyncing ? t("integrations.syncing") : t("integrations.syncNow")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              className="text-text-3 hover:text-rose"
            >
              <Link2Off className="mr-0.5 h-[14px] w-[14px]" />
              {t("integrations.disconnect")}
            </Button>
          </>
        ) : (
          <Button variant="default" size="sm" onClick={onConnect} className="gap-1">
            <Link2 className="h-[14px] w-[14px]" />
            {t("integrations.connect")} {t(i18nKeys.name)}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Sync history row ─────────────────────────────────────────────────────────

function SyncHistoryRow({
  entry,
}: {
  entry: { id: string; provider: string; status: string; timestamp: Date; details: string | null };
}) {
  const { locale } = useLocale();
  const { t } = useDictionary("accounting");
  const statusIcon =
    entry.status === "success" ? (
      <CheckCircle2 className="h-[12px] w-[12px] text-olive" />
    ) : entry.status === "error" ? (
      <AlertCircle className="h-[12px] w-[12px] text-rose" />
    ) : (
      <Clock className="h-[12px] w-[12px] text-tan" />
    );

  return (
    <div className="flex items-center gap-1.5 rounded px-1 py-[6px] hover:bg-surface-hover-subtle">
      {statusIcon}
      <span className="flex-1 truncate font-mono text-micro uppercase tracking-[0.08em] text-text-2">
        {t(`integrations.provider.${entry.provider}`, entry.provider)} —{" "}
        {t(`integrations.status.${entry.status}`, entry.status)}
      </span>
      <span className="shrink-0 font-mono text-micro text-text-3 tabular-nums">
        {new Date(entry.timestamp).toLocaleDateString(getDateLocale(locale), {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      {entry.details && (
        <span className="max-w-[200px] truncate font-mono text-micro text-text-3">
          {entry.details}
        </span>
      )}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </h2>
  );
}

// ─── Segment ──────────────────────────────────────────────────────────────────

export function SyncSegment({
  segmentControl,
  view,
  onViewChange,
}: {
  segmentControl: React.ReactNode;
  view: SyncView;
  onViewChange: (view: SyncView) => void;
}) {
  const { t } = useDictionary("accounting");
  const { t: tb } = useDictionary("books");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data: connections = [], isLoading: connectionsLoading } = useAccountingConnections();
  const { data: syncHistory = [], isLoading: historyLoading } = useSyncHistory();

  const initiateOAuth = useInitiateOAuth();
  const disconnectProvider = useDisconnectProvider();
  const triggerSync = useTriggerSync();

  const qbConnection =
    connections.find((c) => c.provider === AccountingProvider.QuickBooks && c.isConnected) ??
    connections.find((c) => c.provider === AccountingProvider.QuickBooks);
  const sageConnection =
    connections.find((c) => c.provider === AccountingProvider.Sage && c.isConnected) ??
    connections.find((c) => c.provider === AccountingProvider.Sage);

  const handleConnect = (provider: AccountingProvider) => {
    if (!companyId) return;
    initiateOAuth.mutate({ companyId, provider });
  };
  const handleDisconnect = (
    provider: AccountingProvider,
    providerEnvironment?: "production" | "sandbox",
  ) => {
    if (!companyId) return;
    disconnectProvider.mutate({ companyId, provider, providerEnvironment });
  };
  const handleSync = (provider: AccountingProvider) => {
    if (!companyId) return;
    triggerSync.mutate({ companyId, provider });
  };

  const viewOptions = useMemo(
    () => [
      { value: "connections" as SyncView, label: tb("view.connections") },
      { value: "import" as SyncView, label: tb("view.import") },
    ],
    [tb],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {segmentControl}
        <FilterChips options={viewOptions} value={view} onChange={(v) => onViewChange(v as SyncView)} />
      </div>

      {view === "import" ? (
        <QuickBooksImportTab />
      ) : (
        // Sibling glass panels sit 24px apart (DESIGN.md §7 panel gap).
        <div className="space-y-3">
          {/* Connection cards */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ConnectionCard
              provider={AccountingProvider.QuickBooks}
              connection={qbConnection}
              onConnect={() => handleConnect(AccountingProvider.QuickBooks)}
              onDisconnect={() =>
                handleDisconnect(AccountingProvider.QuickBooks, qbConnection?.providerEnvironment)
              }
              onSync={() => handleSync(AccountingProvider.QuickBooks)}
              isSyncing={
                triggerSync.isPending &&
                triggerSync.variables?.provider === AccountingProvider.QuickBooks
              }
              t={t}
            />
            <ConnectionCard
              provider={AccountingProvider.Sage}
              connection={sageConnection}
              onConnect={() => handleConnect(AccountingProvider.Sage)}
              onDisconnect={() =>
                handleDisconnect(AccountingProvider.Sage, sageConnection?.providerEnvironment)
              }
              onSync={() => handleSync(AccountingProvider.Sage)}
              isSyncing={
                triggerSync.isPending && triggerSync.variables?.provider === AccountingProvider.Sage
              }
              t={t}
            />
          </div>

          {/* Sync history */}
          <div className="glass-surface space-y-1.5 p-2">
            <div className="flex items-center justify-between">
              <PanelTitle>{t("integrations.syncHistory")}</PanelTitle>
              {connectionsLoading && (
                <Loader2 className="h-[14px] w-[14px] animate-spin motion-reduce:animate-none text-text-3" />
              )}
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-[20px] w-[20px] animate-spin motion-reduce:animate-none text-text-3" />
              </div>
            ) : syncHistory.length === 0 ? (
              <p className="py-4 font-mono text-micro text-text-mute">—</p>
            ) : (
              <div className="max-h-[300px] space-y-[2px] overflow-y-auto">
                {syncHistory.map((entry) => (
                  <SyncHistoryRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>

          {/* How sync works */}
          <div className="glass-surface space-y-1 p-2">
            <PanelTitle>{t("integrations.howSyncWorks")}</PanelTitle>
            <div className="space-y-1 pt-0.5">
              {(
                [
                  ["integrations.outbound", "integrations.outboundDesc"],
                  ["integrations.inbound", "integrations.inboundDesc"],
                  ["integrations.conflicts", "integrations.conflictsDesc"],
                ] as const
              ).map(([titleKey, descKey], i) => (
                <div key={titleKey} className="flex items-start gap-1">
                  <span className="mt-[2px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[4px] border border-border font-mono text-micro text-text-3 tabular-nums">
                    {i + 1}
                  </span>
                  <p className="font-mohave text-body-sm leading-relaxed text-text-2">
                    <strong className="font-medium text-text">{t(titleKey)}</strong> {t(descKey)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
