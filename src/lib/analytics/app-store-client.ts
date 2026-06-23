import { SignJWT, importPKCS8 } from "jose";
import { parsePrivateKey } from "@/lib/firebase/parse-private-key";

const ASC_BASE = "https://api.appstoreconnect.apple.com";
const AUD = "appstoreconnect-v1";

/** True only when all four App Store Connect secrets are present. */
export function isAppStoreConfigured(): boolean {
  return !!(
    process.env.ASC_KEY_ID &&
    process.env.ASC_ISSUER_ID &&
    process.env.ASC_PRIVATE_KEY &&
    process.env.ASC_APP_ID
  );
}

/** The numeric App Store app id (adamId) the report request is scoped to. */
export function getAscAppId(): string {
  const id = process.env.ASC_APP_ID;
  if (!id) throw new Error("Missing ASC_APP_ID");
  return id;
}

/**
 * Mint a short-lived ES256 JWT for the App Store Connect API.
 * exp is 19 minutes out (Apple's hard cap is 20).
 */
export async function mintToken(): Promise<string> {
  const kid = process.env.ASC_KEY_ID;
  const iss = process.env.ASC_ISSUER_ID;
  const pem = parsePrivateKey(process.env.ASC_PRIVATE_KEY);
  if (!kid || !iss || !pem) {
    throw new Error("App Store Connect not configured (ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY)");
  }
  const key = await importPKCS8(pem, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuer(iss)
    .setIssuedAt(now)
    .setExpirationTime(now + 1140)
    .setAudience(AUD)
    .sign(key);
}

export interface AscFetchOpts {
  token?: string;
}

/** GET an ASC API path (or absolute URL) as JSON. */
export async function ascGet<T = unknown>(path: string, opts: AscFetchOpts = {}): Promise<T> {
  const token = opts.token ?? (await mintToken());
  const url = path.startsWith("http") ? path : `${ASC_BASE}${path}`;
  const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ASC GET ${path} -> ${res.status}: ${await safeText(res)}`);
  return (await res.json()) as T;
}

/** POST a body to an ASC API path as JSON. */
export async function ascPost<T = unknown>(path: string, body: unknown, opts: AscFetchOpts = {}): Promise<T> {
  const token = opts.token ?? (await mintToken());
  const res = await fetchWithBackoff(`${ASC_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ASC POST ${path} -> ${res.status}: ${await safeText(res)}`);
  return (await res.json()) as T;
}

/** Download a signed segment URL and gunzip it to a UTF-8 string. */
export async function downloadSegment(url: string): Promise<string> {
  const res = await fetchWithBackoff(url, {});
  if (!res.ok) throw new Error(`ASC segment download -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { gunzipSync } = await import("node:zlib");
  return gunzipSync(buf).toString("utf8");
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

/** fetch with exponential backoff + jitter on HTTP 429 (Apple rate limit). */
async function fetchWithBackoff(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 && attempt < 4) {
    const wait = Math.min(2000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 500);
    await new Promise((r) => setTimeout(r, wait));
    return fetchWithBackoff(url, init, attempt + 1);
  }
  return res;
}
