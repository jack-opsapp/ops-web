import { SignJWT, importPKCS8 } from "jose";
import { parsePrivateKey } from "@/lib/firebase/parse-private-key";

interface GoogleServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  /**
   * Which environment variable family supplied these credentials. Logged (name
   * only, never key material) at every token mint so a PERMISSION_DENIED on a
   * GA4 property or Search Console site can be traced to the identity actually
   * in use — the Firebase admin account is the live fallback and needs its own
   * property grants (bug f3c0f556).
   */
  source:
    | "SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON"
    | "GA4_SERVICE_ACCOUNT_JSON"
    | "SEARCH_CONSOLE_SERVICE_ACCOUNT_CLIENT_EMAIL"
    | "GA4_SERVICE_ACCOUNT_CLIENT_EMAIL"
    | "FIREBASE_ADMIN_SERVICE_ACCOUNT"
    | "FIREBASE_ADMIN_CLIENT_EMAIL";
}

interface CachedToken {
  scope: string;
  value: string;
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;

function parseJsonCredentials(
  value: string,
  source: GoogleServiceAccountCredentials["source"]
): GoogleServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid Google analytics service-account JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Google analytics service-account JSON");
  }
  const record = parsed as Record<string, unknown>;
  const clientEmail = record.client_email;
  const privateKey = parsePrivateKey(
    typeof record.private_key === "string" ? record.private_key : undefined
  );
  if (
    typeof clientEmail !== "string" ||
    !clientEmail.endsWith(".iam.gserviceaccount.com") ||
    !privateKey
  ) {
    throw new Error("Incomplete Google analytics service-account credentials");
  }
  return { clientEmail, privateKey, source };
}

export function getGoogleAnalyticsReaderCredentials(
  environment: NodeJS.ProcessEnv = process.env
): GoogleServiceAccountCredentials {
  const json =
    environment.SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON ??
    environment.GA4_SERVICE_ACCOUNT_JSON;
  if (json) {
    return parseJsonCredentials(
      json,
      json === environment.SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON
        ? "SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON"
        : "GA4_SERVICE_ACCOUNT_JSON"
    );
  }

  const clientEmail =
    environment.SEARCH_CONSOLE_SERVICE_ACCOUNT_CLIENT_EMAIL ??
    environment.GA4_SERVICE_ACCOUNT_CLIENT_EMAIL;
  const privateKey = parsePrivateKey(
    environment.SEARCH_CONSOLE_SERVICE_ACCOUNT_PRIVATE_KEY ??
      environment.GA4_SERVICE_ACCOUNT_PRIVATE_KEY
  );
  if (clientEmail && privateKey) {
    if (!clientEmail.endsWith(".iam.gserviceaccount.com")) {
      throw new Error("Invalid Google analytics reader service-account email");
    }
    return {
      clientEmail,
      privateKey,
      source:
        clientEmail === environment.SEARCH_CONSOLE_SERVICE_ACCOUNT_CLIENT_EMAIL
          ? "SEARCH_CONSOLE_SERVICE_ACCOUNT_CLIENT_EMAIL"
          : "GA4_SERVICE_ACCOUNT_CLIENT_EMAIL",
    };
  }

  if (environment.FIREBASE_ADMIN_SERVICE_ACCOUNT) {
    return parseJsonCredentials(
      environment.FIREBASE_ADMIN_SERVICE_ACCOUNT,
      "FIREBASE_ADMIN_SERVICE_ACCOUNT"
    );
  }

  const firebaseClientEmail = environment.FIREBASE_ADMIN_CLIENT_EMAIL;
  const firebasePrivateKey = parsePrivateKey(
    environment.FIREBASE_ADMIN_PRIVATE_KEY
  );
  if (firebaseClientEmail && firebasePrivateKey) {
    if (!firebaseClientEmail.endsWith(".iam.gserviceaccount.com")) {
      throw new Error("Invalid Google analytics reader service-account email");
    }
    return {
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey,
      source: "FIREBASE_ADMIN_CLIENT_EMAIL",
    };
  }

  throw new Error(
    "Missing dedicated Google analytics reader service-account credentials"
  );
}

export async function getGoogleServiceAccountAccessToken(
  scope: string,
  options: {
    environment?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    nowMs?: number;
  } = {}
): Promise<string> {
  const nowMs = options.nowMs ?? Date.now();
  if (
    cachedToken?.scope === scope &&
    cachedToken.expiresAtMs > nowMs + 60_000
  ) {
    return cachedToken.value;
  }

  const credentials = getGoogleAnalyticsReaderCredentials(
    options.environment ?? process.env
  );
  // Names only — never the email, never key material. One line per token mint
  // (the cache check above means once per cold start per scope) is what makes
  // a property-permission failure traceable to an identity (bug f3c0f556).
  console.log(
    `[google-analytics-reader] credentials source: ${credentials.source}`
  );
  const issuedAt = Math.floor(nowMs / 1_000);
  const key = await importPKCS8(credentials.privateKey, "RS256");
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(credentials.clientEmail)
    .setSubject(credentials.clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3_600)
    .sign(key);

  const response = await (options.fetchImpl ?? fetch)(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Google OAuth token request failed (${response.status})`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (
    typeof body.access_token !== "string" ||
    typeof body.expires_in !== "number"
  ) {
    throw new Error("Google OAuth token response was malformed");
  }
  cachedToken = {
    scope,
    value: body.access_token,
    expiresAtMs: nowMs + body.expires_in * 1_000,
  };
  return cachedToken.value;
}

export function resetGoogleServiceAccountTokenCacheForTests(): void {
  cachedToken = null;
}
