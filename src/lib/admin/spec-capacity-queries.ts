/**
 * SPEC capacity editor — full-row queries for `/admin/spec/capacity`.
 *
 * SERVER ONLY. The overview path in `spec-queries.ts` reads a narrow projection
 * of `spec_capacity` (slot_ceiling + booking flags + override + public_note)
 * because the overview only renders the read-only panel. The editor needs every
 * editable column — duration ranges, pricing, multiplier, retainer cost, polish
 * budget, admin_notes — so it gets its own loader to keep the two surfaces from
 * leaking into each other.
 *
 * `private.is_spec_operator()` already gates `spec_capacity` reads/writes at the
 * RLS layer; this loader uses the service-role client and the page-level
 * operator gate (via `/admin/spec/layout.tsx`) keeps anon callers out before
 * they ever reach this file.
 */

import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { CapacityEditRow, SpecTier } from "./spec-types";

const db = () => getAdminSupabase();

const TIER_ORDER: Record<SpecTier, number> = {
  setup: 1,
  build: 2,
  enterprise: 3,
};

function ofTier(tier: string | null | undefined): SpecTier {
  if (tier === "build" || tier === "enterprise") return tier;
  return "setup";
}

/**
 * Load every spec_capacity row in tier-order (setup → build → enterprise). The
 * editor surface always renders all three; if any row is missing the page
 * surfaces a stub with "—" markers so the operator can see Stage A drift.
 */
export async function getCapacityEditRows(): Promise<CapacityEditRow[]> {
  const { data, error } = await db()
    .from("spec_capacity")
    .select(
      `
        tier,
        slot_ceiling,
        discovery_days_min,
        discovery_days_max,
        build_days_min,
        build_days_max,
        support_window_days,
        subscription_multiplier_estimate,
        retainer_monthly_cents,
        polish_hours_budget,
        is_accepting_bookings,
        manual_next_start_override,
        public_note,
        admin_notes,
        updated_at
      `,
    );

  if (error) {
    throw new Error(`spec_capacity read failed: ${error.message}`);
  }

  const rows: CapacityEditRow[] = (data ?? []).map((r) => ({
    tier: ofTier(r.tier as string),
    slotCeiling: Number(r.slot_ceiling ?? 0),
    discoveryDaysMin: Number(r.discovery_days_min ?? 0),
    discoveryDaysMax: Number(r.discovery_days_max ?? 0),
    buildDaysMin: Number(r.build_days_min ?? 0),
    buildDaysMax: Number(r.build_days_max ?? 0),
    supportWindowDays: Number(r.support_window_days ?? 0),
    subscriptionMultiplierEstimate: Number(r.subscription_multiplier_estimate ?? 0),
    retainerMonthlyCents: Number(r.retainer_monthly_cents ?? 0),
    polishHoursBudget: Number(r.polish_hours_budget ?? 0),
    isAcceptingBookings: !!r.is_accepting_bookings,
    manualNextStartOverride: (r.manual_next_start_override as string | null) ?? null,
    publicNote: (r.public_note as string | null) ?? null,
    adminNotes: (r.admin_notes as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  }));

  return rows.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
}
