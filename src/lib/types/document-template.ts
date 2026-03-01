/**
 * OPS Web - Document Template Types
 *
 * Templates control field visibility and branding overrides for
 * invoices and estimates. Override fields inherit from portal_branding
 * when null.
 */

export type DocumentType = "invoice" | "estimate" | "both";

export interface FieldVisibility {
  showQuantities: boolean;
  showUnitPrices: boolean;
  showLineTotals: boolean;
  showDescriptions: boolean;
  showTax: boolean;
  showDiscount: boolean;
  showTerms: boolean;
  showFooter: boolean;
  showPaymentInfo: boolean;
  showFromSection: boolean;
  showToSection: boolean;
}

export interface DocumentTemplate extends FieldVisibility {
  id: string;
  companyId: string;
  name: string;
  documentType: DocumentType;
  isDefault: boolean;

  // Branding overrides (null = inherit from portal_branding)
  overrideLogoUrl: string | null;
  overrideAccentColor: string | null;
  overrideTemplate: "modern" | "classic" | "bold" | null;
  overrideThemeMode: "light" | "dark" | null;
  overrideFontCombo: "modern" | "classic" | "bold" | null;

  createdAt: string;
  updatedAt: string;
}

export type CreateDocumentTemplate = Omit<
  DocumentTemplate,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdateDocumentTemplate = Partial<CreateDocumentTemplate> & {
  id: string;
};

/** Default field visibility — all fields shown */
export const DEFAULT_FIELD_VISIBILITY: FieldVisibility = {
  showQuantities: true,
  showUnitPrices: true,
  showLineTotals: true,
  showDescriptions: true,
  showTax: true,
  showDiscount: true,
  showTerms: true,
  showFooter: true,
  showPaymentInfo: true,
  showFromSection: true,
  showToSection: true,
};
