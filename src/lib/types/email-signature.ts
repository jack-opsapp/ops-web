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
  /** The company record's mark. Null and no uploaded mark hides the logo
   *  control entirely — there is nothing to toggle. */
  companyLogoUrl: string | null;
  /** The mark uploaded for this mailbox's signature. Beats the company logo
   *  wherever the signature renders. */
  signatureLogoUrl: string | null;
  fields: EmailIdentityFields;
}

export interface EmailSignatureConnectionDescriptor {
  id: string;
  mailbox: string;
  provider: EmailProvider;
  type: "company" | "individual";
  /**
   * Whether outreach on this mailbox would pass the identity gate for the
   * asking operator. Carried on the list so a caller can find the mailbox that
   * still needs attention without a read per mailbox.
   */
  identityConfirmed: boolean;
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

/**
 * A custom signature mark, sent as bytes rather than a URL. The server stores
 * it and owns the address — nothing a caller says can end up as an `<img src>`
 * in outbound mail.
 */
export interface UploadSignatureLogoInput extends EmailSignatureScope {
  /** Base64, with or without its data-url wrapper. */
  data: string;
  contentType: string;
}

/** @deprecated Superseded by {@link SaveEmailIdentityInput}. */
export interface SaveEmailSignatureInput extends EmailSignatureScope {
  opsText: string;
}
