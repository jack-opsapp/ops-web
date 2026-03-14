/**
 * OPS Web - Bug Report Hooks
 *
 * TanStack Query hooks for bug report data.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import {
  BugReportService,
  type FetchBugReportsOptions,
  type BugReport,
  type BugReportStatus,
  type BugReportPriority,
  type BugReportPlatform,
} from "../api/services/bug-report-service";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useBugReports(
  options?: Omit<FetchBugReportsOptions, "limit" | "cursor">
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.bugReports.list(companyId, options as Record<string, unknown>),
    queryFn: () => BugReportService.fetchAllReports(companyId, options),
    enabled: !!companyId,
  });
}

export function useBugReport(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.bugReports.detail(id ?? ""),
    queryFn: () => BugReportService.fetchReport(id!),
    enabled: !!id,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateBugReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Partial<BugReport> & {
        description: string;
        companyId: string;
        reporterId: string;
        platform: BugReportPlatform;
      }
    ) => BugReportService.createReport(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bugReports.all,
      });
    },
  });
}

export function useUpdateBugReportStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      status,
      resolutionNotes,
    }: {
      id: string;
      status: BugReportStatus;
      resolutionNotes?: string;
    }) => BugReportService.updateStatus(id, status, resolutionNotes),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bugReports.all,
      });
    },
  });
}

export function useUpdateBugReportPriority() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      priority,
    }: {
      id: string;
      priority: BugReportPriority;
    }) => BugReportService.updatePriority(id, priority),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bugReports.all,
      });
    },
  });
}

export function useUpdateBugReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BugReport> }) =>
      BugReportService.updateReport(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bugReports.all,
      });
    },
  });
}
