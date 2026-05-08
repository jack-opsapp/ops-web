import { useEffect, useState } from "react";
import { requireSupabase } from "@/lib/supabase/helpers";

export interface AdminEntry {
  id: string;
  name: string;
}

/**
 * Fetches display names for the given admin user IDs.
 * Silently swallows errors — admin names are cosmetic; missing names
 * fall back to "Admin" rather than blocking the lockout.
 */
export function useAdminNames(adminIds: string[] | undefined): AdminEntry[] {
  const [admins, setAdmins] = useState<AdminEntry[]>([]);

  useEffect(() => {
    if (!adminIds?.length) {
      setAdmins([]);
      return;
    }

    let cancelled = false;

    async function fetchNames() {
      try {
        const supabase = requireSupabase();
        const { data } = await supabase
          .from("users")
          .select("id, first_name, last_name")
          .in("id", adminIds!);

        if (cancelled || !data) return;

        setAdmins(
          data.map(
            (u: { id: string; first_name: string; last_name: string }) => ({
              id: u.id,
              name:
                [u.first_name, u.last_name].filter(Boolean).join(" ") ||
                "Admin",
            })
          )
        );
      } catch {
        // Silently fail — admin names are cosmetic
      }
    }

    fetchNames();
    return () => {
      cancelled = true;
    };
  }, [adminIds]);

  return admins;
}
