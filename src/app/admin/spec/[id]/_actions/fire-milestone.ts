"use server";

import { revalidatePath } from "next/cache";
import { getStripe, ensureStripeCustomer } from "@/lib/stripe/checkout-helpers";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { getMilestoneFireability } from "@/lib/admin/spec-queries";
import {
  SPEC_MILESTONE_LABELS,
  SPEC_TIER_TOTAL_CENTS,
  type SpecPaymentMilestone,
} from "@/lib/admin/spec-types";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

const VALID_MILESTONES = new Set<SpecPaymentMilestone>(["scope_signoff", "midpoint", "delivery"]);

// Net-15 invoicing per the bible's milestone policy.
const NET_DAYS = 15;

const EMAIL_TEMPLATE: Record<"scope_signoff" | "midpoint" | "delivery", string> = {
  scope_signoff: "spec.p2_invoice",
  midpoint: "spec.p3_invoice",
  delivery: "spec.p4_invoice",
};

/**
 * Fire a P2/P3/P4 milestone invoice. Server action.
 *
 * Pipeline:
 *   1. Re-check operator gate.
 *   2. Re-derive fireability (snapshot from page render may be stale).
 *   3. Ensure a Stripe customer exists for the engagement's linked_company.
 *   4. Create a Stripe Invoice (net-15) with the milestone amount, finalize +
 *      auto_advance so Stripe emails the invoice to the customer.
 *   5. Insert a `spec_payments` row (`status='invoiced'`, `invoiced_at=now()`,
 *      `due_date=now() + 15d`) carrying the Stripe invoice id.
 *   6. Insert a `spec_email_outbox` row for the SPEC-branded confirmation
 *      email (Stage H drains the outbox; until those templates merge, the row
 *      lives as a queue entry).
 *   7. Insert a `spec_communications` system row + an operator-facing
 *      `notifications` row so the action shows up in the timeline and the rail.
 *   8. Revalidate the page so the operator sees the new invoice row.
 *
 * Hard rules enforced (server-side):
 *   - Operator gate re-verified.
 *   - Milestone must be P2/P3/P4 (P1 is webhook-fired).
 *   - Prerequisite acceptance event must exist (delegated to
 *     `getMilestoneFireability`).
 *   - Project must have a linked_company so Stripe has somewhere to invoice.
 *   - If any Stripe call fails AFTER the spec_payments row is inserted, the
 *     payments row is rolled back so the operator can retry cleanly.
 */
export async function fireMilestone(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = formData.get("project_id");
  const milestoneRaw = formData.get("milestone");
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new Error("SYS :: MISSING PROJECT ID");
  }
  if (typeof milestoneRaw !== "string" || !VALID_MILESTONES.has(milestoneRaw as SpecPaymentMilestone)) {
    throw new Error("SYS :: INVALID MILESTONE");
  }
  const milestone = milestoneRaw as "scope_signoff" | "midpoint" | "delivery";

  // Re-derive fireability against the live row state — the rendered snapshot
  // can be stale by the time the operator clicks (e.g. another operator fired
  // the same milestone seconds earlier).
  const fireability = await getMilestoneFireability(projectId, milestone);
  if (!fireability.fireable || !fireability.row) {
    throw new Error(
      `SYS :: MILESTONE NOT FIREABLE · ${fireability.reason ?? "unknown reason"}`,
    );
  }

  const project = fireability.row;
  if (!project.linked_company_id) {
    throw new Error("SYS :: PROJECT MISSING LINKED COMPANY — STRIPE CUSTOMER UNDETERMINED");
  }

  const supabase = getAdminSupabase();
  const stripe = getStripe();

  // Pull the linked company so we can ensure/lookup a Stripe customer.
  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .select("id, name, stripe_customer_id")
    .eq("id", project.linked_company_id)
    .maybeSingle();
  if (companyErr) {
    throw new Error(`SYS :: COMPANY LOOKUP FAILED · ${companyErr.message}`);
  }
  if (!company) throw new Error("SYS :: LINKED COMPANY NOT FOUND");

  const stripeCustomerId = await ensureStripeCustomer({
    stripe,
    supabase,
    companyId: company.id as string,
    companyName: (company.name as string | null) ?? project.customer_name ?? project.customer_email,
    email: project.customer_email,
    existingCustomerId: (company.stripe_customer_id as string | null) ?? null,
  });

  const tier = project.tier;
  const milestoneAmount = Math.round(SPEC_TIER_TOTAL_CENTS[tier] / 4);
  const milestoneLabel = SPEC_MILESTONE_LABELS[milestone];

  // Insert the spec_payments row FIRST so we have something to roll back if
  // Stripe creation fails. status='pending' until the Stripe invoice id lands.
  const dueDateIso = new Date(Date.now() + NET_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: insertedPayment, error: insertErr } = await supabase
    .from("spec_payments")
    .insert({
      spec_project_id: projectId,
      milestone,
      amount_cents: milestoneAmount,
      total_cents: milestoneAmount,
      tax_cents: 0,
      status: "pending",
      due_date: dueDateIso,
      is_test: !!project.is_test,
    })
    .select("id")
    .maybeSingle();
  if (insertErr) {
    throw new Error(`SYS :: PAYMENT INSERT FAILED · ${insertErr.message}`);
  }
  if (!insertedPayment) throw new Error("SYS :: PAYMENT INSERT RETURNED NO ROW");
  const paymentId = insertedPayment.id as string;

  // Create the Stripe invoice. We finalize + auto_advance so Stripe sends the
  // hosted invoice email immediately. days_until_due = 15 mirrors net-15.
  let stripeInvoiceId: string | null = null;
  let stripeInvoiceUrl: string | null = null;
  try {
    const invoiceItem = await stripe.invoiceItems.create(
      {
        customer: stripeCustomerId,
        currency: "cad",
        amount: milestoneAmount,
        description: `SPEC ${milestoneLabel} — ${tier.toUpperCase()} (${milestoneNameFor(milestone)})`,
        metadata: {
          spec_project_id: projectId,
          spec_payment_id: paymentId,
          milestone,
          tier,
        },
      },
      { idempotencyKey: `spec-${paymentId}-item` },
    );

    const invoice = await stripe.invoices.create(
      {
        customer: stripeCustomerId,
        collection_method: "send_invoice",
        days_until_due: NET_DAYS,
        auto_advance: true,
        metadata: {
          spec_project_id: projectId,
          spec_payment_id: paymentId,
          milestone,
          tier,
          invoice_item_id: invoiceItem.id ?? "",
        },
        description: `${milestoneLabel} invoice for SPEC ${tier.toUpperCase()} engagement`,
      },
      { idempotencyKey: `spec-${paymentId}-invoice` },
    );

    if (!invoice.id) {
      throw new Error("Stripe invoice id missing on create");
    }

    // Finalize the invoice so it's ready to send. Stripe will auto-email it
    // because of `auto_advance` + `collection_method: 'send_invoice'`.
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
      auto_advance: true,
    });
    stripeInvoiceId = finalized.id ?? invoice.id ?? null;
    stripeInvoiceUrl = finalized.hosted_invoice_url ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[fireMilestone] stripe failed:", msg);
    // Roll back the payments row so the operator can retry without a dangling
    // pending row.
    await supabase.from("spec_payments").delete().eq("id", paymentId);
    throw new Error(`SYS :: STRIPE INVOICE FAILED · ${msg}`);
  }

  // Update the payments row with the Stripe id + invoiced_at + status.
  const invoicedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("spec_payments")
    .update({
      stripe_invoice_id: stripeInvoiceId,
      invoiced_at: invoicedAt,
      status: "invoiced",
    })
    .eq("id", paymentId);
  if (updateErr) {
    console.error("[fireMilestone] payment update failed:", updateErr.message);
  }

  // Queue the branded SPEC follow-up email (Stage H templates: spec.p2_invoice
  // / spec.p3_invoice / spec.p4_invoice). The Stage H worker drains
  // `spec_email_outbox` rows in `status='pending'` order. Until Stage H merges,
  // these rows accumulate as a clean audit trail — Stripe's own invoice email
  // has already gone out via `auto_advance`.
  const tplPayload: Record<string, unknown> = {
    spec_project_id: projectId,
    spec_payment_id: paymentId,
    tier,
    milestone,
    amount_cents: milestoneAmount,
    invoice_number: stripeInvoiceId,
    stripe_invoice_url: stripeInvoiceUrl,
    due_date: dueDateIso,
    buyer_name: project.customer_name ?? project.customer_email,
    company_name: company.name ?? null,
  };
  if (milestone === "delivery") {
    tplPayload.walkthrough_completed_at = project.walkthrough_completed_at;
    tplPayload.support_window_ends_at = project.support_window_ends_at;
  }

  const { error: outboxErr } = await supabase.from("spec_email_outbox").insert({
    template_id: EMAIL_TEMPLATE[milestone],
    recipient_email: project.customer_email,
    recipient_user_id: project.buyer_user_id,
    spec_project_id: projectId,
    payload: tplPayload,
    is_test: !!project.is_test,
  });
  if (outboxErr) {
    console.error("[fireMilestone] outbox enqueue failed:", outboxErr.message);
  }

  // System communication entry — surfaces in Tab 2 timeline.
  await supabase.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary: `${milestoneLabel} invoice fired — Stripe invoice ${stripeInvoiceId ?? "(unknown id)"} · ${formatDollarsCents(milestoneAmount)}`,
    body: stripeInvoiceUrl ?? null,
    logged_by_user_id: operatorId,
  });

  // Operator-facing notification (uses OPS Operations company; non-blocking).
  const opsOperationsCompanyId =
    process.env.NEXT_PUBLIC_OPS_OPERATIONS_COMPANY_ID ??
    process.env.OPS_OPERATIONS_COMPANY_ID ??
    "00000000-0000-0000-0000-00000000000a";
  const { error: notifErr } = await supabase.from("notifications").insert({
    user_id: operatorId,
    company_id: opsOperationsCompanyId,
    type: "spec_invoice_fired",
    title: `${milestoneLabel} invoice fired`,
    body: `${project.customer_name ?? project.customer_email} · ${formatDollarsCents(milestoneAmount)} · net-${NET_DAYS}`,
    is_read: false,
    action_url: `/admin/spec/${projectId}?tab=milestones`,
    action_label: "VIEW MILESTONES",
  });
  if (notifErr) {
    console.error("[fireMilestone] notification insert failed:", notifErr.message);
  }

  revalidatePath(`/admin/spec/${projectId}`);
  revalidatePath("/admin/spec");
}

function milestoneNameFor(milestone: "scope_signoff" | "midpoint" | "delivery"): string {
  switch (milestone) {
    case "scope_signoff":
      return "scope sign-off";
    case "midpoint":
      return "midpoint demo";
    case "delivery":
      return "delivery";
  }
}

function formatDollarsCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 })}`;
}
