/**
 * OPS Web - Supabase Service-Role Client
 *
 * For server-side contexts (API routes, cron jobs) where Firebase Auth
 * is unavailable. Uses the SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
 *
 * NEVER import this from client-side code.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;

/**
 * Returns a Supabase client using the service-role key.
 * Suitable for server-side API routes and cron jobs.
 */
export function getServiceRoleClient(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}
