/**
 * GET /api/portal/estimates/[id]
 *
 * Fetches a single estimate with line items for portal display.
 * Also marks the estimate as viewed (first view only).
 * Includes document template if assigned.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePortalSession,
  isErrorResponse,
} from "@/lib/api/portal-api-helpers";
import { PortalService } from "@/lib/api/services/portal-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { DocumentTemplate } from "@/lib/types/document-template";

function mapTemplateFromDb(row: Record<string, unknown>): DocumentTemplate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    documentType: row.document_type as DocumentTemplate["documentType"],
    isDefault: (row.is_default as boolean) ?? false,
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
    overrideLogoUrl: (row.override_logo_url as string) ?? null,
    overrideAccentColor: (row.override_accent_color as string) ?? null,
    overrideTemplate: (row.override_template as DocumentTemplate["overrideTemplate"]) ?? null,
    overrideThemeMode: (row.override_theme_mode as DocumentTemplate["overrideThemeMode"]) ?? null,
    overrideFontCombo: (row.override_font_combo as DocumentTemplate["overrideFontCombo"]) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requirePortalSession(req);
    if (isErrorResponse(result)) return result;
    const session = result;

    const { id } = await params;

    // Preview mode: return demo estimate
    if (session.isPreview) {
      const { getDemoEstimateDetail } = await import("@/lib/api/services/portal-demo-data");
      const demoEstimate = getDemoEstimateDetail(id);
      if (!demoEstimate) {
        return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
      }
      return NextResponse.json(demoEstimate);
    }

    // Fetch estimate with line items (verifies client ownership)
    const estimate = await PortalService.getEstimateForPortal(
      id,
      session.clientId
    );

    // Mark as viewed in the background (don't block the response)
    PortalService.markEstimateViewed(id).catch((err) => {
      console.error("[portal/estimates] Failed to mark viewed:", err);
    });

    // Fetch template if assigned
    let template: DocumentTemplate | null = null;
    if (estimate.templateId) {
      const supabase = getServiceRoleClient();
      const { data } = await supabase
        .from("document_templates")
        .select("*")
        .eq("id", estimate.templateId)
        .maybeSingle();
      if (data) template = mapTemplateFromDb(data);
    }

    return NextResponse.json({ ...estimate, template });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch estimate";

    if (message.includes("Access denied")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("[portal/estimates/[id]] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
