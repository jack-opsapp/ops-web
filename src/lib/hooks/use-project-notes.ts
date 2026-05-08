"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectNoteService } from "@/lib/api/services/project-note-service";
import { NotificationService } from "@/lib/api/services/notification-service";
import { dispatchMentionPush } from "@/lib/api/services/notification-dispatch";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useAuthStore } from "@/lib/store/auth-store";
import type { CreateProjectNote, UpdateProjectNote } from "@/lib/types/pipeline";

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

  return useMutation({
    mutationFn: async (input: CreateProjectNote) => {
      const note = await ProjectNoteService.createNote(input);

      // Fan out mention notifications + push when the author tagged anyone.
      // Looked-up project title gives us a readable context line for the
      // notification body. All side effects below are best-effort — the
      // note is already saved, so we don't fail the mutation if the rail
      // entries or push fail to land.
      const mentioned = input.mentionedUserIds ?? [];
      if (mentioned.length > 0) {
        try {
          const supabase = requireSupabase();
          const { data: project } = await supabase
            .from("projects")
            .select("title")
            .eq("id", input.projectId)
            .single();
          const projectTitle =
            (project?.title as string) ?? "this project";
          const authorName =
            `${currentUser?.firstName ?? ""} ${currentUser?.lastName ?? ""}`
              .trim() || "A teammate";

          await NotificationService.createMentionNotifications({
            mentionedUserIds: mentioned,
            authorName,
            projectId: input.projectId,
            projectTitle,
            noteId: note.id,
            companyId: input.companyId,
          });

          dispatchMentionPush({
            mentionedUserIds: mentioned,
            authorName,
            notePreview: input.content,
            projectId: input.projectId,
            projectTitle,
            noteId: note.id,
            companyId: input.companyId,
          });
        } catch (err) {
          console.error("[use-project-notes] Mention dispatch failed:", err);
        }
      }

      return note;
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
