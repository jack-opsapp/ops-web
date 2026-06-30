"use client";

/**
 * Books — SYNC segment (WEB OVERHAUL P3-4). The accounting-connection UX,
 * rebuilt to the §6 UX-judgment gate's canonical pattern (Apple intent in a
 * SpaceX/xAI skin):
 *
 *   not connected → ONE entry point (ConnectPanel) → brief provider flow
 *   (ConnectAccountingModal) → live badge in the chrome (ConnectionBadge) →
 *   settings / disconnect / switch behind the badge (ConnectionSettingsModal).
 *
 * State-aware: nothing renders for a reality the operator isn't in. Built
 * full-CRUD (two-way) — read-only is the current testing posture, surfaced
 * honestly via the mode control + paused note, never hardcoded.
 *
 * The connections/import view contract is preserved (§2 redirect + iOS deep
 * links): view="import" opens the QuickBooks Pull→Review→Apply workspace,
 * reached from the body's adaptive "Reconcile & import" action.
 *
 * Gated on accounting.manage_connections at the Books route level.
 */

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import {
  useAccountingConnections,
  useInitiateOAuth,
  useDisconnectProvider,
  useUpdateSyncEnabled,
  useUpdateSyncMode,
  useTriggerSync,
  useSyncHistory,
} from "@/lib/hooks/use-accounting";
import { AccountingProvider } from "@/lib/types/pipeline";
import type { AccountingConnection } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { TableShell, TableWorkbar } from "@/components/ui/table-shell";
import { QuickBooksImportTab } from "@/components/accounting/qbo/quickbooks-import-tab";
import { ConnectionBadge } from "../sync/connection-badge";
import { ConnectPanel } from "../sync/connect-panel";
import { SyncStatusPanel, type SyncPrimaryAction } from "../sync/sync-status-panel";
import { ConnectAccountingModal } from "../sync/connect-accounting-modal";
import { ConnectionSettingsModal } from "../sync/connection-settings-modal";

export type SyncView = "connections" | "import";

export function SyncSegment({
  metrics,
  segmentControl,
  view,
  onViewChange,
}: {
  /** The shared LedgerStrip node, pinned in this segment's TableShell metrics slot. */
  metrics: React.ReactNode;
  segmentControl: React.ReactNode;
  view: SyncView;
  onViewChange: (view: SyncView) => void;
}) {
  const { t } = useDictionary("books");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data: connections = [] } = useAccountingConnections();
  const { data: syncHistory = [], isLoading: historyLoading } = useSyncHistory();

  const initiateOAuth = useInitiateOAuth();
  const disconnectProvider = useDisconnectProvider();
  const updateSyncEnabled = useUpdateSyncEnabled();
  const updateSyncMode = useUpdateSyncMode();
  const triggerSync = useTriggerSync();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The operative connection — one provider, once. Prefer a live link; fall
  // back to the first row so an offline (expired) connection still surfaces.
  const active: AccountingConnection | undefined =
    connections.find((c) => c.isConnected) ?? connections[0];
  const isConnected = active?.isConnected ?? false;

  const providerShort = (p: AccountingProvider) => t(`sync.provider.${p}`);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleConnect = (provider: AccountingProvider) => {
    if (!companyId) return;
    initiateOAuth.mutate({ companyId, provider }); // redirects to provider OAuth
  };

  const handleReconnect = () => {
    if (!companyId || !active) return;
    initiateOAuth.mutate({ companyId, provider: active.provider });
  };

  const handleDisconnect = () => {
    if (!companyId || !active) return;
    const providerName = providerShort(active.provider);
    disconnectProvider.mutate(
      {
        companyId,
        provider: active.provider,
        providerEnvironment: active.providerEnvironment,
      },
      {
        onSuccess: () => {
          toast.success(t("sync.toast.disconnected", { provider: providerName }));
          setSettingsOpen(false);
        },
        onError: () => toast.error(t("sync.toast.error")),
      },
    );
  };

  const handleSwitch = () => {
    if (!companyId || !active) return;
    disconnectProvider.mutate(
      {
        companyId,
        provider: active.provider,
        providerEnvironment: active.providerEnvironment,
      },
      {
        onSuccess: () => {
          setSettingsOpen(false);
          setPickerOpen(true);
        },
        onError: () => toast.error(t("sync.toast.error")),
      },
    );
  };

  const handleToggleAutoSync = (enabled: boolean) => {
    if (!companyId || !active) return;
    updateSyncEnabled.mutate(
      { companyId, provider: active.provider, syncEnabled: enabled },
      {
        onSuccess: () => toast.success(t("sync.toast.autoSyncUpdated")),
        onError: () => toast.error(t("sync.toast.error")),
      },
    );
  };

  const handleSetMode = (
    syncDirection: "pull_only" | "bidirectional",
    propagateDeletes: boolean,
  ) => {
    if (!companyId || !active) return;
    updateSyncMode.mutate(
      { companyId, provider: active.provider, syncDirection, propagateDeletes },
      {
        onSuccess: () => toast.success(t("sync.toast.modeUpdated")),
        onError: () => toast.error(t("sync.toast.error")),
      },
    );
  };

  const handleSyncNow = () => {
    if (!companyId || !active) return;
    triggerSync.mutate(
      { companyId, provider: active.provider },
      { onError: (e: Error) => toast.error(e.message || t("sync.toast.error")) },
    );
  };

  // ── Body adaptive action (mode-aware, honest about what works today) ──────
  const primaryAction: SyncPrimaryAction | undefined = (() => {
    if (!active) return undefined;
    const isPullOnly = active.syncDirection === "pull_only";
    // Read-only QuickBooks → the working Pull→Review→Apply flow.
    if (isPullOnly && active.provider === AccountingProvider.QuickBooks) {
      return {
        kind: "reconcile",
        label: t("sync.status.reconcile"),
        onClick: () => onViewChange("import"),
      };
    }
    // Two-way → push+pull (works once server writes are enabled).
    if (!isPullOnly) {
      return {
        kind: "sync",
        label: triggerSync.isPending ? t("sync.status.syncing") : t("sync.status.syncNow"),
        onClick: handleSyncNow,
        loading: triggerSync.isPending,
      };
    }
    return undefined;
  })();

  // ── Chrome: the single ambient signal ─────────────────────────────────────
  const badge = active ? (
    <ConnectionBadge
      providerName={providerShort(active.provider)}
      statusLabel={isConnected ? t("sync.badge.live") : t("sync.badge.offline")}
      tone={isConnected ? "live" : "offline"}
      onClick={() => setSettingsOpen(true)}
    />
  ) : null;

  // ── Body ──────────────────────────────────────────────────────────────────
  const showImport =
    isConnected && view === "import" && active?.provider === AccountingProvider.QuickBooks;

  let body: React.ReactNode;
  if (!active) {
    body = (
      <ConnectPanel
        variant="connect"
        onConnect={() => setPickerOpen(true)}
        connecting={initiateOAuth.isPending}
      />
    );
  } else if (!isConnected) {
    body = (
      <ConnectPanel
        variant="reconnect"
        providerName={providerShort(active.provider)}
        onConnect={handleReconnect}
        connecting={initiateOAuth.isPending}
      />
    );
  } else if (showImport) {
    body = (
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onViewChange("connections")}
          className="-ml-1 gap-1.5"
        >
          <ArrowLeft className="h-[14px] w-[14px]" />
          {t("sync.import.back")}
        </Button>
        <QuickBooksImportTab />
      </div>
    );
  } else {
    body = (
      <SyncStatusPanel
        connection={active}
        syncHistory={syncHistory}
        historyLoading={historyLoading}
        primaryAction={primaryAction}
      />
    );
  }

  return (
    <>
      <TableShell
        metrics={metrics}
        toolbar={
          <TableWorkbar>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {segmentControl}
              {badge}
            </div>
          </TableWorkbar>
        }
        bottomFade={false}
      >
        {/* The connection/import body is a document-flow block — it scrolls inside
            the shell body under the pinned metrics + workbar. */}
        <div className="space-y-2 p-3">{body}</div>
      </TableShell>

      {/* Portaled overlays — own z-layer, rendered alongside the shell. */}
      <ConnectAccountingModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConnect={handleConnect}
        connecting={initiateOAuth.isPending}
      />

      {active && (
        <ConnectionSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          connection={active}
          providerName={providerShort(active.provider)}
          writesEnabled={updateSyncMode.data?.writesEnabled}
          onToggleAutoSync={handleToggleAutoSync}
          onSetMode={handleSetMode}
          onDisconnect={handleDisconnect}
          onSwitch={handleSwitch}
          pending={{
            disconnect: disconnectProvider.isPending,
            mode: updateSyncMode.isPending,
            autoSync: updateSyncEnabled.isPending,
          }}
        />
      )}
    </>
  );
}
