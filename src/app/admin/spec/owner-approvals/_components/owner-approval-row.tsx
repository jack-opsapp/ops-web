"use client";

import { useActionState, useState } from "react";

import type { SpecOwnerApprovalQueueRow } from "@/lib/admin/spec-types";
import { resendApprovalEmailAction } from "../_actions/resend-approval-email";
import { cancelApprovalRequestAction } from "../_actions/cancel-request";
import { formatCents, formatTier } from "../../_components/format";

interface OwnerApprovalRowProps {
  approval: SpecOwnerApprovalQueueRow;
}

const RESEND_INITIAL = { ok: false } as const;
const CANCEL_INITIAL = { ok: false } as const;

export function OwnerApprovalRow({ approval }: OwnerApprovalRowProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [resendState, resendAction, resendPending] = useActionState(
    resendApprovalEmailAction,
    RESEND_INITIAL,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelApprovalRequestAction,
    CANCEL_INITIAL,
  );

  return (
    <article className="grid grid-cols-1 gap-4 border-b border-white/[0.06] px-6 py-5 last:border-b-0 md:grid-cols-[1fr_auto] md:items-start">
      <div className="space-y-3">
        <header className="flex items-baseline gap-3">
          <h3 className="font-cakemono text-[14px] font-light uppercase tracking-[0.04em] text-[#EDEDED]">
            <span className="mr-2 font-mono text-[#6A6A6A]">{"//"}</span>
            {approval.companyName ?? "—"}
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8A8A8A]">
            <span className="text-[#3A3A3A]">[</span>
            {formatTier(approval.tier)} · {approval.ageLabel} OLD
            {approval.isTest && " · TEST"}
            <span className="text-[#3A3A3A]">]</span>
          </span>
        </header>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          <Field
            label="BUYER"
            primary={approval.buyerName ?? approval.buyerEmail ?? "—"}
            secondary={approval.buyerName ? approval.buyerEmail : null}
          />
          <Field
            label="ACCOUNT HOLDER"
            primary={
              approval.accountHolderName ?? approval.accountHolderEmail ?? "—"
            }
            secondary={
              approval.accountHolderName ? approval.accountHolderEmail : null
            }
          />
          <Field
            label="TOTAL"
            primary={formatCents(approval.approvedTotalCents)}
            secondary={`DEPOSIT ${formatCents(approval.approvedDepositCents)}`}
            mono
          />
          <Field
            label="REQUESTED AT"
            primary={approval.requestedAt}
            secondary={null}
            mono
          />
        </dl>
      </div>

      <div className="flex flex-col items-end gap-2">
        <form action={resendAction}>
          <input
            type="hidden"
            name="approvalRequestId"
            value={approval.id}
          />
          <button
            type="submit"
            disabled={resendPending || cancelPending}
            className={`inline-flex items-center gap-2 rounded border border-[#6F94B0] px-4 py-[6px] font-mono text-[11px] uppercase tracking-[0.12em] text-[#6F94B0] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#6F94B0] hover:text-black ${resendPending ? "opacity-50" : ""}`}
          >
            {resendPending ? "SENDING…" : "RESEND EMAIL"}
          </button>
        </form>

        {!confirmingCancel ? (
          <button
            type="button"
            onClick={() => setConfirmingCancel(true)}
            disabled={resendPending || cancelPending}
            className="inline-flex items-center gap-2 rounded border border-white/[0.10] px-4 py-[6px] font-mono text-[11px] uppercase tracking-[0.12em] text-[#8A8A8A] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-[#B58289] hover:text-[#B58289]"
          >
            CANCEL REQUEST
          </button>
        ) : (
          <form
            action={cancelAction}
            className="flex flex-col items-end gap-2"
          >
            <input
              type="hidden"
              name="approvalRequestId"
              value={approval.id}
            />
            <p className="text-right font-mono text-[10px] uppercase tracking-[0.12em] text-[#B58289]">
              <span className="text-[#3A3A3A]">[</span>
              CANCELS PARENT PROJECT
              <span className="text-[#3A3A3A]">]</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                disabled={cancelPending}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6A6A6A] hover:text-[#EDEDED]"
              >
                BACK
              </button>
              <button
                type="submit"
                disabled={cancelPending}
                className={`inline-flex items-center gap-2 rounded border border-[#B58289] px-4 py-[6px] font-mono text-[11px] uppercase tracking-[0.12em] text-[#B58289] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#B58289] hover:text-black ${cancelPending ? "opacity-50" : ""}`}
              >
                {cancelPending ? "CANCELLING…" : "CONFIRM CANCEL"}
              </button>
            </div>
          </form>
        )}

        {(resendState?.error || cancelState?.error) && (
          <span className="text-right font-mono text-[10px] uppercase tracking-[0.12em] text-[#B58289]">
            <span className="text-[#3A3A3A]">[</span>
            ERR · {resendState?.error ?? cancelState?.error}
            <span className="text-[#3A3A3A]">]</span>
          </span>
        )}
        {(resendState?.ok || cancelState?.ok) && (
          <span className="text-right font-mono text-[10px] uppercase tracking-[0.12em] text-[#9DB582]">
            <span className="text-[#3A3A3A]">[</span>
            {cancelState?.ok ? "CANCELLED" : "EMAIL QUEUED"} · refresh to confirm
            <span className="text-[#3A3A3A]">]</span>
          </span>
        )}
      </div>
    </article>
  );
}

function Field({
  label,
  primary,
  secondary,
  mono,
}: {
  label: string;
  primary: string;
  secondary: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6A6A6A]">
        <span className="text-[#3A3A3A]">{"//"}</span> {label}
      </dt>
      <dd
        className={`mt-1 ${mono ? "font-mono tabular-nums" : "font-cakemono uppercase tracking-[0.04em]"} text-[12px] text-[#EDEDED]`}
      >
        {primary}
      </dd>
      {secondary && (
        <dd className="mt-[2px] font-mono text-[10px] tracking-[0.06em] text-[#8A8A8A]">
          {secondary}
        </dd>
      )}
    </div>
  );
}
