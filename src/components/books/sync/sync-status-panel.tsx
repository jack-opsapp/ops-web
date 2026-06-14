"use client";

/**
 * SyncStatusPanel — the connected, healthy SYNC body (WEB OVERHAUL P3-4).
 *
 * "What would Apple do": invisible when it works. No stats grid, no console —
 * a calm mission-control readout (SYS :: SYNCED · time) + a quiet recent-sync
 * log for reassurance (Time-Machine, not dashboard). Connection management
 * lives behind the badge; this is just "it's handled."
 *
 * The primary action ADAPTS to the live sync mode:
 *   - read-only (pull) connection → "Reconcile & import" (the working
 *     Pull→Review→Apply flow; the only mechanism that syncs while writes
 *     are gated) — QuickBooks only, since that import workspace exists.
 *   - two-way connection → "Sync now" (push+pull via triggerSync).
 * No action is shown when neither applies (e.g. a read-only Sage link with no
 * import workspace) — honest over a dead button.
 */

import { ArrowRight, CheckCircle2, AlertCircle, Clock, RefreshCw, Loader2 } from "lucide-react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { Button } from "@/components/ui/button";
import type { AccountingConnection } from "@/lib/types/pipeline";

export interface SyncPrimaryAction {
  kind: "reconcile" | "sync";
  label: string;
  onClick: () => void;
  loading?: boolean;
}

interface SyncHistoryEntry {
  id: string;
  provider: string;
  status: string;
  timestamp: Date;
  details: string | null;
}

function HistoryRow({ entry }: { entry: SyncHistoryEntry }) {
  const { locale } = useLocale();
  const { t } = useDictionary("accounting");

  const dot =
    entry.status === "success" ? (
      <CheckCircle2 className="h-[12px] w-[12px] text-olive" />
    ) : entry.status === "error" ? (
      <AlertCircle className="h-[12px] w-[12px] text-rose" />
    ) : (
      <Clock className="h-[12px] w-[12px] text-tan" />
    );

  return (
    <div className="flex items-center gap-1.5 rounded px-1 py-[6px] hover:bg-surface-hover-subtle">
      {dot}
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
    </div>
  );
}

export function SyncStatusPanel({
  connection,
  syncHistory,
  historyLoading = false,
  primaryAction,
}: {
  connection: AccountingConnection;
  syncHistory: SyncHistoryEntry[];
  historyLoading?: boolean;
  primaryAction?: SyncPrimaryAction;
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();

  const recent = syncHistory.slice(0, 5);

  // The connection's last_sync_at can lag (or stay null) even after successful
  // runs, so fall back to the most recent history entry — honest "SYNCED · time"
  // over an understated "LINKED" when syncs have demonstrably happened.
  const lastSyncAt = connection.lastSyncAt ?? recent[0]?.timestamp ?? null;
  const lastSync = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString(getDateLocale(locale), {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="glass-surface space-y-3 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] border border-olive-line bg-olive-soft text-olive">
            <CheckCircle2 className="h-[15px] w-[15px]" />
          </span>
          <div>
            <div className="font-mono text-micro uppercase tracking-[0.16em] text-olive">
              {"SYS :: "}
              {lastSync ? t("sync.status.synced") : t("sync.status.linked")}
              {lastSync && (
                <>
                  {" · "}
                  <span className="tabular-nums">{lastSync}</span>
                </>
              )}
            </div>
            <div className="mt-[3px] font-mohave text-body-sm text-text-3">
              {t("sync.status.matched")}
            </div>
          </div>
        </div>

        {primaryAction && (
          <Button
            variant="ghost"
            size="sm"
            onClick={primaryAction.onClick}
            disabled={primaryAction.loading}
            className="shrink-0 gap-1.5"
          >
            {primaryAction.loading ? (
              <Loader2 className="h-[14px] w-[14px] animate-spin motion-reduce:animate-none" />
            ) : primaryAction.kind === "sync" ? (
              <RefreshCw className="h-[14px] w-[14px]" />
            ) : null}
            {primaryAction.label}
            {primaryAction.kind === "reconcile" && !primaryAction.loading && (
              <ArrowRight className="h-[13px] w-[13px]" />
            )}
          </Button>
        )}
      </div>

      <div className="border-t border-border pt-2.5">
        <p className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("sync.status.recent")}
        </p>
        {historyLoading && recent.length === 0 ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-[16px] w-[16px] animate-spin motion-reduce:animate-none text-text-3" />
          </div>
        ) : recent.length === 0 ? (
          <p className="py-3 font-mono text-micro text-text-mute">—</p>
        ) : (
          <div className="mt-1 space-y-[2px]">
            {recent.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
