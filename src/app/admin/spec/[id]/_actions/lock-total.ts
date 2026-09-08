"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { OPS_OPERATIONS_COMPANY_ID } from "@/lib/admin/spec-constants";
import {
  SPEC03_LOCKED_TOTAL_MAX_CENTS,
  formatCadCents,
  lockBlockedLabel,
  lockedTotalGate,
  parseLockedTotalInput,
  pickCurrentScopeDocument,
  scopeContentHash,
  withLockedTotal,
  type LockedTotalParseFailure,
} from "@/lib/admin/spec-locked-total";
import { readLockedTotalCents } from "@/lib/admin/spec-milestones";
import { SPEC_TIER_DESIGNATIONS, SPEC_TIER_TOTAL_CENTS, coerceSpecTier } from "@/lib/admin/spec-tiers";
import type { SpecProjectStatus } from "@/lib/admin/spec-types";
import { denyNonOperator, requireSpecOperatorUserId } from "./_require-operator";

/**
 * Lock (or re-lock) a SPEC-03 engagement's total. Server action.
 *
 * SPEC-03 is the only variable-total tier (10_TIER_MODEL_V2 § 2): P1 is fixed
 * at a quarter of the $25,000 floor and P2–P4 split the locked remainder. The
 * figure's home is the scope doc the customer signs, so one action writes it
 * in two places:
 *
 *   1. `spec_scope_documents.content_json.locked_total_cents` on the CURRENT
 *      draft, with `content_hash` recomputed — the customer's countersign
 *      (`spec_acceptance_events.payload_hash`) then covers the price.
 *   2. `spec_projects.locked_total_cents` — what the Milestones tab prices
 *      and `fire-milestone` invoices from.
 *
 * Gate (`lockedTotalGate`, shared with the Scope Doc tab so the control and
 * the write path agree): SPEC-03 only; engagement not closed; no scope
 * sign-off yet; P2 not invoiced; a current doc exists and is unsent. After
 * sign-off a change order carries any change, never a re-lock. Money still
 * cannot move early — P2 keeps its `scope_signoff` prerequisite in
 * `milestoneFireability`.
 *
 * Side effects: `spec_communications` system row (timeline), operator
 * notification on the OPS Operations rail (non-blocking), revalidate.
 *
 * Write order is doc → project. A failure between the two leaves the doc
 * carrying the figure and the project unlocked; re-running the action is
 * idempotent and repairs it.
 */
export async function lockTotal(formData: FormData): Promise<void> {
  const operatorId = await requireSpecOperatorUserId();
  if (!operatorId) denyNonOperator();

  const projectId = formData.get("project_id");
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new Error("SYS :: MISSING PROJECT ID");
  }

  const parsed = parseLockedTotalInput(formData.get("locked_total"));
  if (!parsed.ok) throw new Error(PARSE_FAILURE_MESSAGE[parsed.reason]);
  const cents = parsed.cents;

  const supabase = getAdminSupabase();

  const { data: project, error: projectError } = await supabase
    .from("spec_projects")
    .select("id, tier, status, is_test, locked_total_cents, customer_name, customer_email")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw new Error(`SYS :: PROJECT LOOKUP FAILED · ${projectError.message}`);
  if (!project) throw new Error("SYS :: PROJECT NOT FOUND");

  const tier = coerceSpecTier(project.tier as string | null);
  const status = project.status as SpecProjectStatus;

  const { data: docRows, error: docsError } = await supabase
    .from("spec_scope_documents")
    .select("id, version, content_json, sent_at, superseded_at")
    .eq("spec_project_id", projectId)
    .order("version", { ascending: false });
  if (docsError) throw new Error(`SYS :: SCOPE DOC LOOKUP FAILED · ${docsError.message}`);
  const current = pickCurrentScopeDocument((docRows ?? []) as ScopeDocRow[]);

  const { data: signoffRows, error: signoffError } = await supabase
    .from("spec_acceptance_events")
    .select("id, accepted_at")
    .eq("spec_project_id", projectId)
    .eq("event_type", "scope_signoff")
    .order("accepted_at", { ascending: true })
    .limit(1);
  if (signoffError) throw new Error(`SYS :: SIGN-OFF LOOKUP FAILED · ${signoffError.message}`);
  const signoff = (signoffRows ?? [])[0] as { id: string; accepted_at: string } | undefined;

  const { data: p2Rows, error: p2Error } = await supabase
    .from("spec_payments")
    .select("id")
    .eq("spec_project_id", projectId)
    .eq("milestone", "scope_signoff")
    .limit(1);
  if (p2Error) throw new Error(`SYS :: P2 LOOKUP FAILED · ${p2Error.message}`);

  const gate = lockedTotalGate({
    tier,
    status,
    currentDoc: current ? { sentAt: current.sent_at } : null,
    hasScopeSignoff: signoff !== undefined,
    hasP2Payment: (p2Rows ?? []).length > 0,
  });
  if (!gate.allowed || !current) {
    const reason = gate.allowed ? "no_scope_doc" : gate.reason;
    throw new Error(
      `SYS :: LOCK REFUSED · ${lockBlockedLabel(reason, {
        version: current?.version ?? null,
        signedAt: signoff?.accepted_at ?? null,
      })}`,
    );
  }

  // 1. The scope doc carries the figure; its hash now covers the price.
  const nextContent = withLockedTotal(current.content_json, cents);
  const { error: docWriteError } = await supabase
    .from("spec_scope_documents")
    .update({ content_json: nextContent, content_hash: scopeContentHash(nextContent) })
    .eq("id", current.id);
  if (docWriteError) throw new Error(`SYS :: SCOPE DOC UPDATE FAILED · ${docWriteError.message}`);

  // 2. The project column the Milestones tab invoices from.
  const { error: projectWriteError } = await supabase
    .from("spec_projects")
    .update({ locked_total_cents: cents, updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (projectWriteError) {
    throw new Error(`SYS :: LOCKED TOTAL UPDATE FAILED · ${projectWriteError.message}`);
  }

  const previous = readLockedTotalCents(tier, project.locked_total_cents);
  const figure = formatCadCents(cents);
  const docLabel = `scope doc v${current.version}`;
  const summary =
    previous == null
      ? `Total locked at ${figure} on ${docLabel} (${SPEC_TIER_DESIGNATIONS[tier]} · floor ${formatCadCents(SPEC_TIER_TOTAL_CENTS[tier])})`
      : `Total re-locked ${formatCadCents(previous)} → ${figure} on ${docLabel}`;

  // Audit trail — surfaces on the Timeline tab.
  const { error: commsError } = await supabase.from("spec_communications").insert({
    spec_project_id: projectId,
    direction: "outbound",
    channel: "system",
    summary,
    logged_by_user_id: operatorId,
    is_test: !!project.is_test,
  });
  if (commsError) console.error("[lockTotal] communication insert failed:", commsError.message);

  // Operator rail — non-blocking; the lock already holds.
  const customer = (project.customer_name as string | null) ?? (project.customer_email as string);
  const { error: notifError } = await supabase.from("notifications").insert({
    user_id: operatorId,
    company_id: OPS_OPERATIONS_COMPANY_ID,
    type: "spec_total_locked",
    title: previous == null ? "Total locked" : "Total re-locked",
    body: `${customer} · ${figure} on ${docLabel}`,
    is_read: false,
    action_url: `/admin/spec/${projectId}?tab=milestones`,
    action_label: "VIEW MILESTONES",
  });
  if (notifError) console.error("[lockTotal] notification insert failed:", notifError.message);

  revalidatePath(`/admin/spec/${projectId}`);
  revalidatePath("/admin/spec");
}

interface ScopeDocRow {
  id: string;
  version: number;
  content_json: unknown;
  sent_at: string | null;
  superseded_at: string | null;
}

const PARSE_FAILURE_MESSAGE: Record<LockedTotalParseFailure, string> = {
  empty: "SYS :: TOTAL REQUIRED",
  not_a_number: "SYS :: TOTAL IS NOT A DOLLAR FIGURE",
  fractional_cents: "SYS :: TOTAL CARRIES FRACTIONAL CENTS",
  below_floor: `SYS :: TOTAL BELOW FLOOR · ${formatCadCents(SPEC_TIER_TOTAL_CENTS.spec03)}`,
  above_max: `SYS :: TOTAL EXCEEDS THE COLUMN CEILING · ${formatCadCents(SPEC03_LOCKED_TOTAL_MAX_CENTS)}`,
};
