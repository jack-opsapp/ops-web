"use client";

import Link from "next/link";
import { useMemo, useState, useActionState } from "react";

import type {
  SpecPaymentMilestone,
  SpecRefundQueueRow,
} from "@/lib/admin/spec-types";
import { REFUND_MILESTONE_ORDER } from "@/lib/spec/refund-breakdown";
import { processRefundAction } from "../_actions/process-refund";
import { denyRefundAction } from "../_actions/deny-refund";
import { RefundBreakdownPreview } from "./refund-breakdown-preview";
import { formatTier } from "../../_components/format";

interface RefundRowCardProps {
  refund: SpecRefundQueueRow;
}

const PROCESS_INITIAL = { ok: false } as const;
const DENY_INITIAL = { ok: false } as const;

export function RefundRowCard({ refund }: RefundRowCardProps) {
  // Default selection — for guarantee invocations, pre-check all four milestones.
  // For non-guarantee, pre-check ALL milestones that have a Stripe action available.
  const defaultSelection = useMemo<SpecPaymentMilestone[]>(() => {
    if (refund.isGuaranteeInvocation) return [...REFUND_MILESTONE_ORDER];
    return refund.payments
      .filter((p) =>
        ["paid", "invoiced", "overdue", "partially_refunded"].includes(p.status),
      )
      .map((p) => p.milestone);
  }, [refund]);

  const [selectedMilestones, setSelectedMilestones] =
    useState<SpecPaymentMilestone[]>(defaultSelection);

  const [denialOpen, setDenialOpen] = useState(false);
  const [setGoodwill, setGoodwillState] = useState(refund.isGoodwill);

  const [processState, processFormAction, processPending] = useActionState(
    processRefundAction,
    PROCESS_INITIAL,
  );
  const [denyState, denyFormAction, denyPending] = useActionState(
    denyRefundAction,
    DENY_INITIAL,
  );

  function toggleMilestone(milestone: SpecPaymentMilestone) {
    setSelectedMilestones((prev) =>
      prev.includes(milestone)
        ? prev.filter((m) => m !== milestone)
        : [...prev, milestone],
    );
  }

  return (
    <article className="glass-surface p-6">
      <header className="mb-4 flex items-start justify-between gap-6">
        <div>
          <h3 className="font-cakemono text-[15px] font-light uppercase leading-none tracking-[0.04em] text-text">
            <span className="mr-2 font-mono text-text-mute">{"//"}</span>
            {refund.customerName?.trim() || refund.customerEmail}
          </h3>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
            <span className="text-text-mute">[</span>
            {formatTier(refund.projectTier)} · {refund.projectStatus.replace(/_/g, " ").toUpperCase()} · REQUESTED {refund.requestedAgeLabel} AGO
            <span className="text-text-mute">]</span>
          </p>
          {refund.customerEmail && refund.customerName && (
            <p className="mt-1 font-mono text-[10px] tracking-[0.10em] text-text-mute">
              {refund.customerEmail}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {refund.isGuaranteeInvocation && (
            <span className="rounded-[4px] border border-olive/40 bg-olive/12 px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-olive">
              30-DAY GUARANTEE
            </span>
          )}
          {refund.requestSource === "stripe_dispute" && (
            <span className="rounded-[4px] border border-rose/40 bg-rose/12 px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-rose">
              STRIPE DISPUTE
            </span>
          )}
          {refund.isTest && (
            <span className="rounded-[4px] border border-tan/40 bg-tan/12 px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-tan">
              TEST
            </span>
          )}
        </div>
      </header>

      {/* Customer reason */}
      {refund.customerReasonText && (
        <section className="mb-4 border-l border-white/[0.06] pl-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
            <span className="text-text-mute">{"//"}</span> CUSTOMER REASON
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-text-2">
            {refund.customerReasonText}
          </p>
        </section>
      )}

      {/* Eligibility chips */}
      <EligibilityChips refund={refund} />

      {/* Milestone selection */}
      <fieldset className="mb-4 mt-4">
        <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
          <span className="text-text-mute">{"//"}</span> MILESTONES TO ACT ON
        </legend>
        <div className="flex flex-wrap gap-2">
          {REFUND_MILESTONE_ORDER.map((milestone) => {
            const payment = refund.payments.find((p) => p.milestone === milestone);
            const checked = selectedMilestones.includes(milestone);
            const hasAction = payment
              ? ["paid", "invoiced", "overdue", "partially_refunded"].includes(payment.status)
              : false;
            return (
              <label
                key={milestone}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-[4px] border px-3 py-[5px] font-mono text-[11px] uppercase tracking-[0.12em] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  checked
                    ? "border-white/[0.20] bg-white/[0.06] text-text"
                    : hasAction
                      ? "border-white/[0.10] bg-transparent text-text-2 hover:border-white/[0.20]"
                      : "cursor-not-allowed border-white/[0.05] bg-transparent text-text-mute"
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={checked}
                  disabled={!hasAction}
                  onChange={() => toggleMilestone(milestone)}
                />
                <span aria-hidden="true">{checked ? "■" : "□"}</span>
                {milestoneLabel(milestone)}
              </label>
            );
          })}
        </div>
      </fieldset>

      <RefundBreakdownPreview
        payments={refund.payments}
        selectedMilestones={selectedMilestones}
      />

      {/* Process form */}
      <form action={processFormAction} className="mt-4 space-y-3">
        <input type="hidden" name="refundRequestId" value={refund.id} />
        {selectedMilestones.map((m) => (
          <input key={m} type="hidden" name="milestone" value={m} />
        ))}

        {!refund.isGuaranteeInvocation && (
          <label className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-2">
            <input
              type="checkbox"
              name="setGoodwill"
              value="1"
              checked={setGoodwill}
              onChange={(e) => setGoodwillState(e.target.checked)}
              className="h-3 w-3 rounded-[2px] border border-white/[0.15] bg-transparent accent-tan"
            />
            FLAG AS GOODWILL REFUND
          </label>
        )}

        <textarea
          name="internalNote"
          rows={2}
          maxLength={4000}
          placeholder="Internal note (operator-only) — context for the dispute trail, attribution, etc."
          className="w-full rounded-[5px] border border-white/[0.09] bg-black/40 px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-mute focus:border-[#6F94B0] focus:outline-none"
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={processPending || denyPending || selectedMilestones.length === 0}
            className={`inline-flex items-center gap-2 rounded-[5px] border border-[#6F94B0] px-4 py-[6px] font-mono text-[12px] uppercase tracking-[0.12em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-[#6F94B0] focus-visible:outline-offset-2 ${processPending || denyPending ? "opacity-50" : ""}`}
          >
            {processPending ? "PROCESSING…" : "PROCESS REFUND"}
          </button>

          <button
            type="button"
            onClick={() => setDenialOpen((v) => !v)}
            disabled={processPending || denyPending}
            className="inline-flex items-center gap-2 rounded-[5px] border border-white/[0.10] px-4 py-[6px] font-mono text-[12px] uppercase tracking-[0.12em] text-text-3 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-rose hover:text-rose"
          >
            {denialOpen ? "CLOSE DENY" : "DENY…"}
          </button>

          {processState?.ok === false && processState?.error && (
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-rose">
              <span className="text-text-mute">[</span>
              ERR · {processState.error}
              <span className="text-text-mute">]</span>
            </span>
          )}
          {processState?.ok && processState?.status && processState.status !== "noop" && (
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-olive">
              <span className="text-text-mute">[</span>
              {processState.status.toUpperCase()} · refresh to confirm
              <span className="text-text-mute">]</span>
            </span>
          )}
        </div>
      </form>

      {denialOpen && (
        <form
          action={denyFormAction}
          className="mt-3 rounded-[8px] border border-rose/30 bg-rose/[0.05] p-4"
        >
          <input type="hidden" name="refundRequestId" value={refund.id} />
          <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-rose">
            <span className="text-text-mute">{"//"}</span> DENIAL REASON (CUSTOMER-FACING)
          </label>
          <textarea
            name="denialReason"
            rows={4}
            minLength={20}
            maxLength={2000}
            required
            placeholder="Explain to the customer why this refund is being denied. The text is included verbatim in the spec.refund_denied email."
            className="mt-2 w-full rounded-[5px] border border-white/[0.09] bg-black/40 px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-mute focus:border-rose focus:outline-none"
          />
          <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
            <span className="text-text-mute">{"//"}</span> INTERNAL NOTE (OPERATOR-ONLY)
          </label>
          <textarea
            name="internalNote"
            rows={2}
            maxLength={4000}
            placeholder="Optional — operator context for the audit trail."
            className="mt-2 w-full rounded-[5px] border border-white/[0.06] bg-black/40 px-3 py-2 font-mono text-[12px] text-text-2 placeholder:text-text-mute focus:border-[#6F94B0] focus:outline-none"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={denyPending}
              className={`inline-flex items-center gap-2 rounded-[5px] border border-rose px-4 py-[6px] font-mono text-[12px] uppercase tracking-[0.12em] text-rose transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-rose hover:text-black ${denyPending ? "opacity-50" : ""}`}
            >
              {denyPending ? "DENYING…" : "CONFIRM DENY"}
            </button>
            {denyState?.ok === false && denyState?.error && (
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-rose">
                <span className="text-text-mute">[</span>
                ERR · {denyState.error}
                <span className="text-text-mute">]</span>
              </span>
            )}
            {denyState?.ok && (
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-olive">
                <span className="text-text-mute">[</span>DENIED · refresh to confirm<span className="text-text-mute">]</span>
              </span>
            )}
          </div>
        </form>
      )}

      <footer className="mt-4 border-t border-white/[0.06] pt-3">
        <Link
          href={`/admin/spec/${refund.specProjectId}`}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute hover:text-text"
        >
          <span className="text-text-mute">→</span> OPEN PROJECT WORKSPACE
        </Link>
      </footer>
    </article>
  );
}

function milestoneLabel(milestone: SpecPaymentMilestone): string {
  switch (milestone) {
    case "deposit":
      return "P1 DEPOSIT";
    case "scope_signoff":
      return "P2 SCOPE";
    case "midpoint":
      return "P3 MIDPOINT";
    case "delivery":
      return "P4 DELIVERY";
  }
}

function EligibilityChips({ refund }: { refund: SpecRefundQueueRow }) {
  const chips: Array<{ label: string; ok: boolean }> = [
    {
      label: refund.eligibility.daysSinceWalkthrough != null
        ? `WITHIN 30D (${refund.eligibility.daysSinceWalkthrough}d)`
        : "NO WALKTHROUGH",
      ok: refund.eligibility.withinGuaranteeWindow,
    },
    { label: "STRIPE DISPUTE", ok: !refund.eligibility.hasActiveDispute },
    { label: "NON-PAYMENT DISABLE", ok: !refund.eligibility.hasNonPaymentDisable },
    { label: "MATERIAL BREACH", ok: !refund.eligibility.materialBreachFlag },
    { label: "GUARANTEE ALREADY INVOKED", ok: !refund.eligibility.guaranteeAlreadyInvoked },
  ];

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`rounded-[4px] border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.14em] ${
            chip.ok
              ? "border-olive/40 bg-olive/8 text-olive"
              : "border-rose/40 bg-rose/8 text-rose"
          }`}
        >
          {chip.ok ? "✓" : "✗"} {chip.label}
        </span>
      ))}
    </div>
  );
}
