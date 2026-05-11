"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectNoteService } from "@/lib/api/services/project-note-service";
import { NotificationService } from "@/lib/api/services/notification-service";
import { dispatchMentionPush } from "@/lib/api/services/notification-dispatch";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useAuthStore } from "@/lib/store/auth-store";
import type {
  CreateProjectNote,
  UpdateProjectNote,
  ProjectNote,
} from "@/lib/types/pipeline";

/**
 * Result shape for create-note: the saved note (flat — so `result.id`
 * still resolves to the note id, preserving the prior return contract)
 * plus a snapshot of mention notification delivery hung off
 * `mentionNotifications`. The note save is the source of truth — if it
 * fails the mutation rejects. Mention fan-out is reported separately so
 * the UI can warn the operator without rolling back the note.
 */
export interface MentionDispatchSnapshot {
  attempted: number;
  inAppFailed: boolean;
  pushFailed: boolean;
  /** Human-readable reason populated when either channel failed. */
  error?: string;
}

export type CreateProjectNoteResult = ProjectNote & {
  mentionNotifications: MentionDispatchSnapshot;
};

export function useProjectNotes(projectId: string | undefined) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.projectNotes.byProject(projectId ?? ""),
    queryFn: () =>
      ProjectNoteService.fetchNotes(projectId!, companyId),
    enabled: !!projectId && !!companyId,
  });
}

export function useCreateProjectNote() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuthStore();

  return useMutation<CreateProjectNoteResult, Error, CreateProjectNote>({
    mutationFn: async (input: CreateProjectNote) => {
      const note = await ProjectNoteService.createNote(input);

      // Fan out mention notifications + push when the author tagged anyone.
      // The note save is committed first; mention fan-out failures are
      // reported back to the caller via `mentionNotifications` so the UI
      // can warn the operator instead of silently dropping the alert.
      const mentioned = input.mentionedUserIds ?? [];
      const mentionStatus: MentionDispatchSnapshot = {
        attempted: mentioned.length,
        inAppFailed: false,
        pushFailed: false,
      };

      if (mentioned.length === 0) {
        return { ...note, mentionNotifications: mentionStatus };
      }

      const errorParts: string[] = [];

      // Resolve project title for the notification body. A failure here
      // means we never even attempted dispatch — treat both channels as
      // failed and surface the reason.
      let projectTitle = "this project";
      try {
        const supabase = requireSupabase();
        const { data: project, error } = await supabase
          .from("projects")
          .select("title")
          .eq("id", input.projectId)
          .single();
        if (error) throw error;
        if (project?.title) projectTitle = project.title as string;
      } catch (err) {
        console.error(
          "[use-project-notes] Could not resolve project title for mention dispatch:",
          err,
        );
        mentionStatus.inAppFailed = true;
        mentionStatus.pushFailed = true;
        mentionStatus.error =
          err instanceof Error ? err.message : "Could not resolve project context";
        return { ...note, mentionNotifications: mentionStatus };
      }

      const authorName =
        `${currentUser?.firstName ?? ""} ${currentUser?.lastName ?? ""}`
          .trim() || "A teammate";

      // In-app rail notifications (one row per recipient). Wrapped so a
      // throw here doesn't skip the push channel below.
      try {
        await NotificationService.createMentionNotifications({
          mentionedUserIds: mentioned,
          authorName,
          projectId: input.projectId,
          projectTitle,
          noteId: note.id,
          companyId: input.companyId,
        });
      } catch (err) {
        console.error(
          "[use-project-notes] In-app mention notifications failed:",
          err,
        );
        mentionStatus.inAppFailed = true;
        errorParts.push(
          err instanceof Error ? err.message : "In-app notification failed",
        );
      }

      // Push channel — dispatch returns a structured result; we await it
      // so we can report on the same mutation cycle.
      const pushResult = await dispatchMentionPush({
        mentionedUserIds: mentioned,
        authorName,
        notePreview: input.content,
        projectId: input.projectId,
        projectTitle,
        noteId: note.id,
        companyId: input.companyId,
      });

      if (!pushResult.ok) {
        mentionStatus.pushFailed = true;
        errorParts.push(pushResult.error ?? "Push delivery failed");
      }

      if (errorParts.length > 0) {
        mentionStatus.error = errorParts.join("; ");
      }

      return { ...note, mentionNotifications: mentionStatus };
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectNotes.byProject(input.projectId),
      });
    },
  });
}

export function useUpdateProjectNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProjectNote & { projectId: string }) =>
      ProjectNoteService.updateNote(input),
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectNotes.byProject(input.projectId),
      });
    },
  });
}

export function useDeleteProjectNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) =>
      ProjectNoteService.deleteNote(id),
    onSuccess: (_result, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectNotes.byProject(projectId),
      });
    },
  });
}
