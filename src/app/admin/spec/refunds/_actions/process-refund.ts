"use server";

import { revalidatePath } from "next/cache";
import Stripe from "stripe";

import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { requireSpecOperatorAction } from "@/lib/admin/spec-operator-guard";
import { writeSpecEmailOutbox } from "@/lib/spec/email-outbox";
import { OPS_OPERATIONS_COMPANY_ID } from "@/lib/spec/constants";
import {
  computeRefundBreakdownPreview,
  REFUND_MILESTONE_ORDER,
  type RefundBreakdownExecutedLine,
  type RefundPaymentRow,
} from "@/lib/spec/refund-breakdown";
import type {
  SpecPaymentMilestone,
  SpecPaymentStatus,
} from "@/lib/admin/spec-types";

/**
 * Process a pending refund request.
 *
 * Walks each milestone via the Stripe Refunds / CreditNotes / Invoices APIs,
 * writes a per-line `refund_breakdown` jsonb to the request row, flips the
 * project's `spec_module_entitlements.enabled = false` with reason `refunded`,
 * stamps `spec_projects.status = 'refunded'`, and writes a `spec.refund_processed`
 * email outbox row. Customer notification is best-effort.
 *
 * Idempotency: if the request status is already `processed` / `partial` /
 * `failed`, the action returns the cached breakdown without making any Stripe
 * calls. The status check is server-side and gate-protected.
 *
 * Per-milestone, the processor:
 *   - `paid`                              → Stripe refund on Payment Intent
 *   - `invoiced` / `overdue`, open        → void; falls back to mark_uncollectible
 *   - `invoiced` / `overdue`, partially paid → credit_note (unpaid) + refund (paid)
 *   - `partially_refunded`                → refund the remaining captured amount
 *   - `pending` / already-refunded etc.   → noop (logged in breakdown as `skipped`)
 *
 * All-or-nothing across Stripe is impossible (the calls are external). If a
 * milestone fails mid-batch, `refund_breakdown` records what completed and
 * what failed; the row lands in `partial` status. Jackson can re-trigger the
 * action — the per-milestone `spec_payments.status` guard prevents double-refunds.
 *
 * Bible:
 *  - SPEC/03_WORKFLOW.md § Refund processing — per-milestone procedure
 *  - SPEC/02_DATA_MODEL.md § spec_payments + spec_refund_requests
 *  - SPEC/05_ADMIN_UX.md § /admin/spec/refunds
 */

const REFUND_REASON_MAP: Record<"guarantee" | "goodwill", string> = {
  guarantee: "30-day Guarantee Refund (per SPEC ToS § 8)",
  goodwill: "Goodwill refund — post-30-day operator decision",
};

interface ProcessRefundFormPayload {
  refundRequestId: string;
  selectedMilestones: SpecPaymentMilestone[];
  internalNote?: string | null;
  // operator may flip `is_goodwill` post-30-day at process time.
  setGoodwill?: boolean;
}

export interface ProcessRefundResult {
  ok: boolean;
  status?: "processed" | "partial" | "failed" | "noop";
  error?: string;
  breakdownPreview?: RefundBreakdownExecutedLine[];
}

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return new Stripe(key);
}

function parseFormPayload(form: FormData): ProcessRefundFormPayload | null {
  const refundRequestId = form.get("refundRequestId");
  if (typeof refundRequestId !== "string" || !refundRequestId) return null;

  const rawMilestones = form.getAll("milestone");
  const selected = rawMilestones
    .map((v) => (typeof v === "string" ? (v as SpecPaymentMilestone) : null))
    .filter((v): v is SpecPaymentMilestone =>
      REFUND_MILESTONE_ORDER.includes(v as SpecPaymentMilestone),
    );

  const internalNote = form.get("internalNote");
  const setGoodwill = form.get("setGoodwill");

  return {
    refundRequestId,
    selectedMilestones: selected,
    internalNote:
      typeof internalNote === "string" && internalNote.trim().length > 0
        ? internalNote.trim().slice(0, 4000)
        : null,
    setGoodwill: setGoodwill === "1",
  };
}

export async function processRefundAction(
  _prevState: ProcessRefundResult | null,
  form: FormData,
): Promise<ProcessRefundResult> {
  const ctx = await requireSpecOperatorAction();
  if (!ctx) {
    return { ok: false, error: "Unauthorized" };
  }

  const payload = parseFormPayload(form);
  if (!payload) {
    return { ok: false, error: "Invalid form payload" };
  }

  const db = getAdminSupabase();

  // ── 1. Load refund request + project + payments under operator gate ────
  const { data: requestRow, error: requestErr } = await db
    .from("spec_refund_requests")
    .select(
      "id, spec_project_id, status, is_guarantee_invocation, is_goodwill, customer_reason_text, request_source",
    )
    .eq("id", payload.refundRequestId)
    .maybeSingle();
  if (requestErr || !requestRow) {
    return { ok: false, error: "Refund request not found" };
  }

  const refundRequest = requestRow as {
    id: string;
    spec_project_id: string;
    status: string;
    is_guarantee_invocation: boolean | null;
    is_goodwill: boolean | null;
    customer_reason_text: string | null;
    request_source: string;
  };

  // ── 2. Idempotency guard ───────────────────────────────────────────────
  if (
    refundRequest.status === "processed" ||
    refundRequest.status === "partial" ||
    refundRequest.status === "failed"
  ) {
    return {
      ok: true,
      status: "noop",
      error: `Refund already in status '${refundRequest.status}'`,
    };
  }
  if (refundRequest.status === "denied") {
    return { ok: false, error: "Refund request was already denied" };
  }

  // ── 3. Load project + payments ─────────────────────────────────────────
  const { data: projectRow, error: projectErr } = await db
    .from("spec_projects")
    .select(
      "id, tier, status, customer_name, customer_email, linked_company_id, buyer_user_id, account_holder_user_id, walkthrough_completed_at",
    )
    .eq("id", refundRequest.spec_project_id)
    .maybeSingle();
  if (projectErr || !projectRow) {
    return { ok: false, error: "Project not found" };
  }
  const project = projectRow as {
    id: string;
    tier: string;
    status: string;
    customer_name: string | null;
    customer_email: string;
    linked_company_id: string | null;
    buyer_user_id: string;
    account_holder_user_id: string | null;
    walkthrough_completed_at: string | null;
  };

  const { data: paymentRows, error: paymentsErr } = await db
    .from("spec_payments")
    .select(
      "id, milestone, status, total_cents, amount_refunded_cents, stripe_payment_intent_id, stripe_invoice_id",
    )
    .eq("spec_project_id", project.id);
  if (paymentsErr) {
    return { ok: false, error: "Failed to load payments" };
  }
  const payments = (paymentRows ?? []) as Array<{
    id: string;
    milestone: SpecPaymentMilestone;
    status: SpecPaymentStatus;
    total_cents: number;
    amount_refunded_cents: number | null;
    stripe_payment_intent_id: string | null;
    stripe_invoice_id: string | null;
  }>;

  // ── 4. Cap: refund total cannot exceed sum of paid milestones ──────────
  const totalPaidCents = payments
    .filter((p) => p.status === "paid" || p.status === "partially_refunded")
    .reduce(
      (sum, p) =>
        sum + (p.total_cents - (p.amount_refunded_cents ?? 0)),
      0,
    );

  const selectedMilestones =
    payload.selectedMilestones.length > 0
      ? payload.selectedMilestones
      : [...REFUND_MILESTONE_ORDER];

  // ── 5. Compute plan + walk Stripe per milestone ────────────────────────
  const refundPaymentRows: RefundPaymentRow[] = payments.map((p) => ({
    milestone: p.milestone,
    status: p.status,
    stripe_payment_intent_id: p.stripe_payment_intent_id,
    stripe_invoice_id: p.stripe_invoice_id,
    total_cents: p.total_cents,
    amount_refunded_cents: p.amount_refunded_cents,
  }));

  const { totals } = computeRefundBreakdownPreview(
    refundPaymentRows,
    selectedMilestones,
  );
  if (totals.totalCashRefundCents > totalPaidCents) {
    return {
      ok: false,
      error: `Refund total $${totals.totalCashRefundCents / 100} exceeds total paid $${totalPaidCents / 100}`,
    };
  }

  const stripe = getStripeClient();
  const refundReason =
    refundRequest.is_guarantee_invocation || payload.setGoodwill === false
      ? REFUND_REASON_MAP.guarantee
      : REFUND_REASON_MAP.goodwill;

  const executed: RefundBreakdownExecutedLine[] = [];

  for (const milestone of selectedMilestones) {
    const payment = payments.find((p) => p.milestone === milestone);
    if (!payment) {
      executed.push({
        milestone,
        action: "noop",
        stripe_resource_id: null,
        amount_cents: 0,
        cash_refund_cents: 0,
        status: "skipped",
        executed_at: new Date().toISOString(),
        error: "No payment row for milestone",
      });
      continue;
    }

    const line = await executeMilestone({
      stripe,
      payment,
      refundReason,
      db,
    });
    executed.push(line);
  }

  // ── 6. Roll up & write breakdown to refund_requests row ────────────────
  const allOk = executed.every(
    (e) => e.status === "succeeded" || e.status === "skipped",
  );
  const anyExecuted = executed.some((e) => e.status === "succeeded");
  const newStatus: "processed" | "partial" | "failed" = allOk
    ? "processed"
    : anyExecuted
      ? "partial"
      : "failed";

  const totalRefundCents = executed
    .filter((e) => e.status === "succeeded")
    .reduce((sum, e) => sum + e.cash_refund_cents, 0);
  const stripeRefundIds = executed
    .filter((e) => e.action === "refund" && e.status === "succeeded")
    .map((e) => e.stripe_resource_id)
    .filter((v): v is string => !!v);

  const nowIso = new Date().toISOString();
  const requestUpdate: Record<string, unknown> = {
    status: newStatus,
    processed_at: nowIso,
    processed_by_user_id: ctx.userId,
    refund_breakdown: executed,
    total_refund_cents: totalRefundCents,
    stripe_refund_ids: stripeRefundIds,
  };
  if (payload.internalNote) {
    requestUpdate.internal_note = payload.internalNote;
  }
  if (payload.setGoodwill === true) {
    requestUpdate.is_goodwill = true;
  }

  const { error: updateErr } = await db
    .from("spec_refund_requests")
    .update(requestUpdate)
    .eq("id", payload.refundRequestId);
  if (updateErr) {
    return {
      ok: false,
      error: `Stripe side complete but DB update failed: ${updateErr.message}`,
      breakdownPreview: executed,
    };
  }

  // ── 7. Flip entitlements + project status if we ran any cash refunds ───
  if (newStatus === "processed" || newStatus === "partial") {
    await db
      .from("spec_module_entitlements")
      .update({
        enabled: false,
        disabled_reason: "refunded",
        disabled_at: nowIso,
      })
      .eq("spec_project_id", project.id);

    await db
      .from("spec_projects")
      .update({ status: "refunded", refunded_at: nowIso, updated_at: nowIso })
      .eq("id", project.id);
  }

  // ── 8. Best-effort customer email + notification ───────────────────────
  await Promise.allSettled([
    writeSpecEmailOutbox({
      templateId: "spec.refund_processed",
      recipientEmail: project.customer_email,
      recipientUserId: project.buyer_user_id,
      specProjectId: project.id,
      payload: {
        customer_name: project.customer_name,
        tier: project.tier,
        refund_breakdown: executed,
        total_refund_cents: totalRefundCents,
        is_guarantee_invocation: refundRequest.is_guarantee_invocation === true,
        is_goodwill: refundRequest.is_goodwill === true || payload.setGoodwill === true,
        processed_at: nowIso,
        customer_reason_text: refundRequest.customer_reason_text,
      },
    }),
    project.linked_company_id
      ? db.from("notifications").insert({
          user_id: project.buyer_user_id,
          company_id: project.linked_company_id,
          type: "spec_refund_processed",
          title: "Refund processed",
          body: `Your SPEC refund has been processed. Total refunded: $${(totalRefundCents / 100).toFixed(2)}.`,
          is_read: false,
          persistent: false,
          action_url: `/account/spec/${project.id}`,
          action_label: "VIEW",
        })
      : Promise.resolve(),
  ]);

  revalidatePath("/admin/spec/refunds");
  revalidatePath("/admin/spec");

  return { ok: true, status: newStatus, breakdownPreview: executed };
}

interface ExecuteMilestoneArgs {
  stripe: Stripe;
  payment: {
    id: string;
    milestone: SpecPaymentMilestone;
    status: SpecPaymentStatus;
    total_cents: number;
    amount_refunded_cents: number | null;
    stripe_payment_intent_id: string | null;
    stripe_invoice_id: string | null;
  };
  refundReason: string;
  db: ReturnType<typeof getAdminSupabase>;
}

async function executeMilestone(
  args: ExecuteMilestoneArgs,
): Promise<RefundBreakdownExecutedLine> {
  const { stripe, payment, db } = args;
  const nowIso = new Date().toISOString();

  const baseLine: RefundBreakdownExecutedLine = {
    milestone: payment.milestone,
    action: "noop",
    stripe_resource_id: null,
    amount_cents: 0,
    cash_refund_cents: 0,
    status: "skipped",
    executed_at: nowIso,
    error: null,
  };

  try {
    if (payment.status === "paid") {
      if (!payment.stripe_payment_intent_id) {
        return {
          ...baseLine,
          action: "refund",
          status: "failed",
          error: "Missing stripe_payment_intent_id on a paid milestone",
        };
      }
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripe_payment_intent_id,
        amount: payment.total_cents,
        reason: "requested_by_customer",
      });
      await db
        .from("spec_payments")
        .update({
          status: "refunded",
          refunded_at: nowIso,
          amount_refunded_cents: payment.total_cents,
        })
        .eq("id", payment.id);
      return {
        milestone: payment.milestone,
        action: "refund",
        stripe_resource_id: refund.id,
        amount_cents: payment.total_cents,
        cash_refund_cents: payment.total_cents,
        status: "succeeded",
        executed_at: nowIso,
        error: null,
      };
    }

    if (payment.status === "partially_refunded") {
      const remaining =
        payment.total_cents - (payment.amount_refunded_cents ?? 0);
      if (remaining <= 0) {
        return {
          ...baseLine,
          action: "noop",
          status: "skipped",
          error: "Already fully refunded",
        };
      }
      if (!payment.stripe_payment_intent_id) {
        return {
          ...baseLine,
          action: "refund",
          amount_cents: remaining,
          status: "failed",
          error: "Missing stripe_payment_intent_id on a partially-refunded milestone",
        };
      }
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripe_payment_intent_id,
        amount: remaining,
        reason: "requested_by_customer",
      });
      await db
        .from("spec_payments")
        .update({
          status: "refunded",
          refunded_at: nowIso,
          amount_refunded_cents: payment.total_cents,
        })
        .eq("id", payment.id);
      return {
        milestone: payment.milestone,
        action: "refund",
        stripe_resource_id: refund.id,
        amount_cents: remaining,
        cash_refund_cents: remaining,
        status: "succeeded",
        executed_at: nowIso,
        error: null,
      };
    }

    if (payment.status === "invoiced" || payment.status === "overdue") {
      if (!payment.stripe_invoice_id) {
        return {
          ...baseLine,
          action: "void",
          status: "failed",
          error: "Missing stripe_invoice_id on an open invoice",
        };
      }
      // Inspect Stripe to detect partial payment.
      const invoice = await stripe.invoices.retrieve(payment.stripe_invoice_id);
      const amountPaid = invoice.amount_paid ?? 0;
      const amountDue = invoice.amount_due ?? 0;
      const totalFace = (invoice.total ?? payment.total_cents);

      if (amountPaid > 0 && amountDue > 0) {
        // Partially paid → credit_note for unpaid portion + refund for paid portion.
        const creditNoteAmount = amountDue;
        const refundAmount = amountPaid;
        const cn = await stripe.creditNotes.create({
          invoice: payment.stripe_invoice_id,
          amount: creditNoteAmount,
        });
        let refundId: string | null = null;
        if (refundAmount > 0 && payment.stripe_payment_intent_id) {
          const refund = await stripe.refunds.create({
            payment_intent: payment.stripe_payment_intent_id,
            amount: refundAmount,
            reason: "requested_by_customer",
          });
          refundId = refund.id;
        }
        await db
          .from("spec_payments")
          .update({
            status: "partially_refunded",
            refunded_at: nowIso,
            amount_refunded_cents: refundAmount,
            credit_note_stripe_id: cn.id,
          })
          .eq("id", payment.id);
        return {
          milestone: payment.milestone,
          action: "credit_note",
          stripe_resource_id: cn.id,
          amount_cents: totalFace,
          cash_refund_cents: refundAmount,
          status: "succeeded",
          executed_at: nowIso,
          error: refundId ? null : "Credit note succeeded; refund not attempted (no payment intent)",
        };
      }

      // Fully open invoice → void; fall back to mark_uncollectible if Stripe rejects.
      try {
        const voided = await stripe.invoices.voidInvoice(
          payment.stripe_invoice_id,
        );
        await db
          .from("spec_payments")
          .update({ status: "voided", voided_at: nowIso })
          .eq("id", payment.id);
        return {
          milestone: payment.milestone,
          action: "void",
          stripe_resource_id: voided.id,
          amount_cents: totalFace,
          cash_refund_cents: 0,
          status: "succeeded",
          executed_at: nowIso,
          error: null,
        };
      } catch (voidErr) {
        const reason = voidErr instanceof Error ? voidErr.message : String(voidErr);
        const mu = await stripe.invoices.markUncollectible(
          payment.stripe_invoice_id,
        );
        await db
          .from("spec_payments")
          .update({
            status: "uncollectible",
            marked_uncollectible_at: nowIso,
          })
          .eq("id", payment.id);
        return {
          milestone: payment.milestone,
          action: "mark_uncollectible",
          stripe_resource_id: mu.id,
          amount_cents: totalFace,
          cash_refund_cents: 0,
          status: "succeeded",
          executed_at: nowIso,
          error: `void rejected → fell back to mark_uncollectible (${reason})`,
        };
      }
    }

    // Already-handled, never-invoiced, or disputed — noop.
    return {
      ...baseLine,
      action: "noop",
      status: "skipped",
      error: `Milestone status '${payment.status}' — no action taken`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[executeMilestone] ${payment.milestone} failed:`,
      reason,
    );
    return {
      ...baseLine,
      status: "failed",
      error: reason,
    };
  }
}

// ─── Helper: re-export for the page so it can fan a notification list ────

export const OPS_OPERATIONS_COMPANY_ID_RE_EXPORT = OPS_OPERATIONS_COMPANY_ID;
