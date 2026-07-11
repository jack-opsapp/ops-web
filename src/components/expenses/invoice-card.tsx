"use client";

import Image from "next/image";
import { cn } from "@/lib/utils/cn";
import {
  type ExpenseBatch,
  BATCH_STATUS_DISPLAY,
  BATCH_STATUS_COLOR,
  getBatchDisplayName,
} from "@/lib/types/expense-approval";

// ─── Props ───────────────────────────────────────────────────────────────────

interface InvoiceCardProps {
  batch: ExpenseBatch;
  isSelected: boolean;
  onClick: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function getInitials(batch: ExpenseBatch): string {
  const user = batch.submitter;
  if (!user) return "??";
  const first = user.firstName?.trim()?.[0] ?? "";
  const last = user.lastName?.trim()?.[0] ?? "";
  if (first || last) return `${first}${last}`.toUpperCase();
  if (user.email) return user.email[0].toUpperCase();
  return "??";
}

/** Numbers keep tabular + slashed-zero so amounts don't jitter as they change. */
const NUM_FEAT = { fontFeatureSettings: '"tnum" 1, "zero" 1' } as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Dense two-row expense row-card (target ≤56px):
 *
 *   [avatar]  NAME                          $1,234.56
 *             INV-0042 · STATUS · +A1
 *
 * Flat register row (no per-card glass/pill chrome) with a hairline base and an
 * accent left-rail for the selected master-detail row. Amounts are mono; the
 * status reads as plain colored text (the label already carries the meaning).
 */
export function InvoiceCard({ batch, isSelected, onClick }: InvoiceCardProps) {
  const displayName = getBatchDisplayName(batch);
  const statusLabel = BATCH_STATUS_DISPLAY[batch.status];
  const statusColor = BATCH_STATUS_COLOR[batch.status];
  const hasProfileImage = !!batch.submitter?.profileImageUrl;
  const hasAmendment = !!batch.parentBatchId;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left flex flex-col gap-0.5 px-3 py-1.5",
        "border-l-2 border-b border-b-line transition-colors duration-150",
        isSelected
          ? "border-l-ops-accent bg-ops-accent/[0.06]"
          : "border-l-transparent hover:bg-[rgba(255,255,255,0.03)] cursor-pointer"
      )}
    >
      {/* Row 1 — avatar · name · amount */}
      <div className="flex items-center gap-1.5">
        <div className="relative h-[20px] w-[20px] shrink-0 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
          {hasProfileImage ? (
            <Image
              src={batch.submitter!.profileImageUrl!}
              alt={displayName}
              fill
              className="object-cover"
              sizes="20px"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-mohave text-micro-sm text-text-2 select-none">
              {getInitials(batch)}
            </span>
          )}
        </div>

        <span className="font-mohave text-body-sm text-text truncate">
          {displayName}
        </span>

        <span
          className="ml-auto shrink-0 font-mono text-data text-text tabular-nums"
          style={NUM_FEAT}
        >
          {formatCurrency(batch.totalAmount ?? 0)}
        </span>
      </div>

      {/* Row 2 — number · status · amendment (indented under the name) */}
      <div className="pl-[26px] truncate font-mono text-micro uppercase tracking-wider text-text-3">
        <span>{batch.batchNumber}</span>
        <span className="text-text-mute"> · </span>
        <span style={{ color: statusColor }}>{statusLabel}</span>
        {hasAmendment && (
          <>
            <span className="text-text-mute"> · </span>
            <span className="text-tan">+A{batch.amendmentNumber}</span>
          </>
        )}
      </div>
    </button>
  );
}
