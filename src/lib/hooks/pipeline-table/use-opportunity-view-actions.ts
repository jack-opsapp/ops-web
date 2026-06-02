"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import {
  OpportunityTableViewMutationError,
  OpportunityViewsService,
} from "@/lib/api/services/opportunity-views-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type {
  OpportunityViewCreateInput,
  OpportunityViewDefinition,
  OpportunityViewDefinitionInput,
  OpportunityViewMutationErrorCode,
  OpportunityViewUpdateInput,
} from "@/lib/types/pipeline-table";

/**
 * OPS Web — Pipeline saved-view mutation hook.
 *
 * Mirrors `projects-table/use-project-view-actions.ts` (project → opportunity):
 * the same seven mutations wrapping `OpportunityViewsService`, each normalizing
 * thrown errors to `OpportunityTableViewMutationError`, invalidating the
 * views-list query on success, and exposing a flattened `errorCode`.
 *
 * One deliberate divergence: the projects hook also invalidates the projects
 * `tableRows` query after lifecycle mutations because that table is fetched
 * SERVER-SIDE off the active view's `filters`/`sort` JSON, so changing the view
 * changes the rows. The pipeline table has no such query — it derives its rows
 * in-memory from `useOpportunities`/`useClients`/`useTeamMembers` and does not
 * consume the view's filters/sort from the server — so there is nothing rows-side
 * to invalidate, and those calls are intentionally absent.
 */

type MutationIdentity = {
  companyId: string;
  currentUserId: string;
  canManageViews: boolean;
};

type OpportunityViewActionMutation<TData, TVariables> = UseMutationResult<
  TData,
  OpportunityTableViewMutationError,
  TVariables
> & {
  errorCode: OpportunityViewMutationErrorCode | null;
};

type CreateOpportunityViewVariables = OpportunityViewCreateInput;
type DuplicateOpportunityViewVariables = OpportunityViewCreateInput & {
  sourceView: OpportunityViewDefinition;
};
type RenameOpportunityViewVariables = OpportunityViewUpdateInput & { name: string };
type ArchiveOpportunityViewVariables = OpportunityViewUpdateInput;
type ResetOpportunityViewVariables = OpportunityViewUpdateInput;
type ShareOpportunityViewVariables = OpportunityViewUpdateInput;
type UpdateOpportunityViewDefinitionVariables = OpportunityViewUpdateInput & {
  definition: OpportunityViewDefinitionInput;
};

export interface UseOpportunityViewActionsArgs {
  views: OpportunityViewDefinition[];
  activeViewId: string | null;
  setActiveViewId: (viewId: string) => void;
}

function normalizeOpportunityViewActionError(
  error: unknown,
): OpportunityTableViewMutationError {
  if (error instanceof OpportunityTableViewMutationError) return error;

  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (
      code === "DUPLICATE_NAME" ||
      code === "PERMISSION_DENIED" ||
      code === "INVALID_INPUT" ||
      code === "UNKNOWN"
    ) {
      const message =
        "message" in error && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Pipeline view mutation failed";
      return new OpportunityTableViewMutationError(message, code);
    }
  }

  return new OpportunityTableViewMutationError("Pipeline view mutation failed", "UNKNOWN");
}

async function runOpportunityViewAction<TData>(action: () => Promise<TData>) {
  try {
    return await action();
  } catch (error) {
    throw normalizeOpportunityViewActionError(error);
  }
}

function getMutationIdentity(): MutationIdentity {
  const authState = useAuthStore.getState();
  const permissionState = usePermissionStore.getState();
  const companyId = authState.company?.id ?? "";
  const currentUserId = authState.currentUser?.id ?? "";

  if (!companyId || !currentUserId) {
    throw new OpportunityTableViewMutationError(
      "Pipeline view mutation requires auth",
      "PERMISSION_DENIED",
    );
  }

  return {
    companyId,
    currentUserId,
    canManageViews: permissionState.can("pipeline.manage_views", "all"),
  };
}

function getCurrentIdentityForInvalidation() {
  const authState = useAuthStore.getState();
  return {
    companyId: authState.company?.id ?? "",
    currentUserId: authState.currentUser?.id ?? "",
  };
}

function invalidateOpportunityViews(queryClient: QueryClient) {
  const identity = getCurrentIdentityForInvalidation();
  if (!identity.companyId || !identity.currentUserId) return;
  void queryClient.invalidateQueries({
    queryKey: queryKeys.opportunities.tableViews(identity.companyId, identity.currentUserId),
  });
}

function withErrorCode<TData, TVariables>(
  mutation: UseMutationResult<TData, OpportunityTableViewMutationError, TVariables>,
): OpportunityViewActionMutation<TData, TVariables> {
  return {
    ...mutation,
    errorCode: mutation.error?.code ?? null,
  };
}

function pickArchiveFallbackView(
  views: OpportunityViewDefinition[],
  archivedViewId: string,
) {
  const remainingViews = views.filter(
    (view) => view.id !== archivedViewId && view.isArchived !== true,
  );
  return (
    remainingViews.find((view) => view.isDefault) ??
    remainingViews[0] ??
    null
  );
}

export function useOpportunityViewActions({
  views,
  activeViewId,
  setActiveViewId,
}: UseOpportunityViewActionsArgs) {
  const queryClient = useQueryClient();
  const canManageViews = usePermissionStore((state) =>
    state.can("pipeline.manage_views", "all"),
  );

  const createPersonalView = useMutation<
    OpportunityViewDefinition,
    OpportunityTableViewMutationError,
    CreateOpportunityViewVariables
  >({
    mutationFn: (input: CreateOpportunityViewVariables) =>
      runOpportunityViewAction(() => {
        getMutationIdentity();
        return OpportunityViewsService.createPersonalView(input);
      }),
    onSuccess: () => {
      invalidateOpportunityViews(queryClient);
    },
  });

  const duplicateView = useMutation<
    OpportunityViewDefinition,
    OpportunityTableViewMutationError,
    DuplicateOpportunityViewVariables
  >({
    mutationFn: (input: DuplicateOpportunityViewVariables) =>
      runOpportunityViewAction(() => {
        getMutationIdentity();
        return OpportunityViewsService.duplicateView(input);
      }),
    onSuccess: () => {
      invalidateOpportunityViews(queryClient);
    },
  });

  const renameView = useMutation<
    OpportunityViewDefinition,
    OpportunityTableViewMutationError,
    RenameOpportunityViewVariables
  >({
    mutationFn: (input: RenameOpportunityViewVariables) =>
      runOpportunityViewAction(() => {
        getMutationIdentity();
        return OpportunityViewsService.renameView(input);
      }),
    onSuccess: () => {
      invalidateOpportunityViews(queryClient);
    },
  });

  const archiveView = useMutation<
    OpportunityViewDefinition,
    OpportunityTableViewMutationError,
    ArchiveOpportunityViewVariables
  >({
    mutationFn: (input: ArchiveOpportunityViewVariables) =>
      runOpportunityViewAction(() => {
        getMutationIdentity();
        return OpportunityViewsService.archiveView(input);
      }),
    onSuccess: (_archivedView, input) => {
      invalidateOpportunityViews(queryClient);
      if (input.viewId === activeViewId) {
        const fallbackView = pickArchiveFallbackView(views, input.viewId);
        if (fallbackView) setActiveViewId(fallbackView.id);
      }
    },
  });

  const resetDefaultView = useMutation<
    OpportunityViewDefinition,
    OpportunityTableViewMutationError,
    ResetOpportunityViewVariables
  >({
    mutationFn: (input: ResetOpportunityViewVariables) =>
      runOpportunityViewAction(() => {
        getMutationIdentity();
        return OpportunityViewsService.resetDefaultView(input);
      }),
    onSuccess: () => {
      invalidateOpportunityViews(queryClient);
    },
  });

  const shareViewWithTeam = useMutation<
    OpportunityViewDefinition,
    OpportunityTableViewMutationError,
    ShareOpportunityViewVariables
  >({
    mutationFn: (input: ShareOpportunityViewVariables) =>
      runOpportunityViewAction(() => {
        const identity = getMutationIdentity();
        if (!identity.canManageViews) {
          throw new OpportunityTableViewMutationError(
            "Pipeline view permission denied",
            "PERMISSION_DENIED",
          );
        }
        return OpportunityViewsService.shareViewWithTeam({
          ...input,
          canManageViews: identity.canManageViews,
        });
      }),
    onSuccess: () => {
      invalidateOpportunityViews(queryClient);
    },
  });

  const updateViewDefinition = useMutation<
    OpportunityViewDefinition,
    OpportunityTableViewMutationError,
    UpdateOpportunityViewDefinitionVariables
  >({
    mutationFn: (input: UpdateOpportunityViewDefinitionVariables) =>
      runOpportunityViewAction(() => {
        getMutationIdentity();
        return OpportunityViewsService.updateViewDefinition(input);
      }),
    onSuccess: () => {
      invalidateOpportunityViews(queryClient);
    },
  });

  return useMemo(
    () => ({
      canManageViews,
      createPersonalView: withErrorCode(createPersonalView),
      duplicateView: withErrorCode(duplicateView),
      renameView: withErrorCode(renameView),
      archiveView: withErrorCode(archiveView),
      resetDefaultView: withErrorCode(resetDefaultView),
      shareViewWithTeam: withErrorCode(shareViewWithTeam),
      updateViewDefinition: withErrorCode(updateViewDefinition),
    }),
    [
      archiveView,
      canManageViews,
      createPersonalView,
      duplicateView,
      renameView,
      resetDefaultView,
      shareViewWithTeam,
      updateViewDefinition,
    ],
  );
}
