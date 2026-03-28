/**
 * OPS Web - Project Hooks
 *
 * TanStack Query hooks for project data with optimistic updates.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ProjectService, type FetchProjectsOptions } from "../api/services";
import type { Project, ProjectStatus } from "../types/models";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all projects for the current company (auto-paginates past 100).
 */
export function useProjects(
  options?: FetchProjectsOptions,
  queryOptions?: Partial<UseQueryOptions<{ projects: Project[]; remaining: number; count: number }>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.projects.list(companyId, options as Record<string, unknown>),
    queryFn: async () => {
      const projects = await ProjectService.fetchAllProjects(companyId, options);
      return { projects, remaining: 0, count: projects.length };
    },
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch projects assigned to the current user (field crew view).
 * Auto-paginates to get all assigned projects.
 */
export function useUserProjects(
  options?: Omit<FetchProjectsOptions, "clientId">,
  queryOptions?: Partial<UseQueryOptions<{ projects: Project[]; remaining: number; count: number }>>
) {
  const { currentUser, company } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.projects.userList(userId, companyId),
    queryFn: async () => {
      // Auto-paginate user projects
      const allProjects: Project[] = [];
      let cursor = 0;
      let remaining = 1;
      while (remaining > 0) {
        const result = await ProjectService.fetchUserProjects(userId, companyId, {
          ...options,
          limit: 100,
          cursor,
        });
        allProjects.push(...result.projects);
        remaining = result.remaining;
        cursor += result.projects.length;
      }
      return { projects: allProjects, remaining: 0, count: allProjects.length };
    },
    enabled: !!userId && !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch a single project by ID.
 */
export function useProject(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<Project>>
) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id ?? ""),
    queryFn: () => ProjectService.fetchProject(id!),
    enabled: !!id,
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new project.
 */
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<Project> & { title: string; companyId: string }) =>
      ProjectService.createProject(data),
    onSuccess: () => {
      // Invalidate project lists to refetch
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      });
    },
  });
}

/**
 * Update an existing project with optimistic update.
 */
export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Project>;
    }) => ProjectService.updateProject(id, data),

    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.projects.detail(id),
      });

      // Snapshot the previous value
      const previousProject = queryClient.getQueryData<Project>(
        queryKeys.projects.detail(id)
      );

      // Optimistically update the detail cache
      if (previousProject) {
        queryClient.setQueryData(queryKeys.projects.detail(id), {
          ...previousProject,
          ...data,
        });
      }

      return { previousProject };
    },

    onError: (_err, { id }, context) => {
      // Roll back on error
      if (context?.previousProject) {
        queryClient.setQueryData(
          queryKeys.projects.detail(id),
          context.previousProject
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      });
    },
  });
}

/**
 * Update project status with optimistic update.
 */
export function useUpdateProjectStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: ProjectStatus;
    }) => ProjectService.updateProjectStatus(id, status),

    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.projects.detail(id),
      });

      const previousProject = queryClient.getQueryData<Project>(
        queryKeys.projects.detail(id)
      );

      if (previousProject) {
        queryClient.setQueryData(queryKeys.projects.detail(id), {
          ...previousProject,
          status,
        });
      }

      return { previousProject };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousProject) {
        queryClient.setQueryData(
          queryKeys.projects.detail(id),
          context.previousProject
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      });
    },
  });
}

/**
 * Soft delete a project.
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => ProjectService.deleteProject(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.projects.lists(),
      });

      // Optimistically remove from list caches
      const previousQueries = queryClient.getQueriesData({
        queryKey: queryKeys.projects.lists(),
      });

      queryClient.setQueriesData(
        { queryKey: queryKeys.projects.lists() },
        (old: { projects: Project[]; remaining: number; count: number } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            projects: old.projects.filter((p) => p.id !== id),
            count: old.count - 1,
          };
        }
      );

      return { previousQueries };
    },

    onError: (_err, _id, context) => {
      // Restore previous data on error
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
    },
  });
}
