// src/lib/email/unsubscribe-token.ts
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET_ENV = "EMAIL_UNSUBSCRIBE_SECRET";

/**
 * Default token TTL is 365 days. Rotate by changing EMAIL_UNSUBSCRIBE_SECRET;
 * old tokens immediately become invalid (which is intentional during a
 * compromise rotation).
 */
const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const v = process.env[SECRET_ENV];
  if (!v || v.length < 32) {
    throw new Error(
      `${SECRET_ENV} must be set to a 32+ character random hex string. ` +
        `Generate via: openssl rand -hex 32`
    );
  }
  return v;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad), "base64");
}

interface SignOptions {
  email: string;
  list?: string;
  ttlMs?: number;
  now?: number;
}

interface VerifyResult {
  ok: true;
  email: string;
  list: string;
  expiresAt: number;
}

interface VerifyError {
  ok: false;
  reason: "malformed" | "bad_signature" | "expired";
}

export function signUnsubscribeToken({
  email,
  list = "global",
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now(),
}: SignOptions): string {
  const lowerEmail = email.trim().toLowerCase();
  const expiresAt = now + ttlMs;
  const payload = `${lowerEmail}|${list}|${expiresAt}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest();
  const sigB64 = base64url(sig);
  const payloadB64 = base64url(Buffer.from(payload, "utf8"));
  return `${payloadB64}.${sigB64}`;
}

export function verifyUnsubscribeToken(
  token: string,
  now: number = Date.now()
): VerifyResult | VerifyError {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, sigB64] = parts;
  let payloadStr: string;
  try {
    payloadStr = fromBase64url(payloadB64).toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const segs = payloadStr.split("|");
  if (segs.length !== 3) return { ok: false, reason: "malformed" };
  const [email, list, expiresAtStr] = segs;
  const expiresAt = Number(expiresAtStr);
  if (!email || !list || !Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };

  const expectedSig = createHmac("sha256", getSecret()).update(payloadStr).digest();
  let actualSig: Buffer;
  try {
    actualSig = fromBase64url(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (actualSig.length !== expectedSig.length) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(actualSig, expectedSig)) return { ok: false, reason: "bad_signature" };

  if (now > expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, email, list, expiresAt };
}

export function buildUnsubscribeUrl(opts: SignOptions, baseUrl?: string): string {
  const token = signUnsubscribeToken(opts);
  const base = baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
  return `${base.replace(/\/$/, "")}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}
