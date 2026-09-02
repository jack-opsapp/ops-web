/**
 * OPS Web - Portal Branding Defaults
 *
 * The single home for the `portal_branding` column defaults as the app
 * understands them. Mirrors the database defaults so a company that has never
 * opened Settings › Portal still renders a coherent branded surface.
 */

import type { PortalBranding } from "@/lib/types/portal";

/** Database default for `portal_branding.accent_color`. */
export const PORTAL_DEFAULT_ACCENT = "#417394";

/**
 * A fully-populated branding object equal to what the database would create
 * for a company with no `portal_branding` row yet. Read-only callers (public
 * hosted pages) use this instead of inserting a row on behalf of anonymous
 * traffic.
 */
export function defaultPortalBranding(companyId: string): PortalBranding {
  const now = new Date();
  return {
    id: "",
    companyId,
    logoUrl: null,
    accentColor: PORTAL_DEFAULT_ACCENT,
    template: "modern",
    themeMode: "dark",
    fontCombo: "modern",
    welcomeMessage: null,
    showQuantities: null,
    showUnitPrices: null,
    showLineTotals: null,
    showDescriptions: null,
    showTax: null,
    showDiscount: null,
    createdAt: now,
    updatedAt: now,
  };
}
