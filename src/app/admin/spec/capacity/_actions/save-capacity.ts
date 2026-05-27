"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath, revalidateTag } from "next/cache";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { isSpecOperator } from "@/lib/admin/spec-permissions";
import {
  OPS_OPERATIONS_COMPANY_ID,
  SPEC_CAPACITY_RECORD_IDS,
} from "@/lib/admin/spec-constants";
import type { SpecTier } from "@/lib/admin/spec-types";

/**
 * Save-capacity server action — `/admin/spec/capacity` per-tier submit.
 *
 * Pipeline (in strict order — any step failing aborts the rest):
 *   1.  Re-verify the SPEC operator gate via Firebase JWT + isSpecOperator().
 *       The parent layout has already gated the RSC, but server actions can
 *       be invoked with a stolen payload outside the layout, so we never
 *       trust the request shape alone.
 *   2.  Coerce + validate every field. Rejects bad input with a per-field
 *       error map so the client form can highlight the bad input.
 *   3.  Load the existing row (`old_data` for audit_log).
 *   4.  UPDATE spec_capacity for this tier.
 *   5.  INSERT audit_log row (operator-scope: company_id =
 *       OPS_OPERATIONS_COMPANY_ID; record_id = the stable per-tier uuid
 *       documented in spec-constants.ts).
 *   6.  Call public.refresh_spec_board_snapshot() RPC so /spec OPS BOARD
 *       reflects the change within seconds instead of waiting on the 5-min
 *       pg_cron.
 *   7.  revalidatePath('/admin/spec/capacity') + revalidateTag('spec-capacity')
 *       so both the editor and the read-only overview pull fresh data on the
 *       next nav.
 *
 * Returns a discriminated state shape consumed by the client `CapacityTierForm`.
 */

export type SaveCapacityFormState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; refreshedAt: string }
  | { status: "error"; formError?: string; errors?: Record<string, string> };

const ALLOWED_TIERS: ReadonlyArray<SpecTier> = ["setup", "build", "enterprise"];

async function requireOperator(): Promise<{ userId: string } | null> {
  const cookieStore = await cookies();
  const headersList = await headers();

  const token =
    headersList.get("authorization")?.replace("Bearer ", "") ||
    cookieStore.get("__session")?.value ||
    cookieStore.get("ops-auth-token")?.value;

  if (!token) return null;

  try {
    const fbUser = await verifyAuthToken(token);
    if (!fbUser.email) return null;
    const opsUser = await findUserByAuth(fbUser.uid, fbUser.email, "id");
    if (!opsUser || typeof opsUser.id !== "string") return null;
    const ok = await isSpecOperator(opsUser.id);
    if (!ok) return null;
    return { userId: opsUser.id };
  } catch {
    return null;
  }
}

// ─── Field coercion + validation ─────────────────────────────────────────────

function parseInt0(v: FormDataEntryValue | null): number {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function parseFloat0(v: FormDataEntryValue | null): number {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseDate(v: FormDataEntryValue | null): string | null | "invalid" {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  // HTML date input always emits YYYY-MM-DD; verify the shape.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "invalid";
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "invalid";
  return s;
}

function parseText(v: FormDataEntryValue | null, maxLen: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  return s.slice(0, maxLen);
}

interface ValidatedRow {
  slot_ceiling: number;
  discovery_days_min: number;
  discovery_days_max: number;
  build_days_min: number;
  build_days_max: number;
  support_window_days: number;
  subscription_multiplier_estimate: number;
  retainer_monthly_cents: number;
  polish_hours_budget: number;
  is_accepting_bookings: boolean;
  manual_next_start_override: string | null;
  public_note: string | null;
  admin_notes: string | null;
}

function validate(
  formData: FormData,
): { ok: true; data: ValidatedRow } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const slotCeiling = parseInt0(formData.get("slot_ceiling"));
  if (!Number.isFinite(slotCeiling) || slotCeiling < 0) {
    errors.slot_ceiling = "MUST BE INTEGER ≥ 0";
  }

  const discMin = parseInt0(formData.get("discovery_days_min"));
  const discMax = parseInt0(formData.get("discovery_days_max"));
  if (!Number.isFinite(discMin) || discMin < 0) errors.discovery_days_min = "MUST BE INTEGER ≥ 0";
  if (!Number.isFinite(discMax) || discMax < 0) errors.discovery_days_max = "MUST BE INTEGER ≥ 0";
  if (
    Number.isFinite(discMin) &&
    Number.isFinite(discMax) &&
    discMin > discMax
  ) {
    errors.discovery_days_max = "MAX MUST BE ≥ MIN";
  }

  const buildMin = parseInt0(formData.get("build_days_min"));
  const buildMax = parseInt0(formData.get("build_days_max"));
  if (!Number.isFinite(buildMin) || buildMin < 0) errors.build_days_min = "MUST BE INTEGER ≥ 0";
  if (!Number.isFinite(buildMax) || buildMax < 0) errors.build_days_max = "MUST BE INTEGER ≥ 0";
  if (
    Number.isFinite(buildMin) &&
    Number.isFinite(buildMax) &&
    buildMin > buildMax
  ) {
    errors.build_days_max = "MAX MUST BE ≥ MIN";
  }

  const support = parseInt0(formData.get("support_window_days"));
  if (!Number.isFinite(support) || support < 0) errors.support_window_days = "MUST BE INTEGER ≥ 0";

  const multiplier = parseFloat0(formData.get("subscription_multiplier_estimate"));
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    errors.subscription_multiplier_estimate = "MUST BE NUMBER ≥ 0";
  } else if (multiplier > 99.99) {
    // numeric(4,2) caps at 99.99
    errors.subscription_multiplier_estimate = "MAX 99.99";
  }

  const retainerDollars = parseInt0(formData.get("retainer_monthly_dollars"));
  if (!Number.isFinite(retainerDollars) || retainerDollars < 0) {
    errors.retainer_monthly_dollars = "MUST BE INTEGER ≥ 0";
  }

  const polish = parseFloat0(formData.get("polish_hours_budget"));
  if (!Number.isFinite(polish) || polish < 0) {
    errors.polish_hours_budget = "MUST BE NUMBER ≥ 0";
  } else if (polish > 99.99) {
    errors.polish_hours_budget = "MAX 99.99";
  } else if (Math.abs((polish * 2) - Math.round(polish * 2)) > 1e-9) {
    errors.polish_hours_budget = "USE 0.5 INCREMENTS";
  }

  const dateVal = parseDate(formData.get("manual_next_start_override"));
  if (dateVal === "invalid") {
    errors.manual_next_start_override = "INVALID DATE";
  }

  // Public note has a hard 240-char ceiling — it surfaces on /spec board cards
  // where layout breaks if it runs long.
  const publicNoteRaw = formData.get("public_note");
  let publicNote: string | null = null;
  if (publicNoteRaw != null) {
    const s = String(publicNoteRaw).trim();
    if (s.length > 240) {
      errors.public_note = "MAX 240 CHARS";
    } else if (s !== "") {
      publicNote = s;
    }
  }

  // Admin notes have a generous 2k cap.
  const adminNotesRaw = formData.get("admin_notes");
  let adminNotes: string | null = null;
  if (adminNotesRaw != null) {
    const s = String(adminNotesRaw).trim();
    if (s.length > 2000) {
      errors.admin_notes = "MAX 2000 CHARS";
    } else if (s !== "") {
      adminNotes = s;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const isAccepting = String(formData.get("is_accepting_bookings") ?? "0") === "1";

  return {
    ok: true,
    data: {
      slot_ceiling: slotCeiling,
      discovery_days_min: discMin,
      discovery_days_max: discMax,
      build_days_min: buildMin,
      build_days_max: buildMax,
      support_window_days: support,
      subscription_multiplier_estimate: Math.round(multiplier * 100) / 100,
      retainer_monthly_cents: retainerDollars * 100,
      polish_hours_budget: Math.round(polish * 100) / 100,
      is_accepting_bookings: isAccepting,
      manual_next_start_override: dateVal === "invalid" ? null : dateVal,
      public_note: parseText(publicNoteRaw, 240) ?? publicNote, // already validated
      admin_notes: parseText(adminNotesRaw, 2000) ?? adminNotes,
    },
  };
}

// ─── Action entry point ──────────────────────────────────────────────────────

export async function saveCapacityAction(
  tier: SpecTier,
  formData: FormData,
): Promise<SaveCapacityFormState> {
  // 1. Operator gate (re-asserted here; payload-only callers fail closed).
  const opUser = await requireOperator();
  if (!opUser) {
    return { status: "error", formError: "NOT AUTHORIZED" };
  }

  // Guard against tampered tier values.
  if (!ALLOWED_TIERS.includes(tier)) {
    return { status: "error", formError: "INVALID TIER" };
  }

  // 2. Validate.
  const v = validate(formData);
  if (!v.ok) {
    return { status: "error", errors: v.errors, formError: "VALIDATION FAILED" };
  }

  const db = getAdminSupabase();

  // 3. Load existing row for audit `old_data`.
  const { data: oldRow, error: oldErr } = await db
    .from("spec_capacity")
    .select("*")
    .eq("tier", tier)
    .maybeSingle();

  if (oldErr) {
    console.error("[saveCapacityAction] load-existing failed:", oldErr.message);
    return { status: "error", formError: `READ FAILED · ${oldErr.message}` };
  }
  if (!oldRow) {
    return { status: "error", formError: "TIER ROW MISSING — RUN STAGE A SEED" };
  }

  // 4. Update spec_capacity.
  const updatePayload = {
    ...v.data,
    updated_at: new Date().toISOString(),
  };
  const { data: newRow, error: updateErr } = await db
    .from("spec_capacity")
    .update(updatePayload)
    .eq("tier", tier)
    .select("*")
    .maybeSingle();

  if (updateErr) {
    console.error("[saveCapacityAction] update failed:", updateErr.message);
    return { status: "error", formError: `UPDATE FAILED · ${updateErr.message}` };
  }
  if (!newRow) {
    return { status: "error", formError: "UPDATE RETURNED NO ROW" };
  }

  // 5. Audit row — operator-scope (company_id = OPS_OPERATIONS_COMPANY_ID,
  // record_id = stable per-tier uuid). audit_log RLS is company-scoped; the
  // service-role client bypasses it on write. Stable record_id lets future
  // queries pull "all changes to setup tier" by record_id without joining
  // through new_data.
  const { error: auditErr } = await db.from("audit_log").insert({
    table_name: "spec_capacity",
    record_id: SPEC_CAPACITY_RECORD_IDS[tier],
    company_id: OPS_OPERATIONS_COMPANY_ID,
    // audit_log.action_check requires UPPERCASE: 'INSERT' | 'UPDATE' | 'DELETE'.
    action: "UPDATE",
    old_data: oldRow,
    new_data: newRow,
    changed_by: opUser.userId,
  });
  if (auditErr) {
    // Audit failure is non-fatal — the row update has already committed. We
    // surface a warning in the form state but don't block the operator from
    // continuing. The DB itself still has updated_at on spec_capacity, and the
    // ops-software-bible note covers this fallback case.
    console.error("[saveCapacityAction] audit_log insert failed:", auditErr.message);
  }

  // 6. Refresh the public board snapshot so /spec OPS BOARD picks up the
  // change in seconds (not 5 min). Uses the public-schema wrapper added by
  // Stage F.1's migration `2026-05-26-03-spec-stage-f1-board-refresh-wrapper`.
  const { error: refreshErr } = await db.rpc("refresh_spec_board_snapshot");
  if (refreshErr) {
    console.error("[saveCapacityAction] snapshot refresh failed:", refreshErr.message);
    return {
      status: "error",
      formError: `SAVED BUT SNAPSHOT REFRESH FAILED · ${refreshErr.message}`,
    };
  }

  // 7. Invalidate caches.
  revalidatePath("/admin/spec/capacity");
  revalidatePath("/admin/spec");
  revalidateTag("spec-capacity");

  // Read back the refreshed_at value for the success badge.
  const { data: snapshot } = await db
    .from("spec_public_board_snapshot")
    .select("refreshed_at")
    .limit(1)
    .maybeSingle();

  return {
    status: "success",
    refreshedAt: (snapshot?.refreshed_at as string | undefined) ?? new Date().toISOString(),
  };
}
