"use client";

/**
 * ConnectionSettingsModal — the connection's config + danger, behind the badge
 * (WEB OVERHAUL P3-4). Pure settings: status, auto-sync, sync mode, mirror
 * deletes, disconnect, switch. No "Sync now" button here — it errors on
 * read-only connections, so the body's adaptive action owns it; no recent log
 * here either (it lives on the body, no duplication).
 *
 * Built full-CRUD: SYNC MODE (read-only ↔ two-way) + MIRROR DELETES drive the
 * existing updateSyncMode(syncDirection, propagateDeletes). Honest today: while
 * server writes are gated (writesEnabled === false), a two-way choice is
 * recorded and a paused note is shown — read-only is never baked in.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SegmentControl } from "@/components/ui/segment-control";
import { Tag } from "@/components/ui/tag";
import type { AccountingConnection } from "@/lib/types/pipeline";

type SyncModeValue = "read" | "two";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-2.5 first:border-t-0">
      <span className="font-mono text-micro uppercase tracking-[0.14em] text-text-3">{label}</span>
      {children}
    </div>
  );
}

export function ConnectionSettingsModal({
  open,
  onClose,
  connection,
  providerName,
  writesEnabled,
  onToggleAutoSync,
  onSetMode,
  onDisconnect,
  onSwitch,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  connection: AccountingConnection;
  providerName: string;
  /** From the last updateSyncMode result; undefined until known. */
  writesEnabled?: boolean;
  onToggleAutoSync: (enabled: boolean) => void;
  onSetMode: (direction: "pull_only" | "bidirectional", propagateDeletes: boolean) => void;
  onDisconnect: () => void;
  onSwitch: () => void;
  pending: { disconnect?: boolean; mode?: boolean; autoSync?: boolean };
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();

  // Optimistic local mirrors — reconcile when the connection refetches.
  const [autoSync, setAutoSync] = useState(connection.syncEnabled);
  const [mode, setMode] = useState<SyncModeValue>(
    connection.syncDirection === "pull_only" ? "read" : "two",
  );
  const [mirrorDeletes, setMirrorDeletes] = useState(connection.propagateDeletes);
  const [confirm, setConfirm] = useState<null | "disconnect" | "switch">(null);

  useEffect(() => {
    setAutoSync(connection.syncEnabled);
    setMode(connection.syncDirection === "pull_only" ? "read" : "two");
    setMirrorDeletes(connection.propagateDeletes);
  }, [connection.syncEnabled, connection.syncDirection, connection.propagateDeletes]);

  // Reset any in-flight confirm when the modal closes.
  useEffect(() => {
    if (!open) setConfirm(null);
  }, [open]);

  const lastSync = connection.lastSyncAt
    ? new Date(connection.lastSyncAt).toLocaleDateString(getDateLocale(locale), {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : t("sync.settings.never");

  const handleAutoSync = (next: boolean) => {
    setAutoSync(next);
    onToggleAutoSync(next);
  };

  const handleMode = (next: SyncModeValue) => {
    setMode(next);
    if (next === "read") {
      setMirrorDeletes(false);
      onSetMode("pull_only", false);
    } else {
      onSetMode("bidirectional", mirrorDeletes);
    }
  };

  const handleMirror = (next: boolean) => {
    setMirrorDeletes(next);
    onSetMode("bidirectional", next);
  };

  const isTwoWay = mode === "two";
  const showTestingNote = isTwoWay && writesEnabled !== true;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <DialogTitle className="font-cakemono text-[18px] font-light uppercase text-text">
              {providerName}
            </DialogTitle>
            <Tag variant={connection.isConnected ? "olive" : "tan"}>
              {connection.isConnected ? t("sync.badge.live") : t("sync.badge.offline")}
            </Tag>
            {connection.providerEnvironment === "sandbox" && (
              <Tag variant="neutral">{t("sync.settings.environmentSandbox")}</Tag>
            )}
          </div>
        </DialogHeader>

        <div className="mt-1">
          <Row label={t("sync.settings.lastSync")}>
            <span className="font-mono text-data-sm tabular-nums text-text-2">{lastSync}</span>
          </Row>

          <Row label={t("sync.settings.autoSync")}>
            <Switch
              checked={autoSync}
              onCheckedChange={handleAutoSync}
              disabled={pending.autoSync}
              aria-label={t("sync.settings.autoSync")}
            />
          </Row>

          <Row label={t("sync.settings.mode")}>
            <SegmentControl<SyncModeValue>
              options={[
                { value: "read", label: t("sync.settings.modeReadOnly") },
                { value: "two", label: t("sync.settings.modeTwoWay") },
              ]}
              value={mode}
              onChange={handleMode}
              disabled={pending.mode}
            />
          </Row>

          {isTwoWay && (
            <Row label={t("sync.settings.mirrorDeletes")}>
              <Switch
                checked={mirrorDeletes}
                onCheckedChange={handleMirror}
                disabled={pending.mode}
                aria-label={t("sync.settings.mirrorDeletes")}
              />
            </Row>
          )}

          {showTestingNote && (
            <p className="border-t border-border pt-2.5 font-mono text-caption-sm leading-relaxed text-tan">
              [ {t("sync.settings.testingNote")} ]
            </p>
          )}
        </div>

        {/* Danger / actions */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
          {confirm === null ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirm("switch")}>
                {t("sync.settings.switch")}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirm("disconnect")}>
                {t("sync.settings.disconnect")}
              </Button>
            </>
          ) : (
            <div className="flex w-full flex-col gap-2">
              <p className="font-mono text-caption-sm leading-relaxed text-text-2">
                {confirm === "disconnect"
                  ? t("sync.settings.disconnectConfirm", { provider: providerName })
                  : t("sync.settings.switchConfirm", { provider: providerName })}
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  {t("sync.settings.cancel")}
                </Button>
                <Button
                  variant={confirm === "disconnect" ? "destructive" : "primary"}
                  size="sm"
                  disabled={pending.disconnect}
                  onClick={() => {
                    if (confirm === "disconnect") onDisconnect();
                    else onSwitch();
                  }}
                  className="gap-1.5"
                >
                  {pending.disconnect && (
                    <Loader2 className="h-[14px] w-[14px] animate-spin motion-reduce:animate-none" />
                  )}
                  {confirm === "disconnect"
                    ? t("sync.settings.disconnectConfirmCta")
                    : t("sync.settings.switchConfirmCta")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
