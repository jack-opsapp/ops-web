import { SignJWT, importPKCS8 } from "jose";
import { parsePrivateKey } from "@/lib/firebase/parse-private-key";

interface GoogleServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
}

interface CachedToken {
  scope: string;
  value: string;
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;

function parseJsonCredentials(value: string): GoogleServiceAccountCredentials {
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
  return { clientEmail, privateKey };
}

export function getGoogleAnalyticsReaderCredentials(
  environment: NodeJS.ProcessEnv = process.env
): GoogleServiceAccountCredentials {
  const json =
    environment.SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON ??
    environment.GA4_SERVICE_ACCOUNT_JSON;
  if (json) return parseJsonCredentials(json);

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
    return { clientEmail, privateKey };
  }

  if (environment.FIREBASE_ADMIN_SERVICE_ACCOUNT) {
    return parseJsonCredentials(environment.FIREBASE_ADMIN_SERVICE_ACCOUNT);
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
