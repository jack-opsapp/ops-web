/**
 * OPS Web - Shared Supabase Helpers
 *
 * Common utilities used across all Supabase service files.
 * Extracted from opportunity-service.ts for DRY.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side override for requireSupabase().
 * When set (via setSupabaseOverride), all requireSupabase() calls return this
 * client instead of the Firebase-auth-backed browser client.
 * Used by API routes and cron jobs that have no Firebase user session.
 */
let _supabaseOverride: SupabaseClient | null = null;

export function setSupabaseOverride(client: SupabaseClient | null): void {
  _supabaseOverride = client;
}

/**
 * Returns a guaranteed Supabase client or throws if not configured.
 * In server contexts, returns the override client if one was set.
 */
export function requireSupabase(): SupabaseClient {
  if (_supabaseOverride) return _supabaseOverride;

  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your .env.local file."
    );
  }
  return client;
}

/**
 * Parse a value from the database into a Date or null.
 * Supabase returns dates as ISO-8601 strings.
 */
export function parseDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a value from the database into a required Date.
 * Falls back to the current time if the value is missing or invalid.
 */
export function parseDateRequired(value: unknown): Date {
  return parseDate(value) ?? new Date();
}
