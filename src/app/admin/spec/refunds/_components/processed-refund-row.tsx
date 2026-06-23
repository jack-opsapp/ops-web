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
      className="group flex items-center justify-between border-b border-white/[0.04] px-4 py-3 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-white/[0.03]"
    >
      <div className="flex items-center gap-4">
        <span
          className={`rounded-chip border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}
        >
          {refund.status.toUpperCase()}
        </span>
        <span className="font-cakemono text-[13px] font-light uppercase tracking-[0.04em] text-[#EDEDED]">
          {customerLabel}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">
          <span className="text-[#3A3A3A]">[</span>
          {formatTier(refund.projectTier)}
          {refund.isGuaranteeInvocation && " · GUARANTEE"}
          {refund.isGoodwill && " · GOODWILL"}
          {refund.isTest && " · TEST"}
          <span className="text-[#3A3A3A]">]</span>
        </span>
      </div>
      <div className="flex items-center gap-4">
        {refund.totalRefundCents != null && (
          <span className="font-mono text-[13px] tabular-nums text-[#EDEDED]">
            {formatCents(refund.totalRefundCents)}
          </span>
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A] group-hover:text-[#EDEDED]">
          DETAIL →
        </span>
      </div>
    </Link>
  );
}

function toneFor(status: string): string {
  switch (status) {
    case "processed":
      return "border-[#9DB582]/40 bg-[#9DB582]/8 text-[#9DB582]";
    case "partial":
      return "border-[#C4A868]/40 bg-[#C4A868]/12 text-[#C4A868]";
    case "denied":
      return "border-[#B58289]/40 bg-[#B58289]/8 text-[#B58289]";
    case "failed":
      return "border-[#93321A]/40 bg-[#93321A]/12 text-[#B58289]";
    default:
      return "border-white/[0.10] text-[#B5B5B5]";
  }
}
