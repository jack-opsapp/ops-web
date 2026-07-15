import Link from "next/link";

import type { SpecRefundQueueRow } from "@/lib/admin/spec-types";
import { formatCents, formatTier } from "../../_components/format";

interface ProcessedRefundRowProps {
  refund: SpecRefundQueueRow;
}

/**
 * Compact row in the "Recently processed / denied" history rail. Clicking
 * the row deep-links to the in-line detail view (`/admin/spec/refunds/[id]`).
 */
export function ProcessedRefundRow({ refund }: ProcessedRefundRowProps) {
  const customerLabel = refund.customerName?.trim() || refund.customerEmail;
  const tone = toneFor(refund.status);
  return (
    <Link
      href={`/admin/spec/refunds/${refund.id}`}
      className="group flex items-center justify-between border-b border-white/[0.04] px-4 py-3 transition-colors duration-150 ease-smooth hover:bg-white/[0.03]"
    >
      <div className="flex items-center gap-4">
        <span
          className={`rounded-chip border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}
        >
          {refund.status.toUpperCase()}
        </span>
        <span className="font-cakemono text-[13px] font-light uppercase tracking-[0.04em] text-text">
          {customerLabel}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-3">
          <span className="text-text-mute">[</span>
          {formatTier(refund.projectTier)}
          {refund.isGuaranteeInvocation && " · GUARANTEE"}
          {refund.isGoodwill && " · GOODWILL"}
          {refund.isTest && " · TEST"}
          <span className="text-text-mute">]</span>
        </span>
      </div>
      <div className="flex items-center gap-4">
        {refund.totalRefundCents != null && (
          <span className="font-mono text-[13px] tabular-nums text-text">
            {formatCents(refund.totalRefundCents)}
          </span>
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute group-hover:text-text">
          DETAIL →
        </span>
      </div>
    </Link>
  );
}

function toneFor(status: string): string {
  switch (status) {
    case "processed":
      return "border-olive/40 bg-olive/8 text-olive";
    case "partial":
      return "border-tan/40 bg-tan/12 text-tan";
    case "denied":
      return "border-rose/40 bg-rose/8 text-rose";
    case "failed":
      return "border-brick/40 bg-brick/12 text-rose";
    default:
      return "border-white/[0.10] text-text-2";
  }
}
