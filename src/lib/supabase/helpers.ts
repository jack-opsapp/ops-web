/**
 * OPS Web - Shared Supabase Helpers
 *
 * Common utilities used across all Supabase service files.
 * Extracted from opportunity-service.ts for DRY.
 */

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
 *
 * Initialized lazily and guarded so this file stays client-safe — service
 * modules that depend on helpers.ts end up in the browser bundle via other
 * imports, and Next.js stubs `async_hooks` to `false` for the client.
 */
type SupabaseStorage = {
  getStore: () => SupabaseClient | undefined;
  run: <T>(store: SupabaseClient, callback: () => Promise<T>) => Promise<T>;
};

let _storage: SupabaseStorage | null = null;

function getStorage(): SupabaseStorage | null {
  if (_storage) return _storage;
  if (typeof window !== "undefined") return null; // browser — no ALS
  try {
    // `async_hooks` is Node-only; Next.js elides it from client bundles.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("async_hooks") as typeof import("async_hooks");
    if (typeof mod.AsyncLocalStorage !== "function") return null;
    _storage = new mod.AsyncLocalStorage<SupabaseClient>() as unknown as SupabaseStorage;
    return _storage;
  } catch {
    return null;
  }
}

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
 *
 * If AsyncLocalStorage is unavailable (e.g., the browser bundle accidentally
 * reaches this path), falls back to the legacy module-level override so calls
 * don't fail outright — but race safety is forfeited in that mode.
 */
export function runWithSupabase<T>(
  client: SupabaseClient,
  fn: () => Promise<T>
): Promise<T> {
  const storage = getStorage();
  if (storage) return storage.run(client, fn);

  const prev = _legacyOverride;
  _legacyOverride = client;
  return fn().finally(() => {
    _legacyOverride = prev;
  });
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
  const storage = getStorage();
  const scoped = storage?.getStore();
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

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a value from the database into a Date or null.
 *
 * Supabase returns DATE columns as plain `YYYY-MM-DD` strings and TIMESTAMPTZ
 * columns as full ISO-8601 strings. `new Date("2026-03-25")` interprets the
 * plain form as UTC midnight, which renders as the previous day in any
 * timezone west of UTC (e.g. `Mar 24` in Pacific). For date-only values we
 * construct a local-midnight Date so calendar-day semantics are preserved
 * across the user's timezone.
 */
export function parseDate(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const m = DATE_ONLY_PATTERN.exec(value);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
  }
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
