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
  label: string;
  detail: string;
  caption: string;
}

const OPTIONS: readonly PreferenceOption[] = [
  {
    id: "archive_in_gmail",
    icon: ArchiveRestore,
    label: "Archive in Gmail / Outlook",
    detail: "Cleanest. Thread leaves your provider inbox too.",
    caption: "Recommended",
  },
  {
    id: "mark_read_only",
    icon: Eye,
    label: "Just mark as read",
    detail: "Keeps the thread in your Gmail / Outlook inbox, but silences it there.",
    caption: "Safer for starters",
  },
  {
    id: "ops_only",
    icon: ServerOff,
    label: "Only inside OPS",
    detail: "Leaves Gmail / Outlook untouched. Archive is local to OPS.",
    caption: "Maximum control",
  },
] as const;

export function WritebackPreferenceModal({
  open,
  onOpenChange,
  connectionId,
  onConfirmed,
  onCancel,
}: WritebackPreferenceModalProps) {
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
      setError(err instanceof Error ? err.message : "Could not save preference.");
    }
  }, [connectionId, selected, setWritebackPreference, onOpenChange, onConfirmed]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[520px] p-0">
        <div className="px-4 pt-4 pb-3 border-b border-border-subtle">
          <p className="font-mono text-[10px] uppercase tracking-[0.20em] text-text-mute">
            {"// First archive"}
          </p>
          <DialogTitle className="font-cakemono font-light uppercase text-[20px] tracking-[0.10em] text-text mt-1">
            What should archive do?
          </DialogTitle>
          <DialogDescription className="font-mohave text-[13px] text-text-2 mt-1">
            OPS can keep your Gmail or Outlook inbox in sync when you archive in here. Pick once — you can change it later in Settings.
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
                  "flex items-start gap-2.5 w-full p-3 rounded-[6px] text-left",
                  "border transition-colors duration-150",
                  isActive
                    ? "border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.06)]"
                    : "border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]"
                )}
              >
                <div
                  className={cn(
                    "w-[28px] h-[28px] rounded-[5px] flex items-center justify-center shrink-0",
                    "border",
                    isActive
                      ? "border-[rgba(255,255,255,0.20)] bg-[rgba(255,255,255,0.08)]"
                      : "border-border-subtle bg-[rgba(255,255,255,0.04)]"
                  )}
                >
                  <Icon
                    className={cn("w-[14px] h-[14px]", isActive ? "text-text" : "text-text-2")}
                    strokeWidth={1.75}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p
                      className={cn(
                        "font-cakemono font-light uppercase text-[12px] tracking-[0.14em]",
                        isActive ? "text-text" : "text-text-2"
                      )}
                    >
                      {opt.label}
                    </p>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute">
                      {opt.caption}
                    </span>
                  </div>
                  <p className="font-mohave text-[12px] text-text-3 mt-0.5 leading-snug">
                    {opt.detail}
                  </p>
                </div>
                {isActive && (
                  <Check className="w-[14px] h-[14px] text-text shrink-0 mt-1" strokeWidth={2} />
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

        <div className="flex justify-end gap-1.5 px-4 pb-4 pt-1 border-t border-border-subtle">
          <button
            type="button"
            onClick={() => close(false)}
            disabled={submitting}
            className={cn(
              "px-3 py-1.5 rounded-[5px] border border-border-subtle",
              "font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text-2",
              "hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            Not now
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting || !connectionId}
            className={cn(
              "px-3 py-1.5 rounded-[5px]",
              "bg-ops-accent text-black",
              "font-cakemono font-light uppercase text-[11px] tracking-[0.14em]",
              "hover:bg-ops-accent/90 transition-colors duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {submitting ? "Saving…" : "Save & archive"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
