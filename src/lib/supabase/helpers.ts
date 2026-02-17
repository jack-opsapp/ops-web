/**
 * OPS Web - Shared Supabase Helpers
 *
 * Common utilities used across all Supabase service files.
 * Extracted from opportunity-service.ts for DRY.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a guaranteed Supabase client or throws if not configured.
 */
export function requireSupabase(): SupabaseClient {
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
