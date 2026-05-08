/**
 * useProjectMutations — workspace-driven project writes.
 *
 * Thin coordinator over existing services. Each mutation:
 *   - calls the canonical service (ProjectService for CRUD,
 *     ProjectNoteService.createSystemEvent for timeline rows,
 *     dispatchProjectAssignment for new-member push)
 *   - tags the timeline row with the right event_kind so the
 *     workspace Activity tab renders it
 *   - invalidates the relevant query keys
 *
 * What this hook deliberately does NOT do:
 *   - Status changes are owned by useUpdateProjectStatus
 *     (src/lib/hooks/use-projects.ts). It already calls
 *     ProjectService.updateProjectStatus → ProjectLifecycleService
 *     .onProjectStageChange (fire-and-forget), which writes the
 *     `status_change` project_notes row. Don't duplicate.
 *   - Task-level dispatches (task assignment, schedule change, task
 *     completed) belong to task mutations.
 *
 * Note on note-posting: postNote delegates to useCreateProjectNote
 * unchanged — that hook handles attachments, mentions, and dedupe via
 * ProjectNoteService.createNote. Don't reimplement.
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import { ProjectService } from "@/lib/api/services/project-service";
import {
  ProjectNoteService,
  type CreateProjectSystemEvent,
} from "@/lib/api/services/project-note-service";
import { dispatchProjectAssignment } from "@/lib/api/services/notification-dispatch";
import { useCreateProjectNote } from "@/lib/hooks/use-project-notes";
import { ProjectStatus, type Project, type ProjectTrade } from "@/lib/types/models";
import type { NoteAttachment } from "@/lib/types/pipeline";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function invalidateProjectQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() });
  queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspace.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.projectNotes.byProject(projectId) });
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  /** Required core fields */
  title: string;
  /** Optional fields — every Project field except id/companyId/createdAt is fair game */
  clientId?: string | null;
  teamMemberIds?: string[];
  status?: ProjectStatus;
  startDate?: Date | null;
  endDate?: Date | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  projectDescription?: string | null;
  trade?: ProjectTrade | null;
  visibility?: Project["visibility"];
  notes?: string | null;
  opportunityId?: string | null;
}

export interface SaveProjectInput {
  projectId: string;
  patch: Partial<Project>;
  /** Original team member IDs before edit, used to compute the new-member delta
   *  for dispatchProjectAssignment. Omit for trivial saves that don't change team. */
  previousTeamMemberIds?: string[];
}

export interface ArchiveProjectInput {
  projectId: string;
  projectTitle: string;
  notifyUserIds: string[];
}

export interface UploadProjectPhotoInput {
  projectId: string;
  attachments: NoteAttachment[];
  caption?: string | null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useProjectMutations(projectId: string | null) {
  const queryClient = useQueryClient();
  const { currentUser, company } = useAuthStore();
  const postNote = useCreateProjectNote();

  // ── createProject ─────────────────────────────────────────────────────
  const createProject = useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      if (!company?.id) throw new Error("No active company");
      if (!currentUser?.id) throw new Error("No authenticated user");

      const teamMemberIds = input.teamMemberIds ?? [];
      const newProjectId = await ProjectService.createProject({
        title: input.title,
        companyId: company.id,
        clientId: input.clientId ?? null,
        teamMemberIds,
        status: input.status ?? ProjectStatus.RFQ,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        address: input.address ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        projectDescription: input.projectDescription ?? null,
        trade: input.trade ?? null,
        visibility: input.visibility ?? "all",
        notes: input.notes ?? null,
        opportunityId: input.opportunityId ?? null,
      });

      const eventInput: CreateProjectSystemEvent = {
        projectId: newProjectId,
        companyId: company.id,
        authorId: currentUser.id,
        eventKind: "project_created",
        content: `Project created: ${input.title}`,
        contentMetadata: {},
      };
      await ProjectNoteService.createSystemEvent(eventInput);

      if (teamMemberIds.length > 0) {
        dispatchProjectAssignment({
          projectId: newProjectId,
          projectTitle: input.title,
          newMemberIds: teamMemberIds,
          companyId: company.id,
        });
      }

      return { id: newProjectId, title: input.title };
    },
    onSuccess: (created) => {
      invalidateProjectQueries(queryClient, created.id);
    },
  });

  // ── saveProject ───────────────────────────────────────────────────────
  const saveProject = useMutation({
    mutationFn: async (input: SaveProjectInput) => {
      if (!company?.id) throw new Error("No active company");

      await ProjectService.updateProject(input.projectId, input.patch);

      const previous = input.previousTeamMemberIds;
      const next = input.patch.teamMemberIds;
      if (previous !== undefined && next !== undefined) {
        const previousSet = new Set(previous);
        const added = next.filter((id) => !previousSet.has(id));
        if (added.length > 0) {
          const projectTitle = input.patch.title ?? "this project";
          dispatchProjectAssignment({
            projectId: input.projectId,
            projectTitle,
            newMemberIds: added,
            companyId: company.id,
          });
        }
      }

      return input.projectId;
    },
    onSuccess: (id) => {
      invalidateProjectQueries(queryClient, id);
    },
  });

  // ── archiveProject ────────────────────────────────────────────────────
  const archiveProject = useMutation({
    mutationFn: async (input: ArchiveProjectInput) => {
      if (!company?.id) throw new Error("No active company");
      if (!currentUser?.id) throw new Error("No authenticated user");

      await ProjectService.updateProject(input.projectId, {
        status: ProjectStatus.Archived,
      });

      await ProjectNoteService.createSystemEvent({
        projectId: input.projectId,
        companyId: company.id,
        authorId: currentUser.id,
        eventKind: "project_archived",
        content: `Project archived: ${input.projectTitle}`,
        contentMetadata: {},
      });

      const { NotificationService } = await import(
        "@/lib/api/services/notification-service"
      );
      await Promise.all(
        input.notifyUserIds.map((userId) =>
          NotificationService.create({
            userId,
            companyId: company.id,
            type: "system",
            title: `${input.projectTitle} archived`,
            body: "This project has been archived.",
            projectId: input.projectId,
            actionUrl: `/?openProject=${input.projectId}&mode=view`,
            actionLabel: "View Project",
          }),
        ),
      );

      return input.projectId;
    },
    onSuccess: (id) => {
      invalidateProjectQueries(queryClient, id);
    },
  });

  // ── deleteProject ─────────────────────────────────────────────────────
  const deleteProject = useMutation({
    mutationFn: async (id: string) => {
      await ProjectService.deleteProject(id);
      return id;
    },
    onSuccess: (id) => {
      invalidateProjectQueries(queryClient, id);
    },
  });

  // ── uploadPhoto ──────────────────────────────────────────────────────
  const uploadPhoto = useMutation({
    mutationFn: async (input: UploadProjectPhotoInput) => {
      if (!company?.id) throw new Error("No active company");
      if (!currentUser?.id) throw new Error("No authenticated user");

      const photoCount = input.attachments.length;
      const summary =
        photoCount === 1 ? "1 photo added" : `${photoCount} photos added`;

      await ProjectNoteService.createSystemEvent({
        projectId: input.projectId,
        companyId: company.id,
        authorId: currentUser.id,
        eventKind: "photo_uploaded",
        content: input.caption ?? summary,
        attachments: input.attachments,
        contentMetadata: {
          photoCount,
          urls: input.attachments.map((a) => a.url),
        },
      });

      return input.projectId;
    },
    onSuccess: (id) => {
      invalidateProjectQueries(queryClient, id);
    },
  });

  return {
    saveProject,
    createProject,
    archiveProject,
    deleteProject,
    postNote,
    uploadPhoto,
    /** projectId scope passthrough — useful for callers that want to reference
     *  the same project id used to construct this mutation set. */
    projectId,
  };
}
