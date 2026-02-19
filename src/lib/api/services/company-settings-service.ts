/**
 * OPS Web - Company Settings Service
 *
 * Per-company feature configuration using Supabase.
 * Uses upsert-read pattern: getSettings creates defaults if row doesn't exist.
 */

import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";
import type { CompanySettings, UpdateCompanySettings } from "@/lib/types/pipeline";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): CompanySettings {
  return {
    companyId: row.company_id as string,
    autoGenerateTasks: (row.auto_generate_tasks as boolean) ?? false,
    followUpReminderDays: Number(row.follow_up_reminder_days ?? 3),
    gmailAutoLogEnabled: (row.gmail_auto_log_enabled as boolean) ?? true,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const CompanySettingsService = {
  /**
   * Get settings for a company. Creates default row if one doesn't exist.
   */
  async getSettings(companyId: string): Promise<CompanySettings> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("company_settings")
      .upsert(
        { company_id: companyId },
        { onConflict: "company_id", ignoreDuplicates: true }
      )
      .select()
      .single();

    if (error) {
      // If upsert+select doesn't return on ignoreDuplicates, fetch directly
      const { data: fetched, error: fetchError } = await supabase
        .from("company_settings")
        .select("*")
        .eq("company_id", companyId)
        .single();

      if (fetchError) throw new Error(`Failed to get company settings: ${fetchError.message}`);
      return mapFromDb(fetched);
    }

    return mapFromDb(data);
  },

  async updateSettings(
    companyId: string,
    updates: UpdateCompanySettings
  ): Promise<CompanySettings> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {};
    if (updates.autoGenerateTasks !== undefined) row.auto_generate_tasks = updates.autoGenerateTasks;
    if (updates.followUpReminderDays !== undefined) row.follow_up_reminder_days = updates.followUpReminderDays;
    if (updates.gmailAutoLogEnabled !== undefined) row.gmail_auto_log_enabled = updates.gmailAutoLogEnabled;

    const { data, error } = await supabase
      .from("company_settings")
      .update(row)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update company settings: ${error.message}`);
    return mapFromDb(data);
  },
};
