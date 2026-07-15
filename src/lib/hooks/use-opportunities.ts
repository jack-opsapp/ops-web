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
import { OpportunityService, type FetchOpportunitiesOptions } from "../api/services/opportunity-service";
// Type-only — erased at build time, so the server-only conversion service is
// never pulled into the client bundle. The route returns this exact shape.
import type { ConversionPreflight } from "../api/services/project-conversion-service";
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
import { OpportunityStage as Stage } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";
import { usePermissionStore } from "../store/permissions-store";

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
  const canView = usePermissionStore((s) => s.can("pipeline.view"));

  return useQuery({
    queryKey: queryKeys.opportunities.list(companyId, options as Record<string, unknown>),
    queryFn: () => OpportunityService.fetchOpportunities(companyId, options),
    enabled: !!companyId && canView,
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
      await queryClient.cancelQueries({
        queryKey: queryKeys.opportunities.lists(),
      });

      // Snapshot the previous value
      const previousOpportunity = queryClient.getQueryData<Opportunity>(
        queryKeys.opportunities.detail(id)
      );
      const previousLists = queryClient.getQueriesData<Opportunity[]>({
        queryKey: queryKeys.opportunities.lists(),
      });

      // Optimistically update the detail cache
      if (previousOpportunity) {
        queryClient.setQueryData(queryKeys.opportunities.detail(id), {
          ...previousOpportunity,
          ...data,
        });
      }

      queryClient.setQueriesData<Opportunity[]>(
        { queryKey: queryKeys.opportunities.lists() },
        (old) => {
          if (!old) return old;
          return old.map((opportunity) =>
            opportunity.id === id ? { ...opportunity, ...data } : opportunity
          );
        }
      );

      return { previousOpportunity, previousLists };
    },

    onError: (_err, { id }, context) => {
      // Roll back on error
      if (context?.previousOpportunity) {
        queryClient.setQueryData(
          queryKeys.opportunities.detail(id),
          context.previousOpportunity
        );
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          queryClient.setQueryData(queryKey, data);
        }
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
 * Write a server-returned opportunity through the detail + list caches,
 * merging into the existing entries so separately-loaded relationship fields
 * (e.g. `client`) survive. Used by the image mutations, where the server row
 * — not an optimistic patch — is canonical (RMW contract).
 */
function writeOpportunityThrough(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  server: Opportunity
) {
  queryClient.setQueryData<Opportunity>(
    queryKeys.opportunities.detail(id),
    (old) => (old ? { ...old, ...server } : server)
  );
  queryClient.setQueriesData<Opportunity[]>(
    { queryKey: queryKeys.opportunities.lists() },
    (old) => {
      if (!old) return old;
      return old.map((opportunity) =>
        opportunity.id === id ? { ...opportunity, ...server } : opportunity
      );
    }
  );
}

/**
 * Append lead-photo URLs to an opportunity via the server-state
 * read-modify-write (`OpportunityService.appendImages`). No optimistic
 * pre-write: the upload UI already shows per-tile progress, and under the
 * RMW contract the merged server row is the only truth worth caching.
 */
export function useAddOpportunityImages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, urls }: { id: string; urls: string[] }) =>
      OpportunityService.appendImages(id, urls),

    onSuccess: (updated, { id }) => {
      writeOpportunityThrough(queryClient, id, updated);
    },

    onSettled: (_data, _error, { id }) => {
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
 * Remove one lead-photo URL — same server-state read-modify-write contract
 * as {@link useAddOpportunityImages}.
 */
export function useRemoveOpportunityImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, url }: { id: string; url: string }) =>
      OpportunityService.removeImage(id, url),

    onSuccess: (updated, { id }) => {
      writeOpportunityThrough(queryClient, id, updated);
    },

    onSettled: (_data, _error, { id }) => {
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
 * Attach an existing client to an opportunity.
 *
 * Uses the service helper instead of a raw opportunity update so linked
 * estimates without a client inherit the selected client too.
 */
export function useAttachClientToOpportunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      opportunityId,
      clientId,
    }: {
      opportunityId: string;
      clientId: string;
    }) => OpportunityService.attachClientToOpportunity(opportunityId, clientId),

    onMutate: async ({ opportunityId, clientId }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.opportunities.detail(opportunityId),
      });
      await queryClient.cancelQueries({
        queryKey: queryKeys.opportunities.lists(),
      });

      const previousDetail = queryClient.getQueryData<Opportunity>(
        queryKeys.opportunities.detail(opportunityId)
      );
      const previousLists = queryClient.getQueriesData<Opportunity[]>({
        queryKey: queryKeys.opportunities.lists(),
      });

      if (previousDetail) {
        queryClient.setQueryData(queryKeys.opportunities.detail(opportunityId), {
          ...previousDetail,
          clientId,
        });
      }

      queryClient.setQueriesData<Opportunity[]>(
        { queryKey: queryKeys.opportunities.lists() },
        (old) => {
          if (!old) return old;
          return old.map((opportunity) =>
            opportunity.id === opportunityId
              ? { ...opportunity, clientId }
              : opportunity
          );
        }
      );

      return { previousDetail, previousLists };
    },

    onError: (_err, { opportunityId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(
          queryKeys.opportunities.detail(opportunityId),
          context.previousDetail
        );
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },

    onSettled: (_data, _error, { opportunityId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.opportunities.detail(opportunityId),
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
 * Archive an opportunity with optimistic removal from lists.
 */
export function useArchiveOpportunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => OpportunityService.archiveOpportunity(id),

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
 * Unarchive an opportunity.
 * No optimistic update — the item isn't visible in active lists to re-add.
 */
export function useUnarchiveOpportunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => OpportunityService.unarchiveOpportunity(id),

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

// ─── Stage Auto-Advance Helpers ───────────────────────────────────────────────

/**
 * After creating an estimate for an opportunity, auto-advance stage from
 * new_lead or qualifying → quoting.
 */
export function useCreateEstimateForOpportunity() {
  const moveStage = useMoveOpportunityStage();
  const { currentUser: user } = useAuthStore();

  return {
    advanceToQuoting: (opportunityId: string, currentStage: OpportunityStage) => {
      if (
        currentStage === Stage.NewLead ||
        currentStage === Stage.Qualifying
      ) {
        moveStage.mutate({
          id: opportunityId,
          stage: Stage.Quoting,
          userId: user?.id,
        });
      }
    },
  };
}

/**
 * After sending an estimate, auto-advance stage → quoted.
 */
export function useSendEstimateForOpportunity() {
  const moveStage = useMoveOpportunityStage();
  const { currentUser: user } = useAuthStore();

  return {
    advanceToQuoted: (opportunityId: string) => {
      moveStage.mutate({
        id: opportunityId,
        stage: Stage.Quoted,
        userId: user?.id,
      });
    },
  };
}

/**
 * After an estimate is approved, auto-advance stage → won.
 */
export function useApproveEstimateForOpportunity() {
  const moveStage = useMoveOpportunityStage();
  const { currentUser: user } = useAuthStore();

  return {
    advanceToWon: (opportunityId: string) => {
      moveStage.mutate({
        id: opportunityId,
        stage: Stage.Won,
        userId: user?.id,
      });
    },
  };
}

/**
 * After logging an inbound activity on a quoted/follow_up opportunity,
 * auto-advance stage → negotiation to signal active engagement.
 */
export function useLogInboundActivity() {
  const moveStage = useMoveOpportunityStage();
  const { currentUser: user } = useAuthStore();

  return {
    advanceToNegotiation: (opportunityId: string, currentStage: OpportunityStage) => {
      if (
        currentStage === Stage.Quoted ||
        currentStage === Stage.FollowUp
      ) {
        moveStage.mutate({
          id: opportunityId,
          stage: Stage.Negotiation,
          userId: user?.id,
        });
      }
    },
  };
}

// ─── Won → Project Conversion (dedup + auto-naming) ───────────────────────────

export interface ConvertOpportunityResponse {
  ok: boolean;
  converted: boolean;
  alreadyConverted: boolean;
  projectId: string;
  opportunityId: string;
  dispositionId?: string;
  relinkedEstimates?: number;
  /** Number of LABOR line items materialized into project_tasks. */
  materializedTasks?: number;
  /** Number of site-visit photos attached to the project. */
  attachedPhotos?: number;
  /** True when an existing project was linked rather than a new one created. */
  linkedExisting?: boolean;
  /** True when this call moved the opportunity to `won` (+ a stage transition). */
  won?: boolean;
}

/**
 * Read-only conversion preflight for the Won dialog — surfaces an already-linked
 * project, likely-duplicate candidates, the client's other projects, and the
 * auto-name preview, so the operator can "link instead of create". Gated on
 * `pipeline.manage`; fetched via the service-role route (the browser client
 * runs as anon and can't call the RPC directly). Pass `undefined` to keep it
 * disabled until a deal is actually being won.
 */
export function useConversionPreflight(
  opportunityId: string | undefined,
  queryOptions?: Partial<UseQueryOptions<ConversionPreflight>>
) {
  const canManage = usePermissionStore((s) => s.can("pipeline.manage"));

  return useQuery<ConversionPreflight>({
    queryKey: queryKeys.opportunities.conversionPreflight(opportunityId ?? ""),
    queryFn: async () => {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Not authenticated");

      const res = await fetch(
        `/api/opportunities/${opportunityId}/preflight`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Preflight failed: ${res.status}`);
      }

      return res.json();
    },
    enabled: !!opportunityId && canManage,
    // The dialog opens on a fresh deal — keep it briefly fresh, but don't
    // cache stale dedup state across separate win attempts.
    staleTime: 30_000,
    ...queryOptions,
  });
}

/**
 * Win a deal and convert it into a NEW linked project in one atomic step. The
 * unified RPC wins + converts in a single transaction, so the Won dialog calls
 * ONLY this (no separate stage move) — which removes the double-stage-transition
 * risk by construction. Idempotent: re-winning never mints a second project.
 * `titleOverride` carries an operator-typed name from the rename escape hatch
 * (omit it for auto-naming). Invalidates project + opportunity caches.
 */
export function useConvertOpportunityToProject() {
  const queryClient = useQueryClient();

  return useMutation<
    ConvertOpportunityResponse,
    Error,
    {
      id: string;
      actualValue?: number;
      expectedStage?: string;
      titleOverride?: string | null;
    }
  >({
    mutationFn: async ({ id, actualValue, expectedStage, titleOverride }) => {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Not authenticated");

      const res = await fetch(`/api/opportunities/${id}/convert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          actualValue,
          expectedStage,
          titleOverride,
        }),
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Conversion failed: ${res.status}`);
      }

      return res.json();
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
    },
  });
}

/**
 * Win a deal by LINKING it to an existing project (a dedup candidate the
 * operator chose) instead of creating a new one. No new project, no "project
 * created" notification — the target's status/title are untouched; the RPC
 * writes only the link contract, estimate relink, task/photo dedup, and
 * disposition. Same idempotency guarantees as the convert path.
 */
export function useLinkOpportunityToExistingProject() {
  const queryClient = useQueryClient();

  return useMutation<
    ConvertOpportunityResponse,
    Error,
    { id: string; projectId: string; actualValue?: number; expectedStage?: string }
  >({
    mutationFn: async ({ id, projectId, actualValue, expectedStage }) => {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Not authenticated");

      const res = await fetch(`/api/opportunities/${id}/convert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          actualValue,
          expectedStage,
          linkToProjectId: projectId,
        }),
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Link failed: ${res.status}`);
      }

      return res.json();
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
    },
  });
}
