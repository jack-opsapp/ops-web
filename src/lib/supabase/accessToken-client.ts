import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-request Supabase client that carries the operator's verified Firebase
 * idToken as the access token, so SECURITY INVOKER RPCs see `auth.jwt()->>'email'`
 * and pass their company-scope guard.
 *
 * `catalog_setup_save` is `prosecdef = false` (SECURITY INVOKER) and rejects with
 * `company_scope_mismatch` unless `p_company_id == private.get_user_company_id()`,
 * where `get_user_company_id() = SELECT company_id FROM users WHERE email =
 * auth.jwt()->>'email'`. The service-role client CANNOT call it (no JWT email).
 * The browser client.ts uses this same Firebase→Supabase bridge for RLS, so the
 * idToken's `email` claim IS present to Postgres.
 *
 * NOT a singleton — one client per request, bound to that request's idToken.
 * Never reuse across operators.
 */
export function getAccessTokenClient(idToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "getAccessTokenClient: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing",
    );
  }
  return createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    accessToken: async () => idToken,
  });
}
