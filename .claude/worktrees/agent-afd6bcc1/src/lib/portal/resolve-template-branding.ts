/**
 * OPS Web - Template Branding Resolver
 *
 * Merges a PortalBranding base with DocumentTemplate overrides.
 * Each override field uses the template value if non-null,
 * otherwise inherits from portal_branding.
 *
 * The resolved branding feeds directly into generatePortalTheme().
 */

import type { PortalBranding } from "@/lib/types/portal";
import type { DocumentTemplate, FieldVisibility } from "@/lib/types/document-template";
import { DEFAULT_FIELD_VISIBILITY } from "@/lib/types/document-template";

/**
 * Resolve branding by merging portal_branding with document template overrides.
 * Returns a PortalBranding object suitable for generatePortalTheme().
 */
export function resolveTemplateBranding(
  portalBranding: PortalBranding,
  template: DocumentTemplate | null
): PortalBranding {
  if (!template) return portalBranding;

  return {
    ...portalBranding,
    logoUrl: template.overrideLogoUrl ?? portalBranding.logoUrl,
    accentColor: template.overrideAccentColor ?? portalBranding.accentColor,
    template: template.overrideTemplate ?? portalBranding.template,
    themeMode: template.overrideThemeMode ?? portalBranding.themeMode,
    fontCombo: template.overrideFontCombo ?? portalBranding.fontCombo,
  };
}

/**
 * Extract field visibility from a document template.
 * Returns all-true defaults if no template is provided.
 */
export function getFieldVisibility(
  template: DocumentTemplate | null
): FieldVisibility {
  if (!template) return DEFAULT_FIELD_VISIBILITY;

  return {
    showQuantities: template.showQuantities,
    showUnitPrices: template.showUnitPrices,
    showLineTotals: template.showLineTotals,
    showDescriptions: template.showDescriptions,
    showTax: template.showTax,
    showDiscount: template.showDiscount,
    showTerms: template.showTerms,
    showFooter: template.showFooter,
    showPaymentInfo: template.showPaymentInfo,
    showFromSection: template.showFromSection,
    showToSection: template.showToSection,
  };
}
