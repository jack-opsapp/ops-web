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

// ─── Component ───────────────────────────────────────────────────────────────

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
        // Layout
        "w-full text-left px-3 py-2 flex flex-col gap-1.5",
        // Surface
        "bg-background-card border rounded",
        // Transition
        "transition-colors duration-150",
        // States
        isSelected
          ? "border-[#597794] bg-[rgba(89,119,148,0.06)]"
          : "border-border hover:border-[rgba(255,255,255,0.30)] cursor-pointer"
      )}
    >
      {/* Row 1 — Avatar + Name */}
      <div className="flex items-center gap-1.5">
        {/* Avatar */}
        <div className="relative h-[32px] w-[32px] shrink-0 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
          {hasProfileImage ? (
            <Image
              src={batch.submitter!.profileImageUrl!}
              alt={displayName}
              fill
              className="object-cover"
              sizes="32px"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-mohave text-caption-sm text-text-secondary select-none">
              {getInitials(batch)}
            </span>
          )}
        </div>

        <span className="font-mohave text-body text-text-primary truncate">
          {displayName}
        </span>
      </div>

      {/* Row 2 — Invoice number */}
      <span className="font-kosugi text-caption-sm text-text-tertiary uppercase">
        {batch.batchNumber}
      </span>

      {/* Row 3 — Total amount */}
      <span className="font-mohave text-body-lg text-text-primary">
        {formatCurrency(batch.totalAmount ?? 0)}
      </span>

      {/* Row 4 — Status pill + amendment indicator */}
      <div className="flex items-center gap-1">
        {/* Status pill */}
        <span
          className="inline-flex items-center rounded-full px-1.5 py-[2px] font-kosugi text-micro-sm uppercase tracking-wider"
          style={{
            backgroundColor: `${statusColor}26`,
            color: statusColor,
          }}
        >
          {statusLabel}
        </span>

        {/* Amendment indicator */}
        {hasAmendment && (
          <span className="inline-flex items-center rounded-full px-1.5 py-[2px] font-kosugi text-micro-sm uppercase tracking-wider bg-ops-amber-muted text-ops-amber">
            +A{batch.amendmentNumber}
          </span>
        )}
      </div>
    </button>
  );
}
