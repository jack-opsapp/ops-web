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
  ProjectTableViewMutationError,
  ProjectViewsService,
} from "@/lib/api/services/project-views-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type {
  ProjectTableViewCreateInput,
  ProjectTableViewDefinition,
  ProjectTableViewDefinitionInput,
  ProjectTableViewMutationErrorCode,
  ProjectTableViewUpdateInput,
} from "@/lib/types/project-table";

type MutationIdentity = {
  companyId: string;
  currentUserId: string;
  canManageViews: boolean;
};

type MutationIdentityPayload = {
  companyId: string;
  currentUserId: string;
};

type ProjectViewActionMutation<TData, TVariables> = UseMutationResult<
  TData,
  ProjectTableViewMutationError,
  TVariables
> & {
  errorCode: ProjectTableViewMutationErrorCode | null;
};

type CreateProjectViewVariables = ProjectTableViewCreateInput;
type DuplicateProjectViewVariables = ProjectTableViewCreateInput & {
  sourceView: ProjectTableViewDefinition;
};
type RenameProjectViewVariables = ProjectTableViewUpdateInput & { name: string };
type ArchiveProjectViewVariables = ProjectTableViewUpdateInput;
type ResetProjectViewVariables = ProjectTableViewUpdateInput;
type ShareProjectViewVariables = ProjectTableViewUpdateInput;
type UpdateProjectViewDefinitionVariables = ProjectTableViewUpdateInput & {
  definition: ProjectTableViewDefinitionInput;
};

export interface UseProjectViewActionsArgs {
  views: ProjectTableViewDefinition[];
  activeViewId: string | null;
  setActiveViewId: (viewId: string) => void;
}

function isProjectTableRowsQuery(queryKey: readonly unknown[]) {
  return queryKey[0] === "projects" && queryKey[1] === "tableRows";
}

function normalizeProjectViewActionError(error: unknown): ProjectTableViewMutationError {
  if (error instanceof ProjectTableViewMutationError) return error;

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
          : "Project view mutation failed";
      return new ProjectTableViewMutationError(message, code);
    }
  }

  return new ProjectTableViewMutationError("Project view mutation failed", "UNKNOWN");
}

async function runProjectViewAction<TData>(action: () => Promise<TData>) {
  try {
    return await action();
  } catch (error) {
    throw normalizeProjectViewActionError(error);
  }
}

function getMutationIdentity(): MutationIdentity {
  const authState = useAuthStore.getState();
  const permissionState = usePermissionStore.getState();
  const companyId = authState.company?.id ?? "";
  const currentUserId = authState.currentUser?.id ?? "";

  if (!companyId || !currentUserId) {
    throw new ProjectTableViewMutationError(
      "Project view mutation requires auth",
      "PERMISSION_DENIED",
    );
  }

  return {
    companyId,
    currentUserId,
    canManageViews: permissionState.can("projects.manage_views", "all"),
  };
}

function identityPayload(identity: MutationIdentity): MutationIdentityPayload {
  return {
    companyId: identity.companyId,
    currentUserId: identity.currentUserId,
  };
}

function getCurrentIdentityForInvalidation() {
  const authState = useAuthStore.getState();
  return {
    companyId: authState.company?.id ?? "",
    currentUserId: authState.currentUser?.id ?? "",
  };
}

function invalidateProjectViews(queryClient: QueryClient) {
  const identity = getCurrentIdentityForInvalidation();
  if (!identity.companyId || !identity.currentUserId) return;
  void queryClient.invalidateQueries({
    queryKey: queryKeys.projects.tableViews(identity.companyId, identity.currentUserId),
  });
}

function invalidateProjectTableRows(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.projects.all,
    exact: false,
    predicate: (query) =>
      Array.isArray(query.queryKey) && isProjectTableRowsQuery(query.queryKey),
  });
}

function withErrorCode<TData, TVariables>(
  mutation: UseMutationResult<TData, ProjectTableViewMutationError, TVariables>,
): ProjectViewActionMutation<TData, TVariables> {
  return {
    ...mutation,
    errorCode: mutation.error?.code ?? null,
  };
}

function pickArchiveFallbackView(
  views: ProjectTableViewDefinition[],
  archivedViewId: string,
) {
  const remainingViews = views.filter(
    (view) => view.id !== archivedViewId && view.isArchived !== true,
  );
  return (
    remainingViews.find((view) => view.name === "My Active Work") ??
    remainingViews.find((view) => view.isDefault) ??
    remainingViews[0] ??
    null
  );
}

export function useProjectViewActions({
  views,
  activeViewId,
  setActiveViewId,
}: UseProjectViewActionsArgs) {
  const queryClient = useQueryClient();
  const canShareViews = usePermissionStore((state) =>
    state.can("projects.manage_views", "all"),
  );

  const createPersonalView = useMutation<
    ProjectTableViewDefinition,
    ProjectTableViewMutationError,
    CreateProjectViewVariables
  >({
    mutationFn: (input: CreateProjectViewVariables) =>
      runProjectViewAction(() => {
        const identity = getMutationIdentity();
        const payload = {
          ...input,
          ...identityPayload(identity),
        };
        return ProjectViewsService.createPersonalView(payload);
      }),
    onSuccess: () => {
      invalidateProjectViews(queryClient);
    },
  });

  const duplicateView = useMutation<
    ProjectTableViewDefinition,
    ProjectTableViewMutationError,
    DuplicateProjectViewVariables
  >({
    mutationFn: (input: DuplicateProjectViewVariables) =>
      runProjectViewAction(() => {
        const identity = getMutationIdentity();
        const payload = {
          ...input,
          ...identityPayload(identity),
        };
        return ProjectViewsService.duplicateView(payload);
      }),
    onSuccess: () => {
      invalidateProjectViews(queryClient);
    },
  });

  const renameView = useMutation<
    ProjectTableViewDefinition,
    ProjectTableViewMutationError,
    RenameProjectViewVariables
  >({
    mutationFn: (input: RenameProjectViewVariables) =>
      runProjectViewAction(() => {
        const identity = getMutationIdentity();
        const payload = {
          ...input,
          ...identityPayload(identity),
        };
        return ProjectViewsService.renameView(payload);
      }),
    onSuccess: () => {
      invalidateProjectViews(queryClient);
    },
  });

  const archiveView = useMutation<
    ProjectTableViewDefinition,
    ProjectTableViewMutationError,
    ArchiveProjectViewVariables
  >({
    mutationFn: (input: ArchiveProjectViewVariables) =>
      runProjectViewAction(() => {
        const identity = getMutationIdentity();
        const payload = {
          ...input,
          ...identityPayload(identity),
        };
        return ProjectViewsService.archiveView(payload);
      }),
    onSuccess: (_archivedView, input) => {
      invalidateProjectViews(queryClient);
      if (input.viewId === activeViewId) {
        const fallbackView = pickArchiveFallbackView(views, input.viewId);
        if (fallbackView) setActiveViewId(fallbackView.id);
        invalidateProjectTableRows(queryClient);
      }
    },
  });

  const resetDefaultView = useMutation<
    ProjectTableViewDefinition,
    ProjectTableViewMutationError,
    ResetProjectViewVariables
  >({
    mutationFn: (input: ResetProjectViewVariables) =>
      runProjectViewAction(() => {
        const identity = getMutationIdentity();
        const payload = {
          ...input,
          ...identityPayload(identity),
        };
        return ProjectViewsService.resetDefaultView(payload);
      }),
    onSuccess: (_view, input) => {
      invalidateProjectViews(queryClient);
      if (input.viewId === activeViewId) invalidateProjectTableRows(queryClient);
    },
  });

  const shareViewWithTeam = useMutation<
    ProjectTableViewDefinition,
    ProjectTableViewMutationError,
    ShareProjectViewVariables
  >({
    mutationFn: (input: ShareProjectViewVariables) =>
      runProjectViewAction(() => {
        const identity = getMutationIdentity();
        if (!identity.canManageViews) {
          throw new ProjectTableViewMutationError(
            "Project view permission denied",
            "PERMISSION_DENIED",
          );
        }
        const payload = {
          ...input,
          ...identityPayload(identity),
          canManageViews: identity.canManageViews,
        };
        return ProjectViewsService.shareViewWithTeam(payload);
      }),
    onSuccess: () => {
      invalidateProjectViews(queryClient);
    },
  });

  const updateViewDefinition = useMutation<
    ProjectTableViewDefinition,
    ProjectTableViewMutationError,
    UpdateProjectViewDefinitionVariables
  >({
    mutationFn: (input: UpdateProjectViewDefinitionVariables) =>
      runProjectViewAction(() => {
        const identity = getMutationIdentity();
        const payload = {
          ...input,
          ...identityPayload(identity),
        };
        return ProjectViewsService.updateViewDefinition(payload);
      }),
    onSuccess: (_view, input) => {
      invalidateProjectViews(queryClient);
      if (input.viewId === activeViewId) invalidateProjectTableRows(queryClient);
    },
  });

  return useMemo(
    () => ({
      canShareViews,
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
      canShareViews,
      createPersonalView,
      duplicateView,
      renameView,
      resetDefaultView,
      shareViewWithTeam,
      updateViewDefinition,
    ],
  );
}
