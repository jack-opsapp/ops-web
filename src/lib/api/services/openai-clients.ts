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
 * OpenAI client for initial inbox scan (Phase A triage + Phase B deep extraction).
 * Env var: OPENAI_API_KEY_IMPORT → fallback: OPENAI_API_KEY
 */
export function getImportOpenAI(): OpenAI {
  if (!_importClient) {
    const apiKey = process.env.OPENAI_API_KEY_IMPORT || process.env.OPENAI_API_KEY;
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
    const apiKey = process.env.OPENAI_API_KEY_SYNC || process.env.OPENAI_API_KEY;
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
    const apiKey = process.env.OPENAI_API_KEY_DRAFTING || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY_DRAFTING or OPENAI_API_KEY");
    _draftingClient = new OpenAI({ apiKey });
  }
  return _draftingClient;
}
