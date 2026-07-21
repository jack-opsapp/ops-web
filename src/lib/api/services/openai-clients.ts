// src/lib/api/services/openai-clients.ts
// Centralized OpenAI client factory — each usage context gets its own API key
// for billing separation, rate limit isolation, and cost attribution.
//
// Specialized email clients fall back to OPENAI_API_KEY for backward compatibility.

import OpenAI from "openai";
import { createMonitoredOpenAIFetch } from "./openai-monitoring";

let _importClient: OpenAI | null = null;
let _syncClient: OpenAI | null = null;
let _draftingClient: OpenAI | null = null;
const workloadClients = new Map<string, OpenAI>();

type OpenAIKeyEnvironment =
  | "OPENAI_API_KEY"
  | "OPENAI_API_KEY_IMPORT"
  | "OPENAI_API_KEY_SYNC"
  | "OPENAI_API_KEY_DRAFTING";

interface OpenAIWorkloadClientOptions {
  workload: string;
  primaryKeyEnvironment?: Exclude<OpenAIKeyEnvironment, "OPENAI_API_KEY">;
  timeout?: number;
}

/**
 * Sanitize an API key value read from process.env.
 *
 * POSIX shell sourcing of `.env.local` preserves a literal `\n` (backslash+n,
 * two characters) inside double-quoted values, and Vercel env-var injection
 * has historically produced trailing whitespace on copy-paste keys. Both
 * cause OpenAI to reject the request with 401 even though the key looks
 * right in the file. We strip both at the boundary.
 *
 * Exported so configuration guards can use the same boundary normalization.
 */
export function sanitizeApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Order: strip the literal `\n` suffix first (regex matches the two
  // characters backslash + n), then trim ambient whitespace. Repeat once
  // in case the value had both (e.g. `sk-...\n   `).
  const stripped = raw.replace(/\\n$/, "").trim().replace(/\\n$/, "").trim();
  return stripped || undefined;
}

function resolveApiKey(
  primaryKeyEnvironment?: Exclude<OpenAIKeyEnvironment, "OPENAI_API_KEY">
): { apiKey: string; keySource: OpenAIKeyEnvironment } {
  if (primaryKeyEnvironment) {
    const specialized = sanitizeApiKey(process.env[primaryKeyEnvironment]);
    if (specialized) {
      return { apiKey: specialized, keySource: primaryKeyEnvironment };
    }
  }

  const shared = sanitizeApiKey(process.env.OPENAI_API_KEY);
  if (shared) return { apiKey: shared, keySource: "OPENAI_API_KEY" };

  throw new Error(
    primaryKeyEnvironment
      ? `Missing ${primaryKeyEnvironment} or OPENAI_API_KEY`
      : "Missing OPENAI_API_KEY"
  );
}

/**
 * Canonical constructor boundary for every production OpenAI workload.
 *
 * `keySource` is the environment-variable name only. Secret key material is
 * never compared, hashed, logged, or persisted.
 */
export function getOpenAIForWorkload({
  workload,
  primaryKeyEnvironment,
  timeout,
}: OpenAIWorkloadClientOptions): OpenAI {
  const { apiKey, keySource } = resolveApiKey(primaryKeyEnvironment);
  const cacheKey = `${workload}:${keySource}:${timeout ?? "default"}`;
  const existing = workloadClients.get(cacheKey);
  if (existing) return existing;

  const client = new OpenAI({
    apiKey,
    ...(timeout ? { timeout } : {}),
    fetch: createMonitoredOpenAIFetch({ keySource, workload }),
  });
  workloadClients.set(cacheKey, client);
  return client;
}

/**
 * OpenAI client for initial inbox scan (Phase A triage + Phase B deep extraction).
 * Env var: OPENAI_API_KEY_IMPORT → fallback: OPENAI_API_KEY
 */
export function getImportOpenAI(): OpenAI {
  if (!_importClient) {
    _importClient = getOpenAIForWorkload({
      workload: "email_import",
      primaryKeyEnvironment: "OPENAI_API_KEY_IMPORT",
    });
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
    _syncClient = getOpenAIForWorkload({
      workload: "email_sync",
      primaryKeyEnvironment: "OPENAI_API_KEY_SYNC",
    });
  }
  return _syncClient;
}

/**
 * OpenAI client for email draft generation (future — generates replies in user's voice).
 * Env var: OPENAI_API_KEY_DRAFTING → fallback: OPENAI_API_KEY
 */
export function getDraftingOpenAI(): OpenAI {
  if (!_draftingClient) {
    _draftingClient = getOpenAIForWorkload({
      workload: "email_drafting",
      primaryKeyEnvironment: "OPENAI_API_KEY_DRAFTING",
    });
  }
  return _draftingClient;
}

export function resetOpenAIClientsForTests(): void {
  _importClient = null;
  _syncClient = null;
  _draftingClient = null;
  workloadClients.clear();
}
