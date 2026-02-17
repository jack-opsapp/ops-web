/**
 * OPS Web - Opportunity Hooks
 *
 * TanStack Query hooks for pipeline opportunities with optimistic updates
 * for drag-and-drop stage transitions.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { OpportunityService, type FetchOpportunitiesOptions } from "../api/services";
import type {
  Opportunity,
  CreateOpportunity,
  UpdateOpportunity,
  Activity,
  CreateActivity,
  FollowUp,
  CreateFollowUp,
  StageTransition,
  OpportunityStage,
} from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all opportunities for the current company.
 */
export function useOpportunities(
  options?: FetchOpportunitiesOptions,
  queryOptions?: Partial<UseQueryOptions<Opportunity[]>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.opportunities.list(companyId, options as Record<string, unknown>),
    queryFn: () => OpportunityService.fetchOpportunities(companyId, options),
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch a single opportunity by ID.
 */
export function useOpportunity(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<Opportunity>>
) {
  return useQuery({
    queryKey: queryKeys.opportunities.detail(id ?? ""),
    queryFn: () => OpportunityService.fetchOpportunity(id!),
    enabled: !!id,
    ...queryOptions,
  });
}

/**
 * Fetch activities for an opportunity.
 */
export function useOpportunityActivities(
  opportunityId: string | undefined,
  queryOptions?: Partial<UseQueryOptions<Activity[]>>
) {
  return useQuery({
    queryKey: queryKeys.opportunities.activities(opportunityId ?? ""),
    queryFn: () => OpportunityService.fetchActivities(opportunityId!),
    enabled: !!opportunityId,
    ...queryOptions,
  });
}

/**
 * Fetch follow-ups for an opportunity.
 */
export function useOpportunityFollowUps(
  opportunityId: string | undefined,
  queryOptions?: Partial<UseQueryOptions<FollowUp[]>>
) {
  return useQuery({
    queryKey: queryKeys.opportunities.followUps(opportunityId ?? ""),
    queryFn: () => OpportunityService.fetchFollowUps(opportunityId!),
    enabled: !!opportunityId,
    ...queryOptions,
  });
}

/**
 * Fetch stage transitions for an opportunity.
 */
export function useStageTransitions(
  opportunityId: string | undefined,
  queryOptions?: Partial<UseQueryOptions<StageTransition[]>>
) {
  return useQuery({
    queryKey: queryKeys.opportunities.stageTransitions(opportunityId ?? ""),
    queryFn: () => OpportunityService.fetchStageTransitions(opportunityId!),
    enabled: !!opportunityId,
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new opportunity.
 */
export function useCreateOpportunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateOpportunity) =>
      OpportunityService.createOpportunity(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.opportunities.lists(),
      });
    },
  });
}

/**
 * Update an existing opportunity with optimistic update.
 */
export function useUpdateOpportunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<UpdateOpportunity>;
    }) => OpportunityService.updateOpportunity(id, data),

    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.opportunities.detail(id),
      });

      // Snapshot the previous value
      const previousOpportunity = queryClient.getQueryData<Opportunity>(
        queryKeys.opportunities.detail(id)
      );

      // Optimistically update the detail cache
      if (previousOpportunity) {
        queryClient.setQueryData(queryKeys.opportunities.detail(id), {
          ...previousOpportunity,
          ...data,
        });
      }

      return { previousOpportunity };
    },

    onError: (_err, { id }, context) => {
      // Roll back on error
      if (context?.previousOpportunity) {
        queryClient.setQueryData(
          queryKeys.opportunities.detail(id),
          context.previousOpportunity
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({
        queryKey: queryKeys.opportunities.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.opportunities.lists(),
      });
    },
  });
}

/**
 * Move an opportunity to a new pipeline stage with optimistic update.
 *
 * This is the key hook for drag-and-drop stage transitions. It optimistically
 * updates the opportunity's stage in all list caches so the card moves
 * instantly, then rolls back on error.
 */
export function useMoveOpportunityStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      stage,
      userId,
    }: {
      id: string;
      stage: OpportunityStage;
      userId?: string;
    }) => OpportunityService.moveOpportunityStage(id, stage, userId),

    onMutate: async ({ id, stage }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.opportunities.lists() });

      // Snapshot all list queries
      const previousLists = queryClient.getQueriesData<Opportunity[]>({
        queryKey: queryKeys.opportunities.lists(),
      });

      // Optimistically update the opportunity's stage in all list caches
      queryClient.setQueriesData<Opportunity[]>(
        { queryKey: queryKeys.opportunities.lists() },
        (old) => {
          if (!old) return old;
          return old.map((opp) =>
            opp.id === id ? { ...opp, stage, stageEnteredAt: new Date() } : opp
          );
        }
      );

      // Also update detail cache if present
      const previousDetail = queryClient.getQueryData<Opportunity>(
        queryKeys.opportunities.detail(id)
      );
      if (previousDetail) {
        queryClient.setQueryData(queryKeys.opportunities.detail(id), {
          ...previousDetail,
          stage,
          stageEnteredAt: new Date(),
        });
      }

      return { previousLists, previousDetail };
    },

    onError: (_err, { id }, context) => {
      // Restore all previous list caches
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(queryKeys.opportunities.detail(id), context.previousDetail);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
    },
  });
}

/**
 * Delete an opportunity with optimistic removal from lists.
 */
export function useDeleteOpportunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => OpportunityService.deleteOpportunity(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.opportunities.lists(),
      });

      // Optimistically remove from list caches
      const previousQueries = queryClient.getQueriesData({
        queryKey: queryKeys.opportunities.lists(),
      });

      queryClient.setQueriesData<Opportunity[]>(
        { queryKey: queryKeys.opportunities.lists() },
        (old) => {
          if (!old) return old;
          return old.filter((opp) => opp.id !== id);
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
        queryKey: queryKeys.opportunities.all,
      });
    },
  });
}

/**
 * Create an activity for an opportunity.
 * Invalidates activities and the opportunity detail (since lastActivityAt changes).
 */
export function useCreateActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateActivity) =>
      OpportunityService.createActivity(data),
    onSuccess: (_data, variables) => {
      if (variables.opportunityId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.opportunities.activities(variables.opportunityId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.opportunities.detail(variables.opportunityId),
        });
      }
    },
  });
}

/**
 * Create a follow-up for an opportunity.
 * Invalidates follow-ups and the opportunity detail (since nextFollowUpAt changes).
 */
export function useCreateFollowUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateFollowUp) =>
      OpportunityService.createFollowUp(data),
    onSuccess: (_data, variables) => {
      if (variables.opportunityId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.opportunities.followUps(variables.opportunityId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.opportunities.detail(variables.opportunityId),
        });
      }
    },
  });
}

/**
 * Complete a follow-up task.
 * Invalidates follow-ups and all opportunity queries (since nextFollowUpAt may change).
 */
export function useCompleteFollowUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      OpportunityService.completeFollowUp(id, notes),
    onSuccess: () => {
      // Invalidate all opportunity queries since we don't know which
      // opportunity this follow-up belongs to from the mutation args alone
      queryClient.invalidateQueries({
        queryKey: queryKeys.opportunities.all,
      });
    },
  });
}
