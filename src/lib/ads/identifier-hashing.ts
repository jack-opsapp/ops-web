/**
 * Hashed user identifiers for Google's Data Manager API.
 *
 * Google matches an uploaded conversion to a signed-in click through a
 * SHA-256 of the normalised email: trimmed, lower-cased, and — for Gmail and
 * Googlemail addresses — with the dots in the local part removed (Gmail
 * ignores them, so "jack.sweet@gmail.com" and "jacksweet@gmail.com" are the
 * same inbox). Anything else is hashed as-is after trim + lowercase.
 *
 * Raw email never leaves this module; callers only see the hex digest.
 */
import { createHash } from "node:crypto";

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@") || at === value.length - 1) return null;
  let local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!domain.includes(".") || /\s/.test(value)) return null;
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  if (!local) return null;
  return `${local}@${domain}`;
}

/** SHA-256 hex digest of the normalised email, or null when it cannot be normalised. */
export function hashEmail(raw: string | null | undefined): string | null {
  const normalized = normalizeEmail(raw);
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}
