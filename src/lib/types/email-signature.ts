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

export interface EmailSignatureSettingsResponse {
  connectionId: string;
  mailbox: string;
  provider: EmailProvider;
  effective: EffectiveEmailSignature | null;
  ops: OpsEmailSignature | null;
  providerSignature: ProviderEmailSignature | null;
  providerImportSupported: boolean;
  missing: boolean;
}

export interface EmailSignatureScope {
  companyId: string;
  userId: string;
  connectionId: string;
}

export interface SaveEmailSignatureInput extends EmailSignatureScope {
  opsText: string;
}
