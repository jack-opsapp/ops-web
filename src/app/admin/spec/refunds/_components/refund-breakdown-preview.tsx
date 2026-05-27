"use client";

import { useMemo } from "react";

import {
  computeRefundBreakdownPreview,
  REFUND_MILESTONE_ORDER,
  type RefundActionKind,
  type RefundBreakdownPreviewLine,
  type RefundPaymentRow,
} from "@/lib/spec/refund-breakdown";
import type { SpecPaymentMilestone, SpecRefundPaymentSummary } from "@/lib/admin/spec-types";
import { formatCents } from "../../_components/format";

interface RefundBreakdownPreviewProps {
  payments: SpecRefundPaymentSummary[];
  selectedMilestones: SpecPaymentMilestone[];
}

/**
 * Data-visualization tier (per animation-studio:data-visualization): a precise,
 * scannable per-milestone action plan with monospaced cents and bracketed
 * micro-text. Visuals over numbers means each action is colour-coded by intent
 * (refund=accent, void=mute, credit_note=tan, mark_uncollectible=brick) so
 * Jackson can read the plan at a glance before he commits.
 */
export function RefundBreakdownPreview({
  payments,
  selectedMilestones,
}: RefundBreakdownPreviewProps) {
  const { lines, totals } = useMemo(() => {
    const rows: RefundPaymentRow[] = payments.map((p) => ({
      milestone: p.milestone,
      status: p.status,
      stripe_payment_intent_id: p.stripePaymentIntentId,
      stripe_invoice_id: p.stripeInvoiceId,
      total_cents: p.totalCents,
      amount_refunded_cents: p.amountRefundedCents,
    }));
    return computeRefundBreakdownPreview(
      rows,
      selectedMilestones.length > 0 ? selectedMilestones : REFUND_MILESTONE_ORDER,
    );
  }, [payments, selectedMilestones]);

  return (
    <div className="rounded-[10px] border border-white/[0.09] bg-[#121214]/[0.58] p-4 backdrop-blur-[28px]">
      <div className="mb-3 flex items-baseline justify-between">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8A8A8A]">
          <span className="text-[#3A3A3A]">{"//"}</span> REFUND-BREAKDOWN PREVIEW
        </h4>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
          <span className="text-[#3A3A3A]">[</span>
          {totals.actionableMilestoneCount} ACTION
          {totals.actionableMilestoneCount === 1 ? "" : "S"}
          <span className="text-[#3A3A3A]">]</span>
        </span>
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-white/[0.06]">
            <ColumnHeader>Milestone</ColumnHeader>
            <ColumnHeader>Current</ColumnHeader>
            <ColumnHeader>Action</ColumnHeader>
            <ColumnHeader>Stripe target</ColumnHeader>
            <ColumnHeader align="right">Amount</ColumnHeader>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <BreakdownRow key={line.milestone} line={line} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/[0.06]">
            <td colSpan={3} className="pt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8A8A8A]">
              <span className="text-[#3A3A3A]">{"//"}</span> TOTAL CASH REFUND
            </td>
            <td className="pt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#6A6A6A]">
              <span className="text-[#3A3A3A]">[</span>void/cn ${(totals.totalNonCashAdjustmentCents / 100).toFixed(0)}<span className="text-[#3A3A3A]">]</span>
            </td>
            <td className="pt-2 text-right font-mono text-[13px] tabular-nums text-[#EDEDED]">
              {formatCents(totals.totalCashRefundCents)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ColumnHeader({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`pb-2 font-mono text-[10px] font-normal uppercase tracking-[0.16em] text-[#6A6A6A] ${align === "right" ? "text-right" : "text-left"}`}
      scope="col"
    >
      {children}
    </th>
  );
}

const ACTION_TONE: Record<RefundActionKind, string> = {
  refund: "text-[#6F94B0]",
  credit_note: "text-[#C4A868]",
  void: "text-[#8A8A8A]",
  mark_uncollectible: "text-[#B58289]",
  noop: "text-[#3A3A3A]",
};

const ACTION_LABEL: Record<RefundActionKind, string> = {
  refund: "REFUND",
  credit_note: "CREDIT NOTE + REFUND",
  void: "VOID",
  mark_uncollectible: "MARK UNCOLLECTIBLE",
  noop: "—",
};

function BreakdownRow({ line }: { line: RefundBreakdownPreviewLine }) {
  return (
    <tr
      className={`border-b border-white/[0.04] last:border-b-0 ${line.isGreyed ? "opacity-50" : ""}`}
    >
      <td className="py-[10px] pr-3 align-top">
        <div className="font-cakemono text-[12px] font-light uppercase tracking-[0.06em] text-[#EDEDED]">
          {line.label}
        </div>
        {line.note && (
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.10em] text-[#6A6A6A]">
            <span className="text-[#3A3A3A]">[</span>
            {line.note}
            <span className="text-[#3A3A3A]">]</span>
          </div>
        )}
      </td>
      <td className="py-[10px] pr-3 align-top font-mono text-[11px] uppercase tracking-[0.10em] text-[#B5B5B5]">
        {line.currentStatus
          ? line.currentStatus.replace(/_/g, " ")
          : "no payment"}
      </td>
      <td className={`py-[10px] pr-3 align-top font-mono text-[11px] uppercase tracking-[0.12em] ${ACTION_TONE[line.action]}`}>
        {ACTION_LABEL[line.action]}
      </td>
      <td className="py-[10px] pr-3 align-top font-mono text-[10px] tracking-[0.04em] text-[#8A8A8A]">
        {line.stripeTargetId ? truncate(line.stripeTargetId, 22) : "—"}
      </td>
      <td className="py-[10px] text-right align-top font-mono text-[12px] tabular-nums text-[#EDEDED]">
        {line.amountCents > 0 ? formatCents(line.amountCents) : "—"}
      </td>
    </tr>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
