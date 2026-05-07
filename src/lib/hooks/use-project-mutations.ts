/**
 * use-project-mutations — workspace-driven project writes.
 *
 * Each mutation persists the change AND drives the side-channel work the
 * workspace UX assumes:
 *   - inserts an `activities` row (system event for status, note for content,
 *     note + attachment_ids for photos)
 *   - notifies the right audience (existing dispatchProjectAssignment for
 *     team-member additions; direct `notifications` insert for everything
 *     else, since there is no shared dispatcher for status / note / photo)
 *   - invalidates the relevant query keys
 *
 * # Drift surfaced
 *
 * The legacy hooks at `src/lib/hooks/use-projects.ts` (useCreateProject /
 * useUpdateProject / useUpdateProjectStatus / useDeleteProject) already
 * dispatch project-assignment notifications but do NOT insert an activities
 * row. Rather than silently change their behavior, this file ships
 * workspace-scoped variants — the legacy hooks remain unchanged for the
 * surfaces that haven't migrated yet (Phase 5 will sweep the callers).
 *
 * Tests cover create / status-change / post-note / upload-photo. archive +
 * generic-update are sketched in the same shape and follow when the workspace
 * UI lands them.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";
import { useAuthStore } from "@/lib/store/auth-store";
import { dispatchProjectAssignment } from "@/lib/api/services/notification-dispatch";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ActivityInsertParams {
  type: "system" | "note";
  subject?: string | null;
  content?: string | null;
  projectId: string;
  companyId: string;
  createdBy: string | null;
  attachmentIds?: string[];
}

async function insertActivity(params: ActivityInsertParams): Promise<void> {
  const supabase = requireSupabase();
  const row: Record<string, unknown> = {
    type: params.type,
    subject: params.subject ?? null,
    content: params.content ?? null,
    project_id: params.projectId,
    company_id: params.companyId,
    created_by: params.createdBy,
  };
  if (params.attachmentIds && params.attachmentIds.length > 0) {
    row.attachment_ids = params.attachmentIds;
  }
  const { error } = await supabase.from("activities").insert(row);
  if (error) throw error;
}

interface NotificationInsertParams {
  userIds: string[];
  companyId: string;
  type: string;
  title: string;
  body: string;
  projectId: string;
  actionLabel?: string;
}

async function insertNotifications(params: NotificationInsertParams): Promise<void> {
  if (params.userIds.length === 0) return;
  const supabase = requireSupabase();
  const rows = params.userIds.map((user_id) => ({
    user_id,
    company_id: params.companyId,
    type: params.type,
    title: params.title,
    body: params.body,
    project_id: params.projectId,
    action_url: `/projects/${params.projectId}`,
    action_label: params.actionLabel ?? "View Project",
  }));
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) throw error;
}

function invalidateProjectQueries(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() });
  queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspace.all });
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  title: string;
  client_id: string | null;
  team_member_ids: string[];
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  visibility?: "all" | "office" | "private";
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}

export function useCreateProjectWithActivity() {
  const queryClient = useQueryClient();
  const { currentUser, company } = useAuthStore();

  return useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      if (!company?.id) throw new Error("No active company");
      const supabase = requireSupabase();

      const insertRow: Record<string, unknown> = {
        company_id: company.id,
        title: input.title,
        client_id: input.client_id,
        team_member_ids: input.team_member_ids,
        status: input.status ?? "Planned",
      };
      if (input.start_date !== undefined) insertRow.start_date = input.start_date;
      if (input.end_date !== undefined) insertRow.end_date = input.end_date;
      if (input.description !== undefined) insertRow.description = input.description;
      if (input.visibility !== undefined) insertRow.visibility = input.visibility;
      if (input.latitude !== undefined) insertRow.latitude = input.latitude;
      if (input.longitude !== undefined) insertRow.longitude = input.longitude;
      if (input.address !== undefined) insertRow.address = input.address;

      const { data, error } = await supabase
        .from("projects")
        .insert(insertRow)
        .select()
        .single();
      if (error) throw error;
      const created = data as { id: string };

      await insertActivity({
        type: "system",
        subject: `Project created: ${input.title}`,
        content: null,
        projectId: created.id,
        companyId: company.id,
        createdBy: currentUser?.id ?? null,
      });

      if (input.team_member_ids.length > 0) {
        dispatchProjectAssignment({
          projectId: created.id,
          projectTitle: input.title,
          newMemberIds: input.team_member_ids,
          companyId: company.id,
        });
      }

      return created;
    },
    onSuccess: (created) => {
      invalidateProjectQueries(queryClient, created.id);
    },
  });
}

// ─── Update status ───────────────────────────────────────────────────────────

export interface UpdateProjectStatusInput {
  projectId: string;
  projectTitle: string;
  newStatus: string;
  previousStatus: string | null;
  notifyUserIds: string[];
}

export function useUpdateProjectStatusWithActivity() {
  const queryClient = useQueryClient();
  const { currentUser, company } = useAuthStore();

  return useMutation({
    mutationFn: async (input: UpdateProjectStatusInput) => {
      if (!company?.id) throw new Error("No active company");
      const supabase = requireSupabase();

      const { error } = await supabase
        .from("projects")
        .update({ status: input.newStatus })
        .eq("id", input.projectId);
      if (error) throw error;

      await insertActivity({
        type: "system",
        subject: input.previousStatus
          ? `Status changed: ${input.previousStatus} → ${input.newStatus}`
          : `Status set to ${input.newStatus}`,
        content: null,
        projectId: input.projectId,
        companyId: company.id,
        createdBy: currentUser?.id ?? null,
      });

      await insertNotifications({
        userIds: input.notifyUserIds,
        companyId: company.id,
        type: "project_status_changed",
        title: `${input.projectTitle} → ${input.newStatus}`,
        body: input.previousStatus
          ? `Status changed from ${input.previousStatus} to ${input.newStatus}.`
          : `Status set to ${input.newStatus}.`,
        projectId: input.projectId,
      });

      return input;
    },
    onSuccess: (input) => {
      invalidateProjectQueries(queryClient, input.projectId);
    },
  });
}

// ─── Post note ───────────────────────────────────────────────────────────────

export interface PostProjectNoteInput {
  projectId: string;
  projectTitle: string;
  content: string;
  notifyUserIds: string[];
}

export function usePostProjectNote() {
  const queryClient = useQueryClient();
  const { currentUser, company } = useAuthStore();

  return useMutation({
    mutationFn: async (input: PostProjectNoteInput) => {
      if (!company?.id) throw new Error("No active company");

      await insertActivity({
        type: "note",
        subject: null,
        content: input.content,
        projectId: input.projectId,
        companyId: company.id,
        createdBy: currentUser?.id ?? null,
      });

      await insertNotifications({
        userIds: input.notifyUserIds,
        companyId: company.id,
        type: "project_note_posted",
        title: `New note on ${input.projectTitle}`,
        body:
          input.content.length > 120
            ? `${input.content.slice(0, 117)}...`
            : input.content,
        projectId: input.projectId,
      });

      return input;
    },
    onSuccess: (input) => {
      invalidateProjectQueries(queryClient, input.projectId);
    },
  });
}

// ─── Upload photo activity ───────────────────────────────────────────────────

export interface UploadProjectPhotoActivityInput {
  projectId: string;
  projectTitle: string;
  photoIds: string[];
  caption: string | null;
  notifyUserIds: string[];
}

export function useUploadProjectPhotoActivity() {
  const queryClient = useQueryClient();
  const { currentUser, company } = useAuthStore();

  return useMutation({
    mutationFn: async (input: UploadProjectPhotoActivityInput) => {
      if (!company?.id) throw new Error("No active company");

      await insertActivity({
        type: "note",
        subject: null,
        content: input.caption,
        projectId: input.projectId,
        companyId: company.id,
        createdBy: currentUser?.id ?? null,
        attachmentIds: input.photoIds,
      });

      const photoSummary =
        input.photoIds.length === 1
          ? "1 photo added"
          : `${input.photoIds.length} photos added`;

      await insertNotifications({
        userIds: input.notifyUserIds,
        companyId: company.id,
        type: "project_photo_added",
        title: `New photo on ${input.projectTitle}`,
        body: input.caption ?? photoSummary,
        projectId: input.projectId,
      });

      return input;
    },
    onSuccess: (input) => {
      invalidateProjectQueries(queryClient, input.projectId);
    },
  });
}

// ─── Archive ─────────────────────────────────────────────────────────────────

export interface ArchiveProjectInput {
  projectId: string;
  projectTitle: string;
  notifyUserIds: string[];
}

export function useArchiveProjectWithActivity() {
  const queryClient = useQueryClient();
  const { currentUser, company } = useAuthStore();

  return useMutation({
    mutationFn: async (input: ArchiveProjectInput) => {
      if (!company?.id) throw new Error("No active company");
      const supabase = requireSupabase();

      const { error } = await supabase
        .from("projects")
        .update({ status: "Archived" })
        .eq("id", input.projectId);
      if (error) throw error;

      await insertActivity({
        type: "system",
        subject: `Project archived: ${input.projectTitle}`,
        content: null,
        projectId: input.projectId,
        companyId: company.id,
        createdBy: currentUser?.id ?? null,
      });

      await insertNotifications({
        userIds: input.notifyUserIds,
        companyId: company.id,
        type: "project_archived",
        title: `${input.projectTitle} archived`,
        body: "This project has been archived.",
        projectId: input.projectId,
      });

      return input;
    },
    onSuccess: (input) => {
      invalidateProjectQueries(queryClient, input.projectId);
    },
  });
}
