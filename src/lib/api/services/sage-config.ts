import "server-only";

export type SageProviderEnvironment = "production" | "sandbox";

export interface SageCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: SageProviderEnvironment;
}

export interface SageWriteBoundary {
  environment: SageProviderEnvironment;
  businessId: string;
}

export const SAGE_API_BASE = "https://api.accounting.sage.com/v3.1";
export const SAGE_AUTHORIZE_URL =
  "https://www.sageone.com/oauth2/auth/central?filter=apiv3.1";
export const SAGE_TOKEN_URL = "https://oauth.accounting.sage.com/token";
export const SAGE_REVOKE_URL = "https://oauth.accounting.sage.com/revoke";

const DEFAULT_REDIRECT_URI =
  "https://app.opsapp.co/api/integrations/sage/callback";

function configured(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = configured(name);
  if (!value) {
    throw new Error(`${name} is missing. Sage integration is not configured.`);
  }
  return value;
}

function enabled(name: string): boolean {
  return configured(name)?.toLowerCase() === "true";
}

export function getSageProviderEnvironment(): SageProviderEnvironment {
  const raw = configured("SAGE_ACTIVE_PROFILE");
  if (!raw) {
    return process.env.NODE_ENV === "production" ? "production" : "sandbox";
  }

  const normalized = raw.toLowerCase();
  if (normalized === "production" || normalized === "sandbox") {
    return normalized;
  }

  throw new Error(
    `SAGE_ACTIVE_PROFILE is set to an invalid value "${raw}". Expected "production" or "sandbox".`
  );
}

export function getSageCredentials(
  environment: SageProviderEnvironment
): SageCredentials {
  const sandbox = environment === "sandbox";
  const clientIdName = sandbox ? "SAGE_SANDBOX_CLIENT_ID" : "SAGE_CLIENT_ID";
  const clientSecretName = sandbox
    ? "SAGE_SANDBOX_CLIENT_SECRET"
    : "SAGE_CLIENT_SECRET";
  const redirectName = sandbox
    ? "SAGE_SANDBOX_REDIRECT_URI"
    : "SAGE_REDIRECT_URI";

  return {
    clientId: required(clientIdName),
    clientSecret: required(clientSecretName),
    redirectUri: configured(redirectName) ?? DEFAULT_REDIRECT_URI,
    environment,
  };
}

export function getAllowedSageBusinessIds(
  environment: SageProviderEnvironment
): readonly string[] {
  if (environment === "production") return Object.freeze([]);

  const values = (configured("SAGE_SANDBOX_BUSINESS_IDS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return Object.freeze([...new Set(values)]);
}

export function assertSageWriteAllowed(
  input: SageWriteBoundary
): SageWriteBoundary {
  const businessId = input.businessId.trim();
  if (!businessId) throw new Error("Sage business id is required for writes.");
  if (!enabled("ACCOUNTING_WRITE_ENABLED")) {
    throw new Error("ACCOUNTING_WRITE_ENABLED must be true for Sage writes.");
  }
  if (!enabled("SAGE_WRITE_ENABLED")) {
    throw new Error("SAGE_WRITE_ENABLED must be true for Sage writes.");
  }

  if (input.environment === "production") {
    if (!enabled("SAGE_PRODUCTION_WRITE_ENABLED")) {
      throw new Error(
        "SAGE_PRODUCTION_WRITE_ENABLED must be true for production Sage writes."
      );
    }
  } else {
    const allowed = getAllowedSageBusinessIds("sandbox");
    if (allowed.length === 0 || !allowed.includes(businessId)) {
      throw new Error(
        "Sage sandbox business is not present in SAGE_SANDBOX_BUSINESS_IDS allow-list."
      );
    }
  }

  return { environment: input.environment, businessId };
}
