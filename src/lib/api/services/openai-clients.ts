// src/lib/api/services/openai-clients.ts
// Centralized OpenAI client factory — each usage context gets its own API key
// for billing separation, rate limit isolation, and cost attribution.
//
// All three fall back to OPENAI_API_KEY for backward compatibility.

import OpenAI from "openai";

let _importClient: OpenAI | null = null;
let _syncClient: OpenAI | null = null;
let _draftingClient: OpenAI | null = null;

/**
 * Sanitize an API key value read from process.env.
 *
 * POSIX shell sourcing of `.env.local` preserves a literal `\n` (backslash+n,
 * two characters) inside double-quoted values, and Vercel env-var injection
 * has historically produced trailing whitespace on copy-paste keys. Both
 * cause OpenAI to reject the request with 401 even though the key looks
 * right in the file. We strip both at the boundary.
 *
 * Exported so call sites that build their own OpenAI client (rather than
 * using one of the singletons below) can reuse the same defense.
 */
export function sanitizeApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Order: strip the literal `\n` suffix first (regex matches the two
  // characters backslash + n), then trim ambient whitespace. Repeat once
  // in case the value had both (e.g. `sk-...\n   `).
  const stripped = raw
    .replace(/\\n$/, "")
    .trim()
    .replace(/\\n$/, "")
    .trim();
  return stripped || undefined;
}

/**
 * OpenAI client for initial inbox scan (Phase A triage + Phase B deep extraction).
 * Env var: OPENAI_API_KEY_IMPORT → fallback: OPENAI_API_KEY
 */
export function getImportOpenAI(): OpenAI {
  if (!_importClient) {
    const apiKey = sanitizeApiKey(process.env.OPENAI_API_KEY_IMPORT) || sanitizeApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY_IMPORT or OPENAI_API_KEY");
    _importClient = new OpenAI({ apiKey });
  }
  return _importClient;
}

/**
 * OpenAI client for ongoing sync operations (stage evaluation, memory extraction,
 * writing profile analysis, unmatched email classification during sync).
 * Env var: OPENAI_API_KEY_SYNC → fallback: OPENAI_API_KEY
 */
export function getSyncOpenAI(): OpenAI {
  if (!_syncClient) {
    const apiKey = sanitizeApiKey(process.env.OPENAI_API_KEY_SYNC) || sanitizeApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY_SYNC or OPENAI_API_KEY");
    _syncClient = new OpenAI({ apiKey });
  }
  return _syncClient;
}

/**
 * OpenAI client for email draft generation (future — generates replies in user's voice).
 * Env var: OPENAI_API_KEY_DRAFTING → fallback: OPENAI_API_KEY
 */
export function getDraftingOpenAI(): OpenAI {
  if (!_draftingClient) {
    const apiKey = sanitizeApiKey(process.env.OPENAI_API_KEY_DRAFTING) || sanitizeApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY_DRAFTING or OPENAI_API_KEY");
    _draftingClient = new OpenAI({ apiKey });
  }
  return _draftingClient;
}
