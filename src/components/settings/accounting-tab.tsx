"use client";

/**
 * AccountingTab — SETTINGS › FINANCIAL › Accounting (WEB OVERHAUL P3-6).
 *
 * Design-judgment fix (CLAUDE.md canonical failure): a company picks ONE
 * accounting provider, once. The old surface rendered QuickBooks AND Sage
 * connect cards side-by-side permanently (the data model rendered into UI).
 * Correct: a SINGLE connect entry point → brief provider choice → a compact
 * live badge once connected → sync settings / disconnect / switch behind the
 * badge (a modal). Sync history + issues sit below, only when they have content.
 */

import { useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Link2,
  Unlink,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { SegmentControl, type SegmentControlOption } from "@/components/ui/segment-control";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAccountingConnections,
  useInitiateOAuth,
  useDisconnectProvider,
  useUpdateSyncEnabled,
  useUpdateSyncMode,
  useTriggerSync,
  useSyncHistory,
  useAccountingSyncIssues,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { AccountingProvider } from "@/lib/types/pipeline";

const PROVIDER_LABEL: Record<AccountingProvider, string> = {
  [AccountingProvider.QuickBooks]: "QuickBooks",
  [AccountingProvider.Sage]: "Sage",
};

/** A `// TITLE` section header — the canonical settings/register grammar. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, "olive" | "tan" | "rose"> = {
  success: "olive",
  partial: "tan",
  error: "rose",
};

// ── Connect entry point (no provider connected) ─────────────────────────────

function ConnectPanel() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const initiateOAuth = useInitiateOAuth();
  const [provider, setProvider] = useState<AccountingProvider>(AccountingProvider.QuickBooks);

  const providerOptions: SegmentControlOption<AccountingProvider>[] = [
    { value: AccountingProvider.QuickBooks, label: PROVIDER_LABEL[AccountingProvider.QuickBooks] },
    { value: AccountingProvider.Sage, label: PROVIDER_LABEL[AccountingProvider.Sage] },
  ];

  return (
    <div className="glass-surface rounded-panel p-3">
      <SectionTitle>{t("accounting.title")}</SectionTitle>
      <p className="mt-2 font-mohave text-body-sm text-text-2">{t("accounting.connectIntro")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SegmentControl options={providerOptions} value={provider} onChange={setProvider} />
        <Button
          variant="primary"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            if (!can("accounting.manage_connections")) return;
            initiateOAuth.mutate({ companyId, provider });
          }}
          disabled={initiateOAuth.isPending}
        >
          {initiateOAuth.isPending ? (
            <Loader2 className="h-[14px] w-[14px] animate-spin" />
          ) : (
            <Link2 className="h-[14px] w-[14px]" />
          )}
          {t("accounting.connect")}
        </Button>
      </div>
    </div>
  );
}

// ── Live badge + settings modal (a provider is connected) ───────────────────

interface AccountingConnection {
  provider: AccountingProvider;
  isConnected: boolean;
  lastSyncAt: Date | string | null;
  syncEnabled: boolean;
  syncDirection: "pull_only" | "push_only" | "bidirectional";
  propagateDeletes: boolean;
  providerEnvironment?: "production" | "sandbox";
}

function ConnectedAccounting({ connection }: { connection: AccountingConnection }) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const provider = connection.provider;
  const disconnect = useDisconnectProvider();
  const updateSyncEnabled = useUpdateSyncEnabled();
  const updateSyncMode = useUpdateSyncMode();
  const triggerSync = useTriggerSync();
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmFullCrud, setConfirmFullCrud] = useState(false);

  const isFullCrud = connection.syncDirection === "bidirectional";
  const propagateDeletes = connection.propagateDeletes;

  function setMode(syncDirection: "pull_only" | "bidirectional", deletes: boolean) {
    if (!can("accounting.manage_connections")) return;
    updateSyncMode.mutate(
      { companyId, provider, syncDirection, propagateDeletes: deletes },
      {
        onSuccess: () => toast.success(t("accounting.toast.syncModeUpdated")),
        onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
      },
    );
  }

  const modeOptions: SegmentControlOption<"pull_only" | "bidirectional">[] = [
    { value: "pull_only", label: t("accounting.modeReadOnly") },
    { value: "bidirectional", label: t("accounting.modeFullCrud") },
  ];

  return (
    <div className="glass-surface rounded-panel p-3">
      <SectionTitle>{t("accounting.title")}</SectionTitle>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mohave text-body text-text">{PROVIDER_LABEL[provider]}</span>
        <Tag variant="olive">{t("integrations.connected")}</Tag>
        {connection.lastSyncAt && (
          <span className="flex items-center gap-1 font-mono text-micro text-text-3">
            <Clock className="h-[12px] w-[12px]" />
            {t("integrations.lastSynced")} {new Date(connection.lastSyncAt).toLocaleString()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (!can("accounting.manage_connections")) return;
              triggerSync.mutate(
                { companyId, provider },
                {
                  onSuccess: () => toast.success(t("accounting.toast.syncTriggered")),
                  onError: (err) => toast.error(t("accounting.toast.syncFailed"), { description: err.message }),
                },
              );
            }}
            disabled={triggerSync.isPending}
          >
            <RefreshCw className={cn("h-[14px] w-[14px]", triggerSync.isPending && "animate-spin")} />
            {t("integrations.syncNow")}
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setManageOpen(true)}>
            <Settings2 className="h-[14px] w-[14px]" />
            {t("accounting.manage")}
          </Button>
        </div>
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("accounting.settingsTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Sync enabled */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mohave text-body text-text">{t("accounting.syncEnabled")}</p>
                <p className="font-mono text-micro text-text-mute">{t("accounting.syncEnabledDesc")}</p>
              </div>
              <Switch
                checked={connection.syncEnabled}
                disabled={updateSyncEnabled.isPending || !can("accounting.manage_connections")}
                onCheckedChange={(value) => {
                  if (!can("accounting.manage_connections")) return;
                  updateSyncEnabled.mutate(
                    { companyId, provider, syncEnabled: value },
                    {
                      onSuccess: () =>
                        toast.success(t(value ? "accounting.toast.syncEnabled" : "accounting.toast.syncDisabled")),
                      onError: (err) => toast.error(t("preferences.toast.updateFailed"), { description: err.message }),
                    },
                  );
                }}
              />
            </div>

            {/* Sync mode */}
            <div className="space-y-1.5 border-t border-border pt-3">
              <p className="font-mohave text-body text-text">{t("accounting.syncMode")}</p>
              <p className="font-mono text-micro text-text-mute">{t("accounting.syncModeDesc")}</p>
              <SegmentControl
                options={modeOptions}
                value={isFullCrud ? "bidirectional" : "pull_only"}
                onChange={(mode) => {
                  if (mode === "bidirectional") {
                    if (!isFullCrud) setConfirmFullCrud(true);
                  } else {
                    setConfirmFullCrud(false);
                    if (isFullCrud) setMode("pull_only", false);
                  }
                }}
              />

              {confirmFullCrud && !isFullCrud && (
                <div className="space-y-2 rounded-panel border border-tan-line bg-tan-soft p-2.5">
                  <div className="flex items-start gap-1.5">
                    <ShieldAlert className="mt-0.5 h-[14px] w-[14px] shrink-0 text-tan" />
                    <p className="font-mono text-micro leading-snug text-text-2">{t("accounting.fullCrudWarning")}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => {
                        setConfirmFullCrud(false);
                        // Full CRUD means full CRUD: deletes/voids mirror to
                        // QuickBooks by default. The operator opts out via the
                        // Propagate deletes switch, not by hunting for it first.
                        setMode("bidirectional", true);
                      }}
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
                <div className="flex items-center justify-between gap-3 pt-1">
                  <div>
                    <p className="font-mohave text-body-sm text-text">{t("accounting.propagateDeletes")}</p>
                    <p className="font-mono text-micro text-text-mute">{t("accounting.propagateDeletesDesc")}</p>
                  </div>
                  <Switch
                    checked={propagateDeletes}
                    disabled={updateSyncMode.isPending}
                    onCheckedChange={(value) => setMode("bidirectional", value)}
                  />
                </div>
              )}
            </div>

            {/* Disconnect / switch */}
            <div className="border-t border-border pt-3">
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  if (!can("accounting.manage_connections")) return;
                  disconnect.mutate(
                    { companyId, provider, providerEnvironment: connection.providerEnvironment },
                    {
                      onSuccess: () => {
                        toast.success(t("accounting.toast.disconnected"));
                        setManageOpen(false);
                      },
                      onError: (err) => toast.error(t("accounting.toast.disconnectFailed"), { description: err.message }),
                    },
                  );
                }}
                disabled={disconnect.isPending}
              >
                <Unlink className="h-[14px] w-[14px]" />
                {t("accounting.disconnect")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sync history + issues ────────────────────────────────────────────────────

function SyncIssues() {
  const { t } = useDictionary("settings");
  const { data: issues, isLoading } = useAccountingSyncIssues();
  if (!isLoading && (!issues || issues.length === 0)) return null;

  return (
    <section aria-label={t("accounting.syncIssuesTitle")}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <AlertTriangle className="h-[14px] w-[14px] text-rose" />
        <SectionTitle>{t("accounting.syncIssuesTitle")}</SectionTitle>
      </div>
      <div className="glass-surface rounded-panel p-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-[18px] w-[18px] animate-spin text-text-2 motion-reduce:animate-none" />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-mono text-micro text-text-mute">{t("accounting.syncIssuesDesc")}</p>
            <div className="space-y-1.5">
              {(issues ?? []).map((issue) => {
                const recordRef = issue.externalId ? `QB ${issue.externalId}` : issue.entityId.slice(0, 8);
                return (
                  <div key={issue.id} className="rounded border border-border-subtle p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag variant="rose">
                        {issue.status === "blocked" ? t("accounting.issueBlocked") : t("accounting.issueNeedsReview")}
                      </Tag>
                      <span className="font-mono text-micro text-text-3">
                        {issue.entityType.toUpperCase()} · {issue.operation.toUpperCase()} · {recordRef}
                      </span>
                      <span className="ml-auto font-mono text-micro text-text-mute">
                        {issue.updatedAt.toLocaleString()}
                      </span>
                    </div>
                    {issue.lastError && (
                      <p className="mt-1 font-mono text-micro leading-snug text-text-2">{issue.lastError}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SyncHistory() {
  const { t } = useDictionary("settings");
  const { data: history, isLoading } = useSyncHistory();

  return (
    <section aria-label={t("accounting.syncHistory")}>
      <div className="mb-1.5">
        <SectionTitle>{t("accounting.syncHistory")}</SectionTitle>
      </div>
      <div className="glass-surface rounded-panel p-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-[18px] w-[18px] animate-spin text-text-2 motion-reduce:animate-none" />
          </div>
        ) : !history || history.length === 0 ? (
          <p className="font-mono text-micro text-text-mute">{t("accounting.noSyncHistory")}</p>
        ) : (
          <div className="max-h-[300px] space-y-1.5 overflow-y-auto scrollbar-hide">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 border-b border-border-subtle py-1.5 last:border-0">
                <span className="mt-0.5 shrink-0">
                  <Tag variant={STATUS_TONE[entry.status] ?? "neutral"}>{entry.status}</Tag>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mohave text-body-sm capitalize text-text">{entry.provider}</span>
                    <span className="font-mono text-micro text-text-mute">{new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                  {entry.details && <p className="truncate font-mono text-micro text-text-3">{entry.details}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function AccountingTab() {
  const { data: connections, isLoading } = useAccountingConnections();

  const connected = useMemo(
    () => connections?.find((c) => c.isConnected) ?? null,
    [connections],
  );

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="glass-surface flex items-center justify-center rounded-panel py-8">
          <Loader2 className="h-[20px] w-[20px] animate-spin text-text-2 motion-reduce:animate-none" />
        </div>
      ) : connected ? (
        <ConnectedAccounting connection={connected as AccountingConnection} />
      ) : (
        <ConnectPanel />
      )}
      <SyncIssues />
      <SyncHistory />
    </div>
  );
}
