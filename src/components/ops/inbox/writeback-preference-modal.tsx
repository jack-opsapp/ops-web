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
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useThreadActions } from "@/lib/hooks/use-inbox-threads";
import { SlashLabel } from "./voice/slash-label";
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
  /** Dictionary key for the bracketed/uppercase tactical label. */
  labelKey: string;
  labelDefault: string;
  /** Dictionary key for the [—]-prefixed body line. */
  bodyKey: string;
  bodyDefault: string;
}

const OPTIONS: readonly PreferenceOption[] = [
  {
    id: "archive_in_gmail",
    labelKey: "modal.writeback.archiveInGmail",
    labelDefault: "ARCHIVE IN GMAIL/OUTLOOK",
    bodyKey: "modal.writeback.archiveInGmailBody",
    bodyDefault: "[—] mark as read AND move to archive",
  },
  {
    id: "mark_read_only",
    labelKey: "modal.writeback.markAsRead",
    labelDefault: "MARK AS READ ONLY",
    bodyKey: "modal.writeback.markAsReadBody",
    bodyDefault: "[—] mark as read, leave in inbox",
  },
  {
    id: "ops_only",
    labelKey: "modal.writeback.opsOnly",
    labelDefault: "OPS-ONLY",
    bodyKey: "modal.writeback.opsOnlyBody",
    bodyDefault: "[—] no change to your connected inbox",
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

  const writebackTitle = t(
    "modal.writeback.title",
    "// WRITEBACK PREFERENCE",
  );
  const writebackBody = t(
    "modal.writeback.body",
    "[—] when you archive, what should happen in your connected inbox?",
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[520px] p-0">
        <DialogTitle className="sr-only">
          {t("writeback.a11yTitle", "Writeback preference")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t(
            "writeback.a11yDescription",
            "Pick how archive should behave in your connected inbox.",
          )}
        </DialogDescription>
        <div className="px-4 pt-4 pb-3 border-b border-line">
          <SlashLabel label={writebackTitle} size="md" />
          <p className="font-mono text-[11px] text-text-3 mt-2 leading-relaxed">
            {writebackBody}
          </p>
        </div>

        <div className="p-3 space-y-1.5">
          {OPTIONS.map((opt) => {
            const isActive = opt.id === selected;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt.id)}
                className={cn(
                  "flex items-start gap-2.5 w-full text-left",
                  "rounded-[2.5px] border px-3.5 py-3 transition-colors duration-150",
                  isActive
                    ? "border-line-hi bg-inbox-elev/60"
                    : "border-line bg-inbox-bg-deep hover:bg-inbox-elev/40",
                )}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "font-mono text-[11px] uppercase tracking-[0.14em]",
                      isActive ? "text-text" : "text-text-2",
                    )}
                  >
                    {t(opt.labelKey, opt.labelDefault)}
                  </p>
                  <p className="font-mohave text-[12px] text-text-3 mt-1 leading-snug">
                    {t(opt.bodyKey, opt.bodyDefault)}
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

        <div className="flex justify-end gap-1.5 px-4 pt-2 pb-2 border-t border-line">
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
            {t("modal.writeback.notNow", "NOT NOW")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting || !connectionId}
            className={cn(
              "px-3 py-1.5 rounded-[2.5px]",
              "border border-ops-accent text-ops-accent",
              "font-cakemono font-light uppercase text-[11px] tracking-[0.14em]",
              "hover:bg-ops-accent hover:text-black transition-colors duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {submitting
              ? t("writeback.saving", "Saving…")
              : t("modal.writeback.saveArchive", "SAVE & ARCHIVE")}
          </button>
        </div>

        <div className="px-4 pb-4 pt-1">
          <a
            href="https://docs.opsltd.com/writeback"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "font-mohave italic text-[11px] lowercase",
              "text-text-3 hover:text-text-2 transition-colors duration-150",
            )}
          >
            {t(
              "modal.writeback.learnMore",
              "learn more about writeback →",
            )}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
