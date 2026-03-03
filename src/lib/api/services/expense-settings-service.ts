/**
 * OPS Web - Expense Settings Service
 *
 * Per-company expense configuration using Supabase.
 * Uses upsert-read pattern: getSettings creates defaults if row doesn't exist.
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

// ─── Service ──────────────────────────────────────────────────────────────────

export const ExpenseSettingsService = {
  /**
   * Get expense settings for a company. Creates default row if one doesn't exist.
   */
  async getSettings(companyId: string): Promise<ExpenseSettings> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("expense_settings")
      .upsert(
        { company_id: companyId },
        { onConflict: "company_id", ignoreDuplicates: true }
      )
      .select()
      .single();

    if (error) {
      const { data: fetched, error: fetchError } = await supabase
        .from("expense_settings")
        .select("*")
        .eq("company_id", companyId)
        .single();

      if (fetchError) throw new Error(`Failed to get expense settings: ${fetchError.message}`);
      return mapFromDb(fetched);
    }

    return mapFromDb(data);
  },

  async updateSettings(
    companyId: string,
    updates: UpdateExpenseSettings
  ): Promise<ExpenseSettings> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {};
    if (updates.reviewFrequency !== undefined) row.review_frequency = updates.reviewFrequency;
    if (updates.autoApproveThreshold !== undefined) row.auto_approve_threshold = updates.autoApproveThreshold;
    if (updates.adminApprovalThreshold !== undefined) row.admin_approval_threshold = updates.adminApprovalThreshold;
    if (updates.requireReceiptPhoto !== undefined) row.require_receipt_photo = updates.requireReceiptPhoto;
    if (updates.requireProjectAssignment !== undefined) row.require_project_assignment = updates.requireProjectAssignment;

    const { data, error } = await supabase
      .from("expense_settings")
      .update(row)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update expense settings: ${error.message}`);
    return mapFromDb(data);
  },
};
