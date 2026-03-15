import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";

/**
 * Fetches the current user's existing feature-flag beta access requests.
 * Returns a Set of feature_flag_slug values that have been requested.
 */
export function useFeatureAccessRequests(userId: string | undefined) {
  return useQuery({
    queryKey: ["feature-access-requests", userId],
    queryFn: async () => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("beta_access_requests")
        .select("feature_flag_slug")
        .eq("user_id", userId!)
        .not("feature_flag_slug", "is", null);

      if (error) throw error;

      const slugs = new Set<string>();
      for (const row of data ?? []) {
        if (row.feature_flag_slug) slugs.add(row.feature_flag_slug);
      }
      return slugs;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
