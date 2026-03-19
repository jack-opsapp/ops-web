/**
 * OPS Web - Email Template Service
 *
 * CRUD operations for company email templates.
 * Uses Supabase client-side with RLS for company scoping.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  EmailTemplate,
  CreateEmailTemplate,
  UpdateEmailTemplate,
} from "../../types/email-template";

// ─── Row → Model Mapping ────────────────────────────────────────────────────

function rowToTemplate(row: Record<string, unknown>): EmailTemplate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    subject: row.subject as string,
    body: row.body as string,
    category: row.category as EmailTemplate["category"],
    sortOrder: row.sort_order as number,
    isActive: row.is_active as boolean,
    createdBy: (row.created_by as string) || null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const EmailTemplateService = {
  /**
   * Fetch all active templates for a company, ordered by category + sort_order.
   */
  async getTemplates(companyId: string): Promise<EmailTemplate[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_templates")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []).map(rowToTemplate);
  },

  /**
   * Fetch all templates (including inactive) for Settings management.
   */
  async getAllTemplates(companyId: string): Promise<EmailTemplate[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_templates")
      .select("*")
      .eq("company_id", companyId)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []).map(rowToTemplate);
  },

  /**
   * Fetch a single template by ID.
   */
  async getTemplate(id: string): Promise<EmailTemplate> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_templates")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    return rowToTemplate(data);
  },

  /**
   * Create a new template.
   */
  async createTemplate(input: CreateEmailTemplate): Promise<EmailTemplate> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_templates")
      .insert({
        company_id: input.companyId,
        name: input.name,
        subject: input.subject,
        body: input.body,
        category: input.category,
        sort_order: input.sortOrder ?? 0,
        created_by: input.createdBy ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return rowToTemplate(data);
  },

  /**
   * Update an existing template.
   */
  async updateTemplate(
    id: string,
    input: UpdateEmailTemplate
  ): Promise<EmailTemplate> {
    const supabase = requireSupabase();

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.subject !== undefined) updateData.subject = input.subject;
    if (input.body !== undefined) updateData.body = input.body;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.sortOrder !== undefined) updateData.sort_order = input.sortOrder;
    if (input.isActive !== undefined) updateData.is_active = input.isActive;

    const { data, error } = await supabase
      .from("email_templates")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return rowToTemplate(data);
  },

  /**
   * Soft-delete a template (set is_active = false).
   */
  async deleteTemplate(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("email_templates")
      .update({ is_active: false })
      .eq("id", id);

    if (error) throw error;
  },

  /**
   * Hard-delete a template (permanent removal).
   */
  async hardDeleteTemplate(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("email_templates")
      .delete()
      .eq("id", id);

    if (error) throw error;
  },
};
