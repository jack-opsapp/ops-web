import { useQuery } from "@tanstack/react-query";
import { ProjectViewsService } from "@/lib/api/services/project-views-service";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";

export function useProjectViewsList() {
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  const userId = useAuthStore((s) => s.currentUser?.id ?? "");

  const query = useQuery({
    queryKey: queryKeys.projects.tableViews(companyId, userId),
    queryFn: () => ProjectViewsService.fetchViews(companyId),
    enabled: Boolean(companyId && userId),
    staleTime: 30_000,
  });

  return {
    ...query,
    companyId,
    userId,
  };
}
