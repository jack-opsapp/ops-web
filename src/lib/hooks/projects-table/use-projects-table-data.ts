import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ProjectTableService } from "@/lib/api/services/project-table-service";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ProjectTableSort, ProjectTableViewDefinition } from "@/lib/types/project-table";

const PAGE_SIZE = 200;

export function useProjectsTableData(args: {
  view: ProjectTableViewDefinition | null;
  search: string;
  sorting: ProjectTableSort[];
}) {
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  const userId = useAuthStore((s) => s.currentUser?.id ?? "");

  const queryParams = useMemo(
    () => ({
      companyId,
      userId,
      viewId: args.view?.id ?? "",
      viewUpdatedAt: args.view?.updatedAt ?? "",
      search: args.search,
      sorting: args.sorting,
    }),
    [companyId, userId, args.view?.id, args.view?.updatedAt, args.search, args.sorting],
  );

  const query = useInfiniteQuery({
    queryKey: queryKeys.projects.tableRows(queryParams),
    queryFn: ({ pageParam }) => {
      if (!args.view) {
        return Promise.resolve({ rows: [], count: 0, nextPage: null });
      }
      return ProjectTableService.fetchRows({
        companyId,
        userId,
        view: args.view,
        search: args.search,
        sorting: args.sorting,
        pageSize: PAGE_SIZE,
        pageParam,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: Boolean(companyId && userId && args.view),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    rows: query.data?.pages.flatMap((page) => page.rows) ?? [],
    totalCount: query.data?.pages[0]?.count ?? 0,
  };
}
