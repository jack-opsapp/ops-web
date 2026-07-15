"use client";

/**
 * Bulk action confirm — APPROVE ALL / PAY ALL across the active bucket.
 *
 * Shows exactly what will move, per crew member, before anything runs.
 * Flagged batches never bulk-approve — they stay behind for individual
 * review and the modal says so. Execution is sequential in the parent
 * (per-batch RPCs); this surface renders the summary + live progress.
 */

import { Loader2 } from "lucide-react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PersonGroup } from "@/lib/utils/expense-buckets";
import { SubmitterAvatar } from "./batch-list";

export type BulkActionKind = "approve" | "pay";

export function BulkActionModal({
  kind,
  open,
  groups,
  total,
  batchCount,
  skippedFlagged,
  progress,
  onConfirm,
  onClose,
}: {
  kind: BulkActionKind;
  open: boolean;
  /** Eligible batches, grouped per person (flagged already excluded for approve). */
  groups: PersonGroup[];
  total: number;
  batchCount: number;
  /** Flagged batches excluded from an approve run (0 for pay). */
  skippedFlagged: number;
  /** Non-null while the run is executing. */
  progress: { done: number; total: number } | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const running = progress != null;

  const fmtMoney = (value: number) =>
    new Intl.NumberFormat(numLocale, { style: "currency", currency: "USD" }).format(value);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !running && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-cakemono text-heading font-light uppercase text-text">
            {t(kind === "approve" ? "expenses.bulk.approveTitle" : "expenses.bulk.payTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* Per-person summary */}
        <div className="max-h-[300px] space-y-0 overflow-y-auto">
          {groups.map((group) => (
            <div
              key={group.userId}
              className="flex items-center gap-2 border-b border-line py-2 last:border-b-0"
            >
              <SubmitterAvatar user={group.submitter} name={group.name} size={20} />
              <span className="min-w-0 truncate font-mohave text-body-sm text-text">
                {group.name}
              </span>
              <span
                className="font-mono text-micro uppercase tracking-wider text-text-3"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {t(
                  group.batches.length === 1
                    ? "expenses.strip.batchesOne"
                    : "expenses.strip.batches",
                  { n: group.batches.length }
                )}
              </span>
              <span className="min-w-0 flex-1" />
              <span
                className="font-mono text-data-sm text-text"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {fmtMoney(group.total)}
              </span>
            </div>
          ))}
        </div>

        {/* Flagged batches stay behind */}
        {skippedFlagged > 0 && (
          <p className="font-mono text-micro tracking-wider text-tan">
            {"[ "}
            {t(
              skippedFlagged === 1
                ? "expenses.bulk.flaggedSkippedOne"
                : "expenses.bulk.flaggedSkipped",
              { n: skippedFlagged }
            )}
            {" ]"}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded border border-line px-4 py-2 font-cakemono text-button-sm font-light uppercase text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-40"
          >
            {t("expenses.bulk.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={running || batchCount === 0}
            className="flex items-center gap-1.5 rounded border border-ops-accent px-4 py-2 font-cakemono text-button-sm font-light uppercase text-ops-accent transition-colors duration-150 ease-smooth hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50"
          >
            {running && (
              <Loader2 className="h-[12px] w-[12px] animate-spin motion-reduce:animate-none" />
            )}
            {running
              ? t("expenses.bulk.progress", { done: progress.done, n: progress.total })
              : t(kind === "approve" ? "expenses.bulk.approveConfirm" : "expenses.bulk.payConfirm", {
                  n: batchCount,
                  total: fmtMoney(total),
                })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
