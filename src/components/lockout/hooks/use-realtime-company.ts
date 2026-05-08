import { useEffect } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";

/**
 * Subscribes to UPDATE events on the user's company row and patches the
 * auth-store with the latest subscription/seat fields. Used by the
 * lockout surfaces to react to admin actions in another tab.
 */
export function useRealtimeCompany(companyId: string | undefined): void {
  const setCompany = useAuthStore((s) => s.setCompany);

  useEffect(() => {
    if (!companyId) return;

    let channel: ReturnType<ReturnType<typeof requireSupabase>["channel"]> | null = null;

    try {
      const supabase = requireSupabase();
      channel = supabase
        .channel(`lockout-company-${companyId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "companies",
            filter: `id=eq.${companyId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            const currentCompany = useAuthStore.getState().company;
            if (!currentCompany) return;

            setCompany({
              ...currentCompany,
              subscriptionStatus:
                (row.subscription_status as typeof currentCompany.subscriptionStatus) ??
                currentCompany.subscriptionStatus,
              subscriptionPlan:
                (row.subscription_plan as typeof currentCompany.subscriptionPlan) ??
                currentCompany.subscriptionPlan,
              subscriptionEnd: row.subscription_end
                ? new Date(row.subscription_end as string)
                : currentCompany.subscriptionEnd,
              trialEndDate: row.trial_end_date
                ? new Date(row.trial_end_date as string)
                : currentCompany.trialEndDate,
              maxSeats: (row.max_seats as number) ?? currentCompany.maxSeats,
              seatedEmployeeIds:
                (row.seated_employee_ids as string[]) ??
                currentCompany.seatedEmployeeIds,
              adminIds: (row.admin_ids as string[]) ?? currentCompany.adminIds,
            });
          }
        )
        .subscribe();
    } catch {
      // Silently fail — realtime is a nicety
    }

    return () => {
      if (channel) {
        try {
          const supabase = requireSupabase();
          supabase.removeChannel(channel);
        } catch {
          // cleanup silently
        }
      }
    };
  }, [companyId, setCompany]);
}
