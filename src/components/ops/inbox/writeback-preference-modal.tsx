"use client";

/**
 * WritebackPreferenceModal — shown on the first archive action per email
 * connection. Asks the user once: when I archive a thread in OPS, what
 * should happen in Gmail / Outlook?
 *
 * The choice is persisted on `email_connections.archive_writeback_preference`
 * via useThreadActions().setWritebackPreference. After the user confirms,
 * we re-run the pending archive action with the preference already set.
 */

import { useCallback, useState } from "react";
import { ArchiveRestore, Eye, ServerOff, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useThreadActions } from "@/lib/hooks/use-inbox-threads";
import type { ArchiveWritebackPreference } from "@/lib/types/email-thread";

interface WritebackPreferenceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  /** Called after preference is saved — resume the archive action. */
  onConfirmed: (preference: ArchiveWritebackPreference) => void;
  /** Called if the user cancels. The pending archive action should be dropped. */
  onCancel?: () => void;
}

interface PreferenceOption {
  id: Exclude<ArchiveWritebackPreference, "ask">;
  icon: typeof ArchiveRestore;
  /** Dictionary key (e.g. "writeback.archive") + fallback English string. */
  labelKey: string;
  labelDefault: string;
  detailKey: string;
  detailDefault: string;
  captionKey: string;
  captionDefault: string;
}

const OPTIONS: readonly PreferenceOption[] = [
  {
    id: "archive_in_gmail",
    icon: ArchiveRestore,
    labelKey: "writeback.archive",
    labelDefault: "Archive in Gmail / Outlook",
    detailKey: "writeback.archive.detail",
    detailDefault: "Cleanest. Thread leaves your provider inbox too.",
    captionKey: "writeback.archive.caption",
    captionDefault: "Recommended",
  },
  {
    id: "mark_read_only",
    icon: Eye,
    labelKey: "writeback.markRead",
    labelDefault: "Just mark as read",
    detailKey: "writeback.markRead.detail",
    detailDefault:
      "Keeps the thread in your Gmail / Outlook inbox, but silences it there.",
    captionKey: "writeback.markRead.caption",
    captionDefault: "Safer for starters",
  },
  {
    id: "ops_only",
    icon: ServerOff,
    labelKey: "writeback.opsOnly",
    labelDefault: "Only inside OPS",
    detailKey: "writeback.opsOnly.detail",
    detailDefault:
      "Leaves Gmail / Outlook untouched. Archive is local to OPS.",
    captionKey: "writeback.opsOnly.caption",
    captionDefault: "Maximum control",
  },
] as const;

export function WritebackPreferenceModal({
  open,
  onOpenChange,
  connectionId,
  onConfirmed,
  onCancel,
}: WritebackPreferenceModalProps) {
  const { t } = useDictionary("inbox");
  const [selected, setSelected] =
    useState<Exclude<ArchiveWritebackPreference, "ask">>("archive_in_gmail");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setWritebackPreference } = useThreadActions();

  const close = useCallback(
    (next: boolean) => {
      if (submitting) return;
      onOpenChange(next);
      if (!next) onCancel?.();
    },
    [onOpenChange, onCancel, submitting]
  );

  const confirm = useCallback(async () => {
    if (!connectionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await setWritebackPreference.mutateAsync({
        connectionId,
        preference: selected,
      });
      setSubmitting(false);
      onOpenChange(false);
      onConfirmed(selected);
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof Error
          ? err.message
          : t("writeback.error", "Could not save preference."),
      );
    }
  }, [connectionId, selected, setWritebackPreference, onOpenChange, onConfirmed, t]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[520px] p-0">
        <div className="px-4 pt-4 pb-3 border-b border-line">
          <p className="font-mono text-[11px] uppercase tracking-[0.20em] text-text-mute">
            {"// "}
            {t("writeback.prefix", "First archive")}
          </p>
          <DialogTitle className="font-cakemono font-light uppercase text-[20px] tracking-[0.10em] text-text mt-1">
            {t("writeback.title", "What should archive do?")}
          </DialogTitle>
          <DialogDescription className="font-mohave text-[13px] text-text-2 mt-1">
            {t(
              "writeback.description",
              "OPS can keep your Gmail or Outlook inbox in sync when you archive in here. Pick once — you can change it later in Settings.",
            )}
          </DialogDescription>
        </div>

        <div className="p-3 space-y-1.5">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = opt.id === selected;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt.id)}
                className={cn(
                  "flex items-start gap-2.5 w-full p-3 rounded-sidebar text-left",
                  "border transition-colors duration-150",
                  isActive
                    ? "border-line-hi bg-inbox-elev/60"
                    : "border-line bg-inbox-bg-deep hover:bg-inbox-elev/40",
                )}
              >
                <div
                  className={cn(
                    "w-[28px] h-[28px] rounded-[2.5px] flex items-center justify-center shrink-0",
                    "border",
                    isActive
                      ? "border-line-hi bg-inbox-elev/80"
                      : "border-line bg-inbox-elev/40",
                  )}
                >
                  <Icon
                    className={cn(
                      "w-[14px] h-[14px]",
                      isActive ? "text-text" : "text-text-2",
                    )}
                    strokeWidth={1.5}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p
                      className={cn(
                        "font-cakemono font-light uppercase text-[12px] tracking-[0.14em]",
                        isActive ? "text-text" : "text-text-2",
                      )}
                    >
                      {t(opt.labelKey, opt.labelDefault)}
                    </p>
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute">
                      {t(opt.captionKey, opt.captionDefault)}
                    </span>
                  </div>
                  <p className="font-mohave text-[12px] text-text-3 mt-0.5 leading-snug">
                    {t(opt.detailKey, opt.detailDefault)}
                  </p>
                </div>
                {isActive && (
                  <Check
                    className="w-[14px] h-[14px] text-text shrink-0 mt-1"
                    strokeWidth={1.5}
                  />
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="px-4 pb-2">
            <p className="font-mono text-[11px] text-rose">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-1.5 px-4 pb-4 pt-1 border-t border-line">
          <button
            type="button"
            onClick={() => close(false)}
            disabled={submitting}
            className={cn(
              "px-3 py-1.5 rounded-[2.5px] border border-line",
              "font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text-2",
              "hover:bg-inbox-elev/40 transition-colors duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {t("writeback.notNow", "Not now")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting || !connectionId}
            className={cn(
              "px-3 py-1.5 rounded-[2.5px]",
              "bg-ops-accent text-black",
              "font-cakemono font-light uppercase text-[11px] tracking-[0.14em]",
              "hover:bg-ops-accent/90 transition-colors duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {submitting
              ? t("writeback.saving", "Saving…")
              : t("writeback.confirm", "Save & archive")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
