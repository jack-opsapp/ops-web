// TYPES commit path — the seam catalog_setup_save does NOT cover.
//
// `catalog_setup_save` writes products (SELL) + one stock family (STOCK) per
// call, but trade & task types live in their own table (`task_types`) and on
// `companies`. This module commits accepted TYPES staging cards:
//
//   • task-type card (isTrade falsy) → UPSERT into `task_types`, MERGED by
//     lower(trim(display)) against the company's live rows so a baseline-seeded
//     default ("Repair", "Install") is never re-created (spec §4/§9/§16
//     read-merge). Re-running the wizard is naturally idempotent — an already-
//     present display skips.
//   • trade card (isTrade true) → records the company's trade as additive
//     provenance on `companies.industries` (best-effort, never blocking).
//
// WRITE PATH (verified against prod RLS 2026-06-14):
//   - `task_types` RLS = single `company_isolation` ALL policy
//     (`company_id = private.get_user_company_id()`, every role) → writable by
//     ANY company member through the accessToken (Firebase-bridged) client the
//     commit route already builds. No service-role escalation needed.
//   - `companies` UPDATE is admin-gated under the bridge (`company_admin_write`
//     requires current_user_is_admin), so the trade provenance write goes
//     through the SERVICE-ROLE client (explicit company_id) as a best-effort,
//     non-blocking side-effect — a non-admin operator must still be able to
//     stand up their task types.
//
// The pure planner (`planTaskTypeCommit`) holds all the merge/dedupe logic and
// is unit-tested without DB or network; the I/O wrappers are thin.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TypeFields } from "../staging-card";
import { getTradeLabel, isWizardTrade } from "../trade-list";

/** task_types.color is NOT NULL with this default — applied when a card omits one. */
export const DEFAULT_TASK_TYPE_COLOR = "#417394";

/** A ready-to-insert `task_types` row (snake_case wire shape). */
export interface TaskTypeInsertRow {
  company_id: string;
  display: string;
  color: string;
  is_default: boolean;
  display_order: number;
}

export interface TaskTypeCommitPlan {
  /** Brand-new task types to insert (deduped vs live rows AND within the batch). */
  inserts: TaskTypeInsertRow[];
  /** Cards that resolved to an existing/just-seen display → no-op (read-merge). */
  skipped: number;
  /** The selected trade slug (latest trade card), or null when none was picked. */
  trade: string | null;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * PURE merge planner. Partitions accepted TYPES card fields into the task_types
 * to insert (new, deduped) vs the ones that already exist (skipped), and
 * captures the trade selection. `display_order` continues past the company's
 * existing row count so new types sort after the seeded defaults.
 */
export function planTaskTypeCommit(
  cards: TypeFields[],
  existingDisplays: readonly string[],
  companyId: string,
): TaskTypeCommitPlan {
  const existing = new Set(existingDisplays.map(norm));
  const seen = new Set<string>();
  const inserts: TaskTypeInsertRow[] = [];
  let skipped = 0;
  let trade: string | null = null;
  let order = existingDisplays.length;

  for (const f of cards) {
    if (f.isTrade) {
      // Trade card → the company's trade, not a task_types row. Latest wins.
      const slug = f.display.trim();
      if (slug.length > 0) trade = slug;
      continue;
    }

    const display = f.display.trim();
    if (display.length === 0) continue; // a blank task-type card commits nothing

    const key = norm(display);
    if (existing.has(key) || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    inserts.push({
      company_id: companyId,
      display,
      color: f.color && f.color.trim().length > 0 ? f.color.trim() : DEFAULT_TASK_TYPE_COLOR,
      is_default: false,
      display_order: order++,
    });
  }

  return { inserts, skipped, trade };
}

export interface CommitTaskTypesResult {
  inserted: number;
  skipped: number;
  /** The captured trade slug (recorded separately, best-effort) or null. */
  trade: string | null;
  error: unknown;
}

/**
 * Read the company's live task types, plan the merge, and insert the new ones
 * through the accessToken (RLS-scoped) client. Idempotent: re-running merges.
 */
export async function commitTaskTypes(
  client: SupabaseClient,
  companyId: string,
  cards: TypeFields[],
): Promise<CommitTaskTypesResult> {
  const { data, error: readErr } = await client
    .from("task_types")
    .select("display")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  if (readErr) {
    return { inserted: 0, skipped: 0, trade: null, error: readErr };
  }

  const existing = (data ?? []).map((r) =>
    String((r as { display?: unknown }).display ?? ""),
  );
  const plan = planTaskTypeCommit(cards, existing, companyId);

  if (plan.inserts.length === 0) {
    return { inserted: 0, skipped: plan.skipped, trade: plan.trade, error: null };
  }

  const { error: insErr } = await client.from("task_types").insert(plan.inserts);
  if (insErr) {
    return { inserted: 0, skipped: plan.skipped, trade: plan.trade, error: insErr };
  }
  return {
    inserted: plan.inserts.length,
    skipped: plan.skipped,
    trade: plan.trade,
    error: null,
  };
}

/**
 * Record the company's trade as additive provenance on `companies.industries`
 * (the de-facto free-text "what this company does" list). Best-effort and
 * non-blocking: the trade label is appended only when absent (dedupe), and any
 * read/update failure is returned, never thrown — task-type setup must not hinge
 * on a company-row write the operator may not be permitted to make.
 *
 * Stores the human LABEL ("Roofing"), consistent with the existing free-text
 * values ("Carpentry", "Pest Control"), not the internal slug.
 */
export async function recordCompanyTrade(
  serviceDb: SupabaseClient,
  companyId: string,
  tradeSlug: string,
): Promise<{ recorded: boolean; error: unknown }> {
  const label = isWizardTrade(tradeSlug) ? getTradeLabel(tradeSlug) : tradeSlug;

  const { data, error: readErr } = await serviceDb
    .from("companies")
    .select("industries")
    .eq("id", companyId)
    .single();
  if (readErr) return { recorded: false, error: readErr };

  const current: string[] = Array.isArray((data as { industries?: unknown })?.industries)
    ? ((data as { industries: unknown[] }).industries as unknown[]).map((v) => String(v))
    : [];

  if (current.some((v) => norm(v) === norm(label))) {
    return { recorded: false, error: null };
  }

  const { error: updErr } = await serviceDb
    .from("companies")
    .update({ industries: [...current, label] })
    .eq("id", companyId);
  if (updErr) return { recorded: false, error: updErr };

  return { recorded: true, error: null };
}
