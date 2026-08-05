import type { EmailProvider } from "./email-connection";

export type EmailSignatureSource = "ops" | "gmail" | "office_confirmed";

export interface EffectiveEmailSignature {
  source: EmailSignatureSource;
  html: string;
  text: string;
  hash: string;
}

export interface OpsEmailSignature {
  html: string;
  text: string;
}

export interface ProviderEmailSignature {
  source: Exclude<EmailSignatureSource, "ops">;
  html: string;
  text: string;
  fetchedAt: string;
}

export type EmailSignatureLayout = "logo-left" | "stacked";

/**
 * The builder's form state. Server-supplied on read — recovered from the saved
 * signature when OPS rendered it, otherwise prefilled from the operator's
 * profile and their company record.
 */
export interface EmailIdentityFields {
  name: string;
  title: string;
  companyName: string;
  phone: string;
  website: string;
  includeLogo: boolean;
  layout: EmailSignatureLayout;
}

export interface EmailSignatureSettingsResponse {
  connectionId: string;
  mailbox: string;
  provider: EmailProvider;
  effective: EffectiveEmailSignature | null;
  ops: OpsEmailSignature | null;
  providerSignature: ProviderEmailSignature | null;
  providerImportSupported: boolean;
  missing: boolean;
  providerImportStatus?: "refreshed" | "not_configured";
  /** When the operator last stood behind this identity. Null gates outreach. */
  confirmedAt: string | null;
  outreachSubject: string | null;
  /** Null hides the logo control entirely — there is nothing to toggle. */
  companyLogoUrl: string | null;
  fields: EmailIdentityFields;
}

export interface EmailSignatureConnectionDescriptor {
  id: string;
  mailbox: string;
  provider: EmailProvider;
  type: "company" | "individual";
}

export interface EmailSignatureConnectionsResponse {
  connections: EmailSignatureConnectionDescriptor[];
}

export interface EmailSignatureActorScope {
  companyId: string;
  userId: string;
}

export interface EmailSignatureScope {
  companyId: string;
  userId: string;
  connectionId: string;
}

/** Everything the operator can author. `companyName` is theirs to edit; the
 *  logo is not — the server always uses the company record's own image. */
export interface EmailIdentityFieldsInput {
  name: string;
  title?: string;
  companyName: string;
  phone?: string;
  website?: string;
}

/**
 * One save. Any subset may be present: the signature, the subject, or both.
 * Saving a signature IS confirming it.
 */
export interface SaveEmailIdentityInput extends EmailSignatureScope {
  fields?: EmailIdentityFieldsInput;
  includeLogo?: boolean;
  layout?: EmailSignatureLayout;
  outreachSubject?: string | null;
  /** Legacy freeform save, kept working for anything still calling it. */
  opsText?: string;
}

/** @deprecated Superseded by {@link SaveEmailIdentityInput}. */
export interface SaveEmailSignatureInput extends EmailSignatureScope {
  opsText: string;
}
