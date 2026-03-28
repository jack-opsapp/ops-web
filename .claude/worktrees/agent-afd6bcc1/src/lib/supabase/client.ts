import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getFirebaseAuth } from "@/lib/firebase/config";

// Lazy initialization - prevents SSG/SSR crashes when env vars are missing
let _supabase: SupabaseClient | null = null;

/**
 * Returns a Supabase client that bridges Firebase Auth via third-party auth
 * provider support. The Firebase JWT is passed as the accessToken so Supabase
 * can validate it against its configured JWKS endpoint.
 *
 * Returns null if the required env vars are not configured yet.
 */
function getSupabaseClient(): SupabaseClient | null {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Supabase not configured yet — return null so the app doesn't crash
    return null;
  }

  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {},
    },
    accessToken: async () => {
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      if (!user) {
        return null as unknown as string;
      }
      return user.getIdToken();
    },
  });

  return _supabase;
}

export { getSupabaseClient };
