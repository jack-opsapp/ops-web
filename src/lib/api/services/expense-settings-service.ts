/**
 * OPS Web - Expense Settings Service
 *
 * Per-company expense configuration using Supabase.
 * getSettings reads the row if present and returns in-memory defaults otherwise —
 * creation is deferred to updateSettings, which is gated by the `expenses.approve`
 * RLS policy (see migration 016).
 */

import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExpenseSettings {
  companyId: string;
  reviewFrequency: "daily" | "weekly" | "biweekly" | "monthly";
  autoApproveThreshold: number | null;
  adminApprovalThreshold: number | null;
  requireReceiptPhoto: boolean;
  requireProjectAssignment: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateExpenseSettings {
  reviewFrequency?: "daily" | "weekly" | "biweekly" | "monthly";
  autoApproveThreshold?: number | null;
  adminApprovalThreshold?: number | null;
  requireReceiptPhoto?: boolean;
  requireProjectAssignment?: boolean;
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): ExpenseSettings {
  return {
    companyId: row.company_id as string,
    reviewFrequency: (row.review_frequency as ExpenseSettings["reviewFrequency"]) ?? "weekly",
    autoApproveThreshold: row.auto_approve_threshold != null ? Number(row.auto_approve_threshold) : null,
    adminApprovalThreshold: row.admin_approval_threshold != null ? Number(row.admin_approval_threshold) : null,
    requireReceiptPhoto: (row.require_receipt_photo as boolean) ?? true,
    requireProjectAssignment: (row.require_project_assignment as boolean) ?? false,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

function defaultSettings(companyId: string): ExpenseSettings {
  const now = new Date();
  return {
    companyId,
    reviewFrequency: "weekly",
    autoApproveThreshold: null,
    adminApprovalThreshold: null,
    requireReceiptPhoto: true,
    requireProjectAssignment: false,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const ExpenseSettingsService = {
  /**
   * Get expense settings for a company.
   * Returns in-memory defaults if no row exists — users without `expenses.approve`
   * cannot insert, so creation is deferred to updateSettings.
   */
  async getSettings(companyId: string): Promise<ExpenseSettings> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("expense_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) throw new Error(`Failed to get expense settings: ${error.message}`);
    if (!data) return defaultSettings(companyId);
    return mapFromDb(data);
  },

  /**
   * Update (or create) expense settings for a company.
   * Uses upsert so the first save from the settings UI creates the row.
   * RLS requires `expenses.approve` for both insert and update.
   */
  async updateSettings(
    companyId: string,
    updates: UpdateExpenseSettings
  ): Promise<ExpenseSettings> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = { company_id: companyId };
    if (updates.reviewFrequency !== undefined) row.review_frequency = updates.reviewFrequency;
    if (updates.autoApproveThreshold !== undefined) row.auto_approve_threshold = updates.autoApproveThreshold;
    if (updates.adminApprovalThreshold !== undefined) row.admin_approval_threshold = updates.adminApprovalThreshold;
    if (updates.requireReceiptPhoto !== undefined) row.require_receipt_photo = updates.requireReceiptPhoto;
    if (updates.requireProjectAssignment !== undefined) row.require_project_assignment = updates.requireProjectAssignment;
    row.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("expense_settings")
      .upsert(row, { onConflict: "company_id" })
      .select()
      .single();

    if (error) throw new Error(`Failed to update expense settings: ${error.message}`);
    return mapFromDb(data);
  },
};
