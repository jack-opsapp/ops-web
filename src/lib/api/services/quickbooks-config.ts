/**
 * OPS Web - QuickBooks Environment Config (single source of truth)
 *
 * Centralizes resolution of the Intuit OAuth credentials, redirect URI, and
 * environment → API base-host. Every QuickBooks surface (OAuth init, callback,
 * pull service, import route) reads this so there is exactly one place that
 * decides production vs sandbox and exactly one place that fails loud when the
 * environment is half-configured. Connecting a REAL production company file in
 * read-only mode (Canpro) must never silently fall back to sandbox or to a
 * mismatched redirect URI.
 */

export type QuickBooksEnvironment = "production" | "sandbox";

export interface QuickBooksConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QuickBooksEnvironment;
  /** Intuit Accounting API base host, chosen by environment. */
  apiBaseHost: string;
}

const PRODUCTION_API_HOST = "https://quickbooks.api.intuit.com";
const SANDBOX_API_HOST = "https://sandbox-quickbooks.api.intuit.com";

const DEFAULT_REDIRECT_URI =
  "https://app.opsapp.co/api/integrations/quickbooks/callback";

function resolveEnvironment(raw: string | undefined): QuickBooksEnvironment {
  // Unset → sandbox (dev safety). An explicit invalid value is a hard error.
  if (raw === undefined || raw.trim() === "") return "sandbox";
  const value = raw.trim().toLowerCase();
  if (value === "production" || value === "sandbox") {
    return value as QuickBooksEnvironment;
  }
  throw new Error(
    `QB_ENVIRONMENT is set to an invalid value "${raw}". Expected "production" or "sandbox".`,
  );
}

/**
 * Resolve and validate the QuickBooks config. Throws on any missing required
 * value so misconfiguration surfaces immediately rather than at OAuth-exchange
 * or first-pull time.
 */
export function getQuickBooksConfig(): QuickBooksConfig {
  const clientId = process.env.QB_CLIENT_ID?.trim();
  const clientSecret = process.env.QB_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.QB_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  const environment = resolveEnvironment(process.env.QB_ENVIRONMENT);

  if (!clientId) {
    throw new Error(
      "QB_CLIENT_ID is missing. QuickBooks integration is not configured.",
    );
  }
  if (!clientSecret) {
    throw new Error(
      "QB_CLIENT_SECRET is missing. QuickBooks integration is not configured.",
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    environment,
    apiBaseHost:
      environment === "production" ? PRODUCTION_API_HOST : SANDBOX_API_HOST,
  };
}
