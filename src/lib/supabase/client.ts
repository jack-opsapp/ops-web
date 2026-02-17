import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getFirebaseAuth } from "@/lib/firebase/config";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Lazy initialization - prevents SSG/SSR crashes when env vars are missing
let _supabase: SupabaseClient | null = null;

/**
 * Returns a Supabase client that bridges Firebase Auth via third-party auth
 * provider support. The Firebase JWT is passed as the accessToken so Supabase
 * can validate it against its configured JWKS endpoint.
 */
function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
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
  }
  return _supabase;
}

// Export getter (safe for SSG) and direct reference (for client-side)
export { getSupabaseClient };

// Convenience export - guarded so it won't crash during SSG/SSR
export const supabase =
  typeof window !== "undefined"
    ? getSupabaseClient()
    : (null as unknown as SupabaseClient);
