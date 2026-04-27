"use client";

/**
 * ArchiveConfirmModal — shown when archiving a thread that's linked to a
 * pipeline opportunity AND either (a) the opportunity has other open threads
 * (sibling threads), or (b) this is the user's first opp-linked archive on
 * this connection (lead preference still 'ask').
 *
 * The modal lets the user pick which other threads to also archive, and
 * whether to archive the linked lead itself. All checkboxes default to
 * checked. When the lead preference is 'ask' and there are no siblings, the
 * user's checkbox choice is persisted as the connection-level preference so
 * they're not asked again on the next opp-linked archive.
 */

import { useCallback, useMemo, useState } from "react";
import { Check, Briefcase, Mail, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import type { ArchiveLeadPreference } from "@/lib/types/email-thread";
import type {
  ArchiveLinkedOpportunity,
  ArchiveSiblingThread,
} from "@/lib/hooks/use-inbox-threads";

export interface ArchiveConfirmContext {
  /** The thread the user explicitly clicked Archive on. Always archived. */
  currentThread: {
    id: string;
    subject: string;
    latestSenderName: string | null;
    latestSenderEmail: string | null;
  };
  /** The opportunity linked to the current thread. */
  linkedOpportunity: ArchiveLinkedOpportunity;
  /** Other open threads on the same opportunity, freshest first. */
  siblingThreads: ArchiveSiblingThread[];
  /** Connection-level lead-archive preference at the moment archive was clicked. */
  leadPreference: ArchiveLeadPreference;
  /** Connection id — needed when persisting the lead preference. */
  connectionId: string;
}

export interface ArchiveConfirmSubmitArgs {
  /** Thread ids to archive. Always includes currentThread.id. */
  threadIds: string[];
  /** Opportunity id to archive, or null to leave the opp open. */
  archiveOpportunityId: string | null;
  /** Lead preference to persist on the connection. Null = don't persist. */
  saveLeadPreference: ArchiveLeadPreference | null;
}

interface ArchiveConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ArchiveConfirmContext | null;
  onConfirm: (args: ArchiveConfirmSubmitArgs) => Promise<void> | void;
  onCancel?: () => void;
}

function formatRelative(iso: string): string {
  const now = new Date();
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return then.toLocaleDateString(undefined, { weekday: "short" });
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function senderLabel(name: string | null, email: string | null): string {
  if (name && name.trim()) return name.trim();
  if (email && email.trim()) return email.trim();
  return "Unknown sender";
}

export function ArchiveConfirmModal({
  open,
  onOpenChange,
  context,
  onConfirm,
  onCancel,
}: ArchiveConfirmModalProps) {
  // Default state per spec: every sibling checked, lead checked unless the
  // user has previously saved 'leave' (in which case respect their default).
  const initialSelectedSiblings = useMemo<Set<string>>(() => {
    if (!context) return new Set();
    return new Set(context.siblingThreads.map((s) => s.id));
  }, [context]);

  const initialArchiveLead = context ? context.leadPreference !== "leave" : true;

  const [selectedSiblings, setSelectedSiblings] = useState<Set<string>>(
    initialSelectedSiblings
  );
  const [archiveLead, setArchiveLead] = useState<boolean>(initialArchiveLead);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal state whenever a new context loads.
  const lastContextId = context
    ? `${context.currentThread.id}|${context.linkedOpportunity.id}`
    : null;
  const [seenContextId, setSeenContextId] = useState<string | null>(null);
  if (open && lastContextId && lastContextId !== seenContextId) {
    setSelectedSiblings(initialSelectedSiblings);
    setArchiveLead(initialArchiveLead);
    setSubmitting(false);
    setError(null);
    setSeenContextId(lastContextId);
  }

  const close = useCallback(
    (next: boolean) => {
      if (submitting) return;
      onOpenChange(next);
      if (!next) {
        onCancel?.();
        // Allow next open with same context to re-init.
        setSeenContextId(null);
      }
    },
    [onOpenChange, onCancel, submitting]
  );

  const toggleSibling = useCallback((id: string) => {
    setSelectedSiblings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const totalCount = 1 + selectedSiblings.size + (archiveLead ? 1 : 0);

  const submit = useCallback(async () => {
    if (!context) return;
    setSubmitting(true);
    setError(null);
    try {
      const threadIds = [
        context.currentThread.id,
        ...context.siblingThreads
          .map((s) => s.id)
          .filter((id) => selectedSiblings.has(id)),
      ];
      const archiveOpportunityId = archiveLead ? context.linkedOpportunity.id : null;

      // Persist preference only when the user is being asked for the first
      // time AND there are no siblings (siblings make the choice contextual,
      // not generalizable).
      const saveLeadPreference: ArchiveLeadPreference | null =
        context.leadPreference === "ask" && context.siblingThreads.length === 0
          ? archiveLead
            ? "archive"
            : "leave"
          : null;

      await onConfirm({ threadIds, archiveOpportunityId, saveLeadPreference });
      setSubmitting(false);
      onOpenChange(false);
      setSeenContextId(null);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Could not archive.");
    }
  }, [context, selectedSiblings, archiveLead, onConfirm, onOpenChange]);

  if (!context) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-[560px] p-0">
          <DialogTitle className="sr-only">Archive</DialogTitle>
          <DialogDescription className="sr-only">Loading</DialogDescription>
        </DialogContent>
      </Dialog>
    );
  }

  const { currentThread, linkedOpportunity, siblingThreads } = context;
  const hasSiblings = siblingThreads.length > 0;
  const headerLabel = hasSiblings ? "// ARCHIVE" : "// FIRST OPP-LINKED ARCHIVE";
  const headerTitle = hasSiblings ? "What else should we archive?" : "Archive the lead too?";
  const headerDescription = hasSiblings
    ? `This thread is part of a lead with ${siblingThreads.length} other open ${siblingThreads.length === 1 ? "thread" : "threads"}. Pick what to clean up.`
    : "OPS noticed this thread is tied to a pipeline lead. Want the lead archived alongside the thread? We'll remember your answer.";
  const buttonLabel = `Archive (${totalCount})`;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[560px] p-0 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b border-border-subtle">
          <p className="font-mono text-[10px] uppercase tracking-[0.20em] text-text-mute">
            {headerLabel}
          </p>
          <DialogTitle className="font-cakemono font-light uppercase text-[20px] tracking-[0.10em] text-text mt-1">
            {headerTitle}
          </DialogTitle>
          <DialogDescription className="font-mohave text-[13px] text-text-2 mt-1">
            {headerDescription}
          </DialogDescription>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Locked current-thread row — communicates "this is what triggered the prompt" */}
          <div className="px-3 pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute mb-1.5 px-1">
              {"// THIS THREAD"}
            </p>
            <div
              className={cn(
                "flex items-start gap-2.5 w-full p-3 rounded-[6px]",
                "border border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.05)]"
              )}
            >
              <div
                className={cn(
                  "w-[28px] h-[28px] rounded-[5px] flex items-center justify-center shrink-0",
                  "border border-[rgba(255,255,255,0.20)] bg-[rgba(255,255,255,0.08)]"
                )}
              >
                <Lock className="w-[12px] h-[12px] text-text-2" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mohave text-[13px] text-text truncate">
                  {currentThread.subject || "(no subject)"}
                </p>
                <p className="font-mono text-[11px] text-text-mute truncate mt-0.5">
                  {senderLabel(currentThread.latestSenderName, currentThread.latestSenderEmail)}
                </p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute shrink-0 mt-1">
                Always
              </span>
            </div>
          </div>

          {/* Sibling threads — only rendered when present */}
          {hasSiblings && (
            <div className="px-3 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute mb-1.5 px-1">
                {"// OTHER THREADS ON THIS LEAD"}
              </p>
              <div className="space-y-1.5">
                {siblingThreads.map((sib) => {
                  const checked = selectedSiblings.has(sib.id);
                  return (
                    <button
                      key={sib.id}
                      type="button"
                      onClick={() => toggleSibling(sib.id)}
                      className={cn(
                        "flex items-start gap-2.5 w-full p-3 rounded-[6px] text-left",
                        "border transition-colors duration-150",
                        checked
                          ? "border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.06)]"
                          : "border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]"
                      )}
                    >
                      <div
                        className={cn(
                          "w-[28px] h-[28px] rounded-[5px] flex items-center justify-center shrink-0",
                          "border",
                          checked
                            ? "border-ops-accent bg-ops-accent"
                            : "border-border-subtle bg-[rgba(255,255,255,0.04)]"
                        )}
                      >
                        {checked ? (
                          <Check className="w-[14px] h-[14px] text-black" strokeWidth={2.5} />
                        ) : (
                          <Mail className="w-[12px] h-[12px] text-text-2" strokeWidth={1.75} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "font-mohave text-[13px] truncate",
                            checked ? "text-text" : "text-text-2"
                          )}
                        >
                          {sib.subject}
                        </p>
                        <p className="font-mono text-[11px] text-text-mute truncate mt-0.5">
                          {senderLabel(sib.latestSenderName, sib.latestSenderEmail)}
                          {sib.latestSnippet ? ` · ${sib.latestSnippet}` : ""}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] tabular-nums uppercase tracking-[0.14em] text-text-mute shrink-0 mt-1">
                        {formatRelative(sib.lastMessageAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lead checkbox — distinct visual treatment to call out it's a different entity */}
          <div className="px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute mb-1.5 px-1">
              {"// PIPELINE LEAD"}
            </p>
            <button
              type="button"
              onClick={() => setArchiveLead((v) => !v)}
              className={cn(
                "flex items-start gap-2.5 w-full p-3 rounded-[6px] text-left",
                "border transition-colors duration-150",
                archiveLead
                  ? "border-ops-accent/50 bg-ops-accent/[0.06]"
                  : "border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]"
              )}
            >
              <div
                className={cn(
                  "w-[28px] h-[28px] rounded-[5px] flex items-center justify-center shrink-0",
                  "border",
                  archiveLead
                    ? "border-ops-accent bg-ops-accent"
                    : "border-border-subtle bg-[rgba(255,255,255,0.04)]"
                )}
              >
                {archiveLead ? (
                  <Check className="w-[14px] h-[14px] text-black" strokeWidth={2.5} />
                ) : (
                  <Briefcase className="w-[12px] h-[12px] text-text-2" strokeWidth={1.75} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "font-cakemono font-light uppercase text-[12px] tracking-[0.14em]",
                    archiveLead ? "text-text" : "text-text-2"
                  )}
                >
                  Archive lead
                </p>
                <p className="font-mohave text-[13px] text-text mt-0.5 truncate">
                  {linkedOpportunity.title}
                </p>
                <p className="font-mono text-[11px] text-text-mute mt-0.5">
                  {archiveLead
                    ? "[lead will be removed from active pipeline]"
                    : "[lead stays open in pipeline]"}
                </p>
              </div>
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 pb-2 border-t border-border-subtle pt-2">
            <p className="font-mono text-[11px] text-rose">{error}</p>
          </div>
        )}

        <div className="flex justify-between items-center gap-1.5 px-4 py-3 border-t border-border-subtle">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
            {totalCount === 1
              ? "[1 item to archive]"
              : `[${totalCount} items to archive]`}
          </p>
          <div className="flex gap-1.5">
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
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className={cn(
                "px-3 py-1.5 rounded-[5px]",
                "bg-ops-accent text-black",
                "font-cakemono font-light uppercase text-[11px] tracking-[0.14em]",
                "hover:bg-ops-accent/90 transition-colors duration-150",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {submitting ? "Archiving…" : buttonLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
