"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectNoteService } from "@/lib/api/services/project-note-service";
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

  return useMutation({
    mutationFn: (input: CreateProjectNote) =>
      ProjectNoteService.createNote(input),
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
