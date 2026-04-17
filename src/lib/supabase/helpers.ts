/**
 * OPS Web - Shared Supabase Helpers
 *
 * Common utilities used across all Supabase service files.
 * Extracted from opportunity-service.ts for DRY.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-async-context supabase override. Each async execution chain (a single
 * request, an `after()` callback, a cron tick) gets its own storage slot, so
 * concurrent server work can hold different clients without racing.
 *
 * This replaces a module-level variable that was being clobbered when any
 * concurrent route's `finally { setSupabaseOverride(null) }` fired mid-execution
 * during a long-running `after()` background job. That race caused background
 * imports to fall through to the anon browser client and fail every subsequent
 * write against RLS.
 */
const supabaseStorage = new AsyncLocalStorage<SupabaseClient>();

/**
 * Legacy module-level override. Retained so existing call sites using the
 * `setSupabaseOverride(x) / finally setSupabaseOverride(null)` pattern keep
 * working. Any code path that runs concurrently with `after()` callbacks — or
 * inside one — must migrate to `runWithSupabase` for race safety.
 */
let _legacyOverride: SupabaseClient | null = null;

/**
 * Run `fn` with a specific Supabase client bound to the current async context.
 * The client is visible to `requireSupabase()` anywhere inside `fn` (including
 * awaited calls, `after()` continuations, and nested promises) but is invisible
 * to concurrent async chains. Prefer this over `setSupabaseOverride` for any
 * background work.
 */
export function runWithSupabase<T>(
  client: SupabaseClient,
  fn: () => Promise<T>
): Promise<T> {
  return supabaseStorage.run(client, fn);
}

/**
 * Legacy: sets a module-level override that all concurrent `requireSupabase()`
 * calls across the process will see. Not race-safe in the presence of
 * `after()` background work. Prefer `runWithSupabase`.
 */
export function setSupabaseOverride(client: SupabaseClient | null): void {
  _legacyOverride = client;
}

/**
 * Returns a guaranteed Supabase client or throws if not configured.
 *
 * Resolution order:
 *   1. AsyncLocalStorage binding from `runWithSupabase()` — race-safe
 *   2. Legacy module-level override from `setSupabaseOverride()` — not race-safe
 *   3. The Firebase-auth-backed browser client
 */
export function requireSupabase(): SupabaseClient {
  const scoped = supabaseStorage.getStore();
  if (scoped) return scoped;

  if (_legacyOverride) return _legacyOverride;

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
