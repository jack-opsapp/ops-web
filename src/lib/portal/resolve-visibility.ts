/**
 * Resolve document field visibility for portal rendering.
 * Portal branding overrides (non-null) take precedence over document template settings.
 */

import type { PortalBranding } from "@/lib/types/portal";

export interface PortalFieldVisibility {
  showQuantities: boolean;
  showUnitPrices: boolean;
  showLineTotals: boolean;
  showDescriptions: boolean;
  showTax: boolean;
  showDiscount: boolean;
}

export function resolvePortalVisibility(
  branding: PortalBranding,
  templateVisibility?: {
    showQuantities?: boolean;
    showUnitPrices?: boolean;
    showLineTotals?: boolean;
    showDescriptions?: boolean;
    showTax?: boolean;
    showDiscount?: boolean;
  } | null
): PortalFieldVisibility {
  const tmpl = templateVisibility ?? {};

  return {
    showQuantities: branding.showQuantities ?? tmpl.showQuantities ?? true,
    showUnitPrices: branding.showUnitPrices ?? tmpl.showUnitPrices ?? true,
    showLineTotals: branding.showLineTotals ?? tmpl.showLineTotals ?? true,
    showDescriptions: branding.showDescriptions ?? tmpl.showDescriptions ?? true,
    showTax: branding.showTax ?? tmpl.showTax ?? true,
    showDiscount: branding.showDiscount ?? tmpl.showDiscount ?? true,
  };
}
