/**
 * OPS Web - Document Template Service
 *
 * CRUD operations for document templates. Templates control field visibility
 * and branding overrides for invoices/estimates.
 *
 * Uses direct Supabase client calls (same pattern as portal-branding-tab).
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  DocumentTemplate,
  DocumentType,
  CreateDocumentTemplate,
} from "@/lib/types/document-template";

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const documentTemplateKeys = {
  all: ["documentTemplates"] as const,
  list: (companyId: string) =>
    [...documentTemplateKeys.all, "list", companyId] as const,
  detail: (id: string) =>
    [...documentTemplateKeys.all, "detail", id] as const,
  default: (companyId: string, docType: DocumentType) =>
    [...documentTemplateKeys.all, "default", companyId, docType] as const,
};

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapTemplateFromDb(row: Record<string, unknown>): DocumentTemplate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    documentType: row.document_type as DocumentType,
    isDefault: (row.is_default as boolean) ?? false,

    // Field visibility
    showQuantities: (row.show_quantities as boolean) ?? true,
    showUnitPrices: (row.show_unit_prices as boolean) ?? true,
    showLineTotals: (row.show_line_totals as boolean) ?? true,
    showDescriptions: (row.show_descriptions as boolean) ?? true,
    showTax: (row.show_tax as boolean) ?? true,
    showDiscount: (row.show_discount as boolean) ?? true,
    showTerms: (row.show_terms as boolean) ?? true,
    showFooter: (row.show_footer as boolean) ?? true,
    showPaymentInfo: (row.show_payment_info as boolean) ?? true,
    showFromSection: (row.show_from_section as boolean) ?? true,
    showToSection: (row.show_to_section as boolean) ?? true,

    // Branding overrides
    overrideLogoUrl: (row.override_logo_url as string) ?? null,
    overrideAccentColor: (row.override_accent_color as string) ?? null,
    overrideTemplate:
      (row.override_template as "modern" | "classic" | "bold") ?? null,
    overrideThemeMode:
      (row.override_theme_mode as "light" | "dark") ?? null,
    overrideFontCombo:
      (row.override_font_combo as "modern" | "classic" | "bold") ?? null,

    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapTemplateToDb(
  data: Partial<CreateDocumentTemplate>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.name !== undefined) row.name = data.name;
  if (data.documentType !== undefined) row.document_type = data.documentType;
  if (data.isDefault !== undefined) row.is_default = data.isDefault;

  // Field visibility
  if (data.showQuantities !== undefined) row.show_quantities = data.showQuantities;
  if (data.showUnitPrices !== undefined) row.show_unit_prices = data.showUnitPrices;
  if (data.showLineTotals !== undefined) row.show_line_totals = data.showLineTotals;
  if (data.showDescriptions !== undefined) row.show_descriptions = data.showDescriptions;
  if (data.showTax !== undefined) row.show_tax = data.showTax;
  if (data.showDiscount !== undefined) row.show_discount = data.showDiscount;
  if (data.showTerms !== undefined) row.show_terms = data.showTerms;
  if (data.showFooter !== undefined) row.show_footer = data.showFooter;
  if (data.showPaymentInfo !== undefined) row.show_payment_info = data.showPaymentInfo;
  if (data.showFromSection !== undefined) row.show_from_section = data.showFromSection;
  if (data.showToSection !== undefined) row.show_to_section = data.showToSection;

  // Branding overrides
  if (data.overrideLogoUrl !== undefined) row.override_logo_url = data.overrideLogoUrl;
  if (data.overrideAccentColor !== undefined) row.override_accent_color = data.overrideAccentColor;
  if (data.overrideTemplate !== undefined) row.override_template = data.overrideTemplate;
  if (data.overrideThemeMode !== undefined) row.override_theme_mode = data.overrideThemeMode;
  if (data.overrideFontCombo !== undefined) row.override_font_combo = data.overrideFontCombo;

  return row;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const DocumentTemplateService = {
  /**
   * Fetch all templates for a company.
   */
  async fetchTemplates(companyId: string): Promise<DocumentTemplate[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("document_templates")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to fetch templates: ${error.message}`);
    return (data ?? []).map(mapTemplateFromDb);
  },

  /**
   * Fetch a single template by ID.
   */
  async fetchTemplate(id: string): Promise<DocumentTemplate> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("document_templates")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch template: ${error.message}`);
    return mapTemplateFromDb(data);
  },

  /**
   * Create a new template. If isDefault is true, unset any existing default
   * for the same company+docType first (the unique partial index enforces this).
   */
  async createTemplate(
    data: CreateDocumentTemplate
  ): Promise<DocumentTemplate> {
    const supabase = requireSupabase();

    // If setting as default, clear existing default for this type
    if (data.isDefault) {
      await supabase
        .from("document_templates")
        .update({ is_default: false })
        .eq("company_id", data.companyId)
        .in(
          "document_type",
          data.documentType === "both"
            ? ["invoice", "estimate", "both"]
            : [data.documentType, "both"]
        )
        .eq("is_default", true);
    }

    const row = mapTemplateToDb(data);
    const { data: created, error } = await supabase
      .from("document_templates")
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`Failed to create template: ${error.message}`);
    return mapTemplateFromDb(created);
  },

  /**
   * Update an existing template. Handles default swap if needed.
   */
  async updateTemplate(
    id: string,
    data: Partial<CreateDocumentTemplate>
  ): Promise<DocumentTemplate> {
    const supabase = requireSupabase();

    // If setting as default, clear existing defaults first
    if (data.isDefault) {
      // Need to know the company and docType
      const existing = await DocumentTemplateService.fetchTemplate(id);
      const docType = data.documentType ?? existing.documentType;

      await supabase
        .from("document_templates")
        .update({ is_default: false })
        .eq("company_id", existing.companyId)
        .in(
          "document_type",
          docType === "both"
            ? ["invoice", "estimate", "both"]
            : [docType, "both"]
        )
        .eq("is_default", true)
        .neq("id", id);
    }

    const row = mapTemplateToDb(data);
    row.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from("document_templates")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update template: ${error.message}`);
    return mapTemplateFromDb(updated);
  },

  /**
   * Delete a template. FK on invoices/estimates is ON DELETE SET NULL.
   */
  async deleteTemplate(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("document_templates")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`Failed to delete template: ${error.message}`);
  },

  /**
   * Fetch the default template for a company and document type.
   * Returns null if no default is set.
   */
  async fetchDefaultTemplate(
    companyId: string,
    docType: "invoice" | "estimate"
  ): Promise<DocumentTemplate | null> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("document_templates")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_default", true)
      .in("document_type", [docType, "both"])
      .maybeSingle();

    if (error)
      throw new Error(`Failed to fetch default template: ${error.message}`);

    return data ? mapTemplateFromDb(data) : null;
  },
};
