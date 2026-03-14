"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import {
  Edit3,
  Trash2,
  MapPin,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Plus,
  MoreHorizontal,
  Info,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge, type ProjectStatus as StatusBadgeProjectStatus } from "@/components/ops/status-badge";
import { SectionHeader } from "@/components/ops/section-header";
import { UserAvatar } from "@/components/ops/user-avatar";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { TaskList } from "@/components/ops/task-list";
import { NotesList } from "@/components/ops/notes-list";
import { NoteComposer } from "@/components/ops/note-composer";
import { PhotoFeed } from "@/components/ops/photo-feed";
import { PermissionGate } from "@/components/ops/permission-gate";
import {
  useProjectNotes,
  useCreateProjectNote,
  useUpdateProjectNote,
  useDeleteProjectNote,
} from "@/lib/hooks/use-project-notes";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectNoteService } from "@/lib/api/services/project-note-service";
import { NotificationService } from "@/lib/api/services/notification-service";
import { useCreateProjectPhoto } from "@/lib/hooks/use-project-photos";
import type { NoteAttachment, ProjectNote } from "@/lib/types/pipeline";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useProject,
  useUpdateProjectStatus,
  useDeleteProject,
} from "@/lib/hooks/use-projects";
import { useProjectEstimates, useProjectInvoices } from "@/lib/hooks";
import { useClient } from "@/lib/hooks/use-clients";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useProjectTasks } from "@/lib/hooks/use-tasks";
import { useTaskTypes } from "@/lib/hooks/use-task-types";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import {
  type Project,
  type ProjectTask,
  type User,
  ProjectStatus,
  TaskStatus,
  getUserFullName,
} from "@/lib/types/models";
import {
  InvoiceStatus,
  ESTIMATE_STATUS_COLORS,
  INVOICE_STATUS_COLORS,
  formatCurrency,
} from "@/lib/types/pipeline";
import { cn } from "@/lib/utils/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "tasks" | "financial" | "photos" | "notes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map ProjectStatus enum to the kebab-case key used by StatusBadge component.
 */
function statusToKey(status: ProjectStatus): StatusBadgeProjectStatus {
  switch (status) {
    case ProjectStatus.RFQ:
      return "rfq";
    case ProjectStatus.Estimated:
      return "estimated";
    case ProjectStatus.Accepted:
      return "accepted";
    case ProjectStatus.InProgress:
      return "in-progress";
    case ProjectStatus.Completed:
      return "completed";
    case ProjectStatus.Closed:
      return "closed";
    case ProjectStatus.Archived:
      return "archived";
    default:
      return "rfq";
  }
}

const ALL_PROJECT_STATUSES = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
  ProjectStatus.Archived,
];

function isTaskPastDue(task: ProjectTask): boolean {
  if (!task.endDate) return false;
  if (task.status === TaskStatus.Completed || task.status === TaskStatus.Cancelled) return false;
  return new Date(task.endDate) < new Date();
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="h-[18px] bg-background-elevated rounded w-[60px]" />
          <div className="h-[18px] bg-background-elevated rounded w-[4px]" />
          <div className="h-[18px] bg-background-elevated rounded w-[180px]" />
          <div className="h-[20px] bg-background-elevated rounded w-[70px]" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-[32px] bg-background-elevated rounded w-[120px]" />
          <div className="h-[32px] bg-background-elevated rounded w-[70px]" />
        </div>
      </div>
      {/* Tab bar skeleton */}
      <div className="border-b border-border px-6 flex gap-2 py-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[16px] bg-background-elevated rounded w-[60px]" />
        ))}
      </div>
      {/* Body skeleton */}
      <div className="flex flex-1 min-h-0">
        {/* Main content */}
        <div className="flex-1 p-6 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[48px] bg-background-elevated rounded w-full" />
          ))}
        </div>
        {/* Sidebar skeleton */}
        <div className="hidden lg:block w-[280px] border-l border-border p-5 space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="h-[10px] bg-background-elevated rounded w-[100px]" />
            <div className="h-[6px] bg-background-elevated rounded w-full" />
          </div>
          {/* Metric tiles */}
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-background-card border border-border-subtle rounded-[3px] p-2.5 space-y-1">
                <div className="h-[9px] bg-background-elevated rounded w-[40px]" />
                <div className="h-[20px] bg-background-elevated rounded w-[50px]" />
              </div>
            ))}
          </div>
          {/* Text blocks */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-[10px] bg-background-elevated rounded w-[60px]" />
              <div className="h-[14px] bg-background-elevated rounded w-full" />
              <div className="h-[14px] bg-background-elevated rounded w-2/3" />
            </div>
          ))}
          {/* Avatar rows */}
          <div className="space-y-1.5">
            <div className="h-[10px] bg-background-elevated rounded w-[40px]" />
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-[28px] w-[28px] rounded-full bg-background-elevated" />
                <div className="h-[14px] bg-background-elevated rounded w-[100px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Error State ──────────────────────────────────────────────────────────────

function DetailError({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  const { t } = useDictionary("projects");
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-[64px] h-[64px] rounded-lg bg-ops-error-muted flex items-center justify-center mb-2">
        <AlertCircle className="w-[32px] h-[32px] text-ops-error" />
      </div>
      <h3 className="font-mohave text-heading text-text-primary">{t("detail.failedToLoad")}</h3>
      <p className="font-kosugi text-caption text-text-tertiary mt-0.5 max-w-[300px]">{message}</p>
      <div className="flex gap-1 mt-3">
        <Button variant="ghost" onClick={onBack}>{t("detail.goBack")}</Button>
        <Button variant="secondary" className="gap-[6px]" onClick={onRetry}>
          <RefreshCw className="w-[16px] h-[16px]" />
          {t("detail.retry")}
        </Button>
      </div>
    </div>
  );
}

// ─── Sidebar Components ───────────────────────────────────────────────────────

function SidebarSection({ label, onEdit, children }: { label: string; onEdit?: () => void; children: React.ReactNode }) {
  const { t } = useDictionary("projects");
  return (
    <div className="group/section p-2.5 -m-2.5 rounded-[3px] border border-transparent hover:border-border transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="font-kosugi text-[10px] uppercase tracking-[0.5px] text-text-tertiary">{label}</span>
        {onEdit && (
          <button onClick={onEdit} className="opacity-0 group-hover/section:opacity-100 transition-opacity text-ops-accent text-[11px] border border-ops-accent/30 rounded-[2px] px-2 py-0.5 hover:bg-ops-accent/10">
            {t("sidebar.edit")}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function MetricTile({ label, value, colorClass = "text-text-primary" }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="bg-background-card border border-border-subtle rounded-[3px] p-2.5">
      <span className="font-kosugi text-[9px] uppercase tracking-[0.3px] text-text-tertiary block">{label}</span>
      <span className={cn("font-mohave text-heading font-semibold block mt-0.5", colorClass)}>{value}</span>
    </div>
  );
}

function ProjectSidebar({ project, tasks }: { project: Project; tasks: ProjectTask[] }) {
  const { t } = useDictionary("projects");
  const { locale } = useLocale();
  const router = useRouter();
  const { data: client } = useClient(project.clientId ?? undefined);
  const resolvedClient = project.client ?? client;
  const { data: teamData } = useTeamMembers();
  const { data: taskTypes } = useTaskTypes();
  const { data: estimates = [] } = useProjectEstimates(project.id);
  const { data: invoices = [] } = useProjectInvoices(project.id);

  const resolvedTeamMembers = useMemo(() => {
    const users = teamData?.users ?? [];
    return project.teamMemberIds
      .map((id) => users.find((u) => u.id === id))
      .filter(Boolean) as User[];
  }, [project.teamMemberIds, teamData]);

  // Build task type lookup
  const taskTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    if (taskTypes) {
      for (const tt of taskTypes) {
        map.set(tt.id, tt.display);
      }
    }
    return map;
  }, [taskTypes]);

  // For each team member, find their assigned task type names
  const memberTaskAssignments = useMemo(() => {
    const assignments = new Map<string, Set<string>>();
    for (const task of tasks) {
      if (task.deletedAt) continue;
      const typeName = taskTypeMap.get(task.taskTypeId);
      if (!typeName) continue;
      for (const memberId of task.teamMemberIds) {
        if (!assignments.has(memberId)) {
          assignments.set(memberId, new Set());
        }
        assignments.get(memberId)!.add(typeName);
      }
    }
    return assignments;
  }, [tasks, taskTypeMap]);

  // Health calculations
  const activeTasks = tasks.filter((t) => !t.deletedAt);
  const completedTasks = activeTasks.filter((t) => t.status === TaskStatus.Completed);
  const overdueTasks = activeTasks.filter(isTaskPastDue);
  const progressPercent = activeTasks.length > 0 ? Math.round((completedTasks.length / activeTasks.length) * 100) : 0;

  const totalInvoiced = invoices
    .filter((i) => i.status !== InvoiceStatus.Void)
    .reduce((sum, i) => sum + i.total, 0);
  const totalOutstanding = invoices
    .filter(
      (i) =>
        i.status === InvoiceStatus.Sent ||
        i.status === InvoiceStatus.PartiallyPaid ||
        i.status === InvoiceStatus.PastDue
    )
    .reduce((sum, i) => sum + i.balanceDue, 0);

  const mapQuery = project.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`
    : null;

  // Duration calculation
  const durationDays = useMemo(() => {
    if (!project.startDate || !project.endDate) return null;
    const start = new Date(project.startDate);
    const end = new Date(project.endDate);
    const diffMs = end.getTime() - start.getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [project.startDate, project.endDate]);

  return (
    <div className="space-y-5">
      {/* Health Section */}
      <SidebarSection label={t("sidebar.projectHealth")}>
        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mohave text-body-sm text-text-secondary">{progressPercent}%</span>
            <span className="font-mohave text-body-sm text-text-disabled">
              {completedTasks.length}/{activeTasks.length}
            </span>
          </div>
          <div className="h-1.5 rounded-[2px] bg-[rgba(255,255,255,0.06)] overflow-hidden">
            <div
              className="h-full bg-ops-accent transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
        {/* 4 Metric Tiles */}
        <div className="grid grid-cols-2 gap-2">
          <MetricTile
            label={t("sidebar.tasks")}
            value={`${completedTasks.length}/${activeTasks.length}`}
          />
          <MetricTile
            label={t("sidebar.overdue")}
            value={String(overdueTasks.length)}
            colorClass={overdueTasks.length > 0 ? "text-financial-overdue" : "text-text-primary"}
          />
          <MetricTile
            label={t("sidebar.invoiced")}
            value={formatCurrency(totalInvoiced)}
            colorClass="text-financial-revenue"
          />
          <MetricTile
            label={t("sidebar.outstanding")}
            value={formatCurrency(totalOutstanding)}
            colorClass={totalOutstanding > 0 ? "text-financial-receivables" : "text-text-primary"}
          />
        </div>
      </SidebarSection>

      {/* Client Section */}
      <SidebarSection
        label={t("sidebar.client")}
        onEdit={resolvedClient ? () => router.push(`/clients/${resolvedClient.id}`) : undefined}
      >
        {resolvedClient ? (
          <div className="space-y-1">
            <p className="font-mohave text-body-sm text-text-primary">{resolvedClient.name}</p>
            {resolvedClient.email && (
              <a
                href={`mailto:${resolvedClient.email}`}
                className="font-mohave text-body-sm text-ops-accent hover:underline block truncate"
              >
                {resolvedClient.email}
              </a>
            )}
            {resolvedClient.phoneNumber && (
              <a
                href={`tel:${resolvedClient.phoneNumber}`}
                className="font-mono text-data-sm text-text-secondary hover:text-ops-accent block"
              >
                {resolvedClient.phoneNumber}
              </a>
            )}
          </div>
        ) : (
          <p className="font-mohave text-body-sm text-text-disabled">{t("sidebar.noClient")}</p>
        )}
      </SidebarSection>

      {/* Location Section */}
      <SidebarSection label={t("sidebar.location")}>
        {project.address ? (
          <div className="space-y-1">
            <div className="flex items-start gap-1.5">
              <MapPin className="w-[14px] h-[14px] text-ops-accent shrink-0 mt-[2px]" />
              <p className="font-mohave text-body-sm text-text-primary">{project.address}</p>
            </div>
            {mapQuery && (
              <a
                href={mapQuery}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mohave text-body-sm text-ops-accent hover:underline"
              >
                {t("sidebar.openMaps")}
                <ExternalLink className="w-[12px] h-[12px]" />
              </a>
            )}
          </div>
        ) : (
          <p className="font-mohave text-body-sm text-text-disabled">{t("sidebar.noAddress")}</p>
        )}
      </SidebarSection>

      {/* Team Section */}
      <SidebarSection label={t("sidebar.team")}>
        {resolvedTeamMembers.length > 0 ? (
          <div className="space-y-2">
            {resolvedTeamMembers.map((member) => {
              const assignedTypes = memberTaskAssignments.get(member.id);
              const typeNames = assignedTypes ? Array.from(assignedTypes).join(", ") : null;
              return (
                <div key={member.id} className="flex items-center gap-2">
                  <UserAvatar
                    name={getUserFullName(member)}
                    imageUrl={member.profileImageURL}
                    size="sm"
                    color={member.userColor ?? undefined}
                    showTooltip
                  />
                  <div className="min-w-0">
                    <p className="font-mohave text-body-sm text-text-primary truncate">
                      {getUserFullName(member)}
                    </p>
                    <span className="font-kosugi text-[10px] text-text-disabled truncate block">
                      {typeNames || t("sidebar.noTasksAssigned")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="font-mohave text-body-sm text-text-disabled">{t("sidebar.noTeam")}</p>
        )}
      </SidebarSection>

      {/* Dates Section */}
      <SidebarSection label={t("sidebar.dates")}>
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <span className="font-mohave text-body-sm text-text-primary">
              {project.startDate
                ? new Date(project.startDate).toLocaleDateString(getDateLocale(locale), {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : t("sidebar.notScheduled")}
            </span>
          </div>
          <span className="text-text-disabled font-mohave text-body-sm">&rarr;</span>
          <div className="min-w-0">
            <span className="font-mohave text-body-sm text-text-primary">
              {project.endDate
                ? new Date(project.endDate).toLocaleDateString(getDateLocale(locale), {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : t("sidebar.tbd")}
            </span>
          </div>
        </div>
        {durationDays !== null && (
          <p className="font-kosugi text-[10px] text-text-disabled mt-1">
            {durationDays} {t("sidebar.durationDays")}
          </p>
        )}
      </SidebarSection>
    </div>
  );
}

// ─── Notes Tab ──────────────────────────────────────────────────────────────

function NotesTab({ project }: { project: Project }) {
  const { t } = useDictionary("projects");
  const { currentUser, company } = useAuthStore();
  const { data: notes = [], isLoading } = useProjectNotes(project.id);
  const createNote = useCreateProjectNote();
  const updateNote = useUpdateProjectNote();
  const deleteNote = useDeleteProjectNote();
  const createPhoto = useCreateProjectPhoto();
  const queryClient = useQueryClient();
  const users = project.teamMembers ?? [];
  const migrated = useRef(false);

  const [editingNote, setEditingNote] = useState<ProjectNote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Legacy migration: one-time convert teamNotes to project_notes
  useEffect(() => {
    if (
      !migrated.current &&
      project.notes &&
      project.notes.trim() &&
      currentUser &&
      company &&
      notes.length === 0 &&
      !isLoading
    ) {
      migrated.current = true;
      ProjectNoteService.migrateFromLegacy(
        project.id,
        company.id,
        project.notes,
        currentUser.id
      ).then((result) => {
        if (result) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.projectNotes.byProject(project.id),
          });
        }
      });
    }
  }, [project.notes, project.id, notes.length, isLoading, currentUser, company, queryClient]);

  function handleSubmit(
    content: string,
    mentionedUserIds: string[],
    attachments: NoteAttachment[]
  ) {
    if (!currentUser || !company) return;
    createNote.mutate(
      {
        projectId: project.id,
        companyId: company.id,
        authorId: currentUser.id,
        content,
        mentionedUserIds,
        attachments,
      },
      {
        onSuccess: (result) => {
          toast.success(t("notes.posted"));
          // Cross-post photos to project gallery
          for (const att of attachments) {
            createPhoto.mutate({
              projectId: project.id,
              companyId: company.id,
              url: att.markedUpUrl ?? att.url,
              thumbnailUrl: null,
              source: "other",
              siteVisitId: null,
              uploadedBy: currentUser.id,
              takenAt: null,
              caption: att.caption,
            });
          }
          // Send mention notifications
          if (mentionedUserIds.length > 0 && currentUser) {
            NotificationService.createMentionNotifications({
              mentionedUserIds,
              authorName: `${currentUser.firstName} ${currentUser.lastName}`,
              projectId: project.id,
              projectTitle: project.title,
              noteId: result.id,
              companyId: company.id,
            });
          }
        },
        onError: () => toast.error(t("notes.postFailed")),
      }
    );
  }

  function handleEdit(note: ProjectNote) {
    setEditingNote(note);
  }

  function handleCancelEdit() {
    setEditingNote(null);
  }

  function handleUpdate(
    content: string,
    mentionedUserIds: string[],
    attachments: NoteAttachment[]
  ) {
    if (!editingNote) return;
    updateNote.mutate(
      {
        id: editingNote.id,
        projectId: project.id,
        content,
        mentionedUserIds,
        attachments,
      },
      {
        onSuccess: () => {
          toast.success(t("notes.updated"));
          setEditingNote(null);
        },
        onError: () => toast.error(t("notes.updateFailed")),
      }
    );
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    deleteNote.mutate(
      { id: deleteTarget, projectId: project.id },
      {
        onSuccess: () => {
          toast.success(t("notes.deleted"));
          setDeleteTarget(null);
        },
        onError: () => toast.error(t("notes.deleteFailed")),
      }
    );
  }

  return (
    <div className="space-y-4">
      {editingNote ? (
        <NoteComposer
          onSubmit={handleUpdate}
          isSubmitting={updateNote.isPending}
          users={users}
          initialContent={editingNote.content}
          initialAttachments={editingNote.attachments}
          onCancel={handleCancelEdit}
        />
      ) : (
        <NoteComposer
          onSubmit={handleSubmit}
          isSubmitting={createNote.isPending}
          users={users}
        />
      )}
      <NotesList
        notes={notes}
        users={users}
        currentUserId={currentUser?.id ?? ""}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={(id) => setDeleteTarget(id)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title={t("detail.deleteNote")}
        description={t("detail.deleteNoteConfirm")}
        onConfirm={handleDeleteConfirm}
        confirmLabel={t("bulk.delete")}
        variant="destructive"
        loading={deleteNote.isPending}
      />
    </div>
  );
}

// ─── Financial Tab ──────────────────────────────────────────────────────────

function FinancialTab({ project }: { project: Project }) {
  const { t } = useDictionary("projects");
  const { locale } = useLocale();
  const router = useRouter();
  const { data: estimates = [] } = useProjectEstimates(project.id);
  const { data: invoices = [] } = useProjectInvoices(project.id);

  const totals = {
    estimated: estimates.reduce((sum, e) => sum + e.total, 0),
    invoiced: invoices
      .filter((i) => i.status !== InvoiceStatus.Void)
      .reduce((sum, i) => sum + i.total, 0),
    paid: invoices.reduce((sum, i) => sum + i.amountPaid, 0),
    outstanding: invoices
      .filter(
        (i) =>
          i.status === InvoiceStatus.Sent ||
          i.status === InvoiceStatus.PartiallyPaid ||
          i.status === InvoiceStatus.PastDue
      )
      .reduce((sum, i) => sum + i.balanceDue, 0),
  };

  return (
    <div className="space-y-3">
      {/* Budget Health Bar */}
      <div className="bg-background-card border border-border rounded-[3px] p-4 mb-3">
        <span className="font-kosugi text-[10px] uppercase tracking-[0.3px] text-text-tertiary block mb-2">
          {t("financial.budgetOverview")}
        </span>
        <div className="h-2 rounded-[2px] bg-[rgba(255,255,255,0.06)] overflow-hidden flex">
          {totals.estimated > 0 && (
            <>
              <div
                className="h-full bg-financial-profit transition-all"
                style={{ width: `${Math.min((totals.paid / totals.estimated) * 100, 100)}%` }}
              />
              <div
                className="h-full bg-financial-receivables transition-all"
                style={{ width: `${Math.min((totals.outstanding / totals.estimated) * 100, 100)}%` }}
              />
            </>
          )}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-financial-profit" />
            <span className="font-kosugi text-[9px] text-text-disabled uppercase">{t("financial.paid")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-financial-receivables" />
            <span className="font-kosugi text-[9px] text-text-disabled uppercase">{t("financial.outstanding")}</span>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card className="p-2 space-y-0.5">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("financial.estimated")}
          </span>
          <span className="font-mono text-data-lg text-text-primary block">
            {formatCurrency(totals.estimated)}
          </span>
        </Card>
        <Card className="p-2 space-y-0.5">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("financial.invoiced")}
          </span>
          <span className="font-mono text-data-lg text-financial-revenue block">
            {formatCurrency(totals.invoiced)}
          </span>
        </Card>
        <Card className="p-2 space-y-0.5">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("financial.paid")}
          </span>
          <span className="font-mono text-data-lg text-financial-profit block">
            {formatCurrency(totals.paid)}
          </span>
        </Card>
        <Card className="p-2 space-y-0.5">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("financial.outstanding")}
          </span>
          <span className="font-mono text-data-lg text-financial-receivables block">
            {formatCurrency(totals.outstanding)}
          </span>
        </Card>
      </div>

      {/* Estimates Section */}
      <div>
        <SectionHeader
          title={t("financial.estimates")}
          count={estimates.length}
          action={
            <PermissionGate permission="estimates.create">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/estimates")}
                className="gap-1 text-text-tertiary"
              >
                <Plus className="w-[12px] h-[12px]" />
                {t("financial.newEstimate")}
              </Button>
            </PermissionGate>
          }
        />
        {estimates.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-tertiary mt-2">{t("financial.noEstimates")}</p>
        ) : (
          <div className="space-y-1 mt-2">
            {estimates.map((est) => (
              <div
                key={est.id}
                className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-[rgba(255,255,255,0.02)] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-data-sm text-text-primary">
                    {est.estimateNumber}
                  </span>
                  <span
                    className="font-kosugi text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${ESTIMATE_STATUS_COLORS[est.status]}20`,
                      color: ESTIMATE_STATUS_COLORS[est.status],
                    }}
                  >
                    {est.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-data-sm text-text-primary">
                    {formatCurrency(est.total)}
                  </span>
                  {est.issueDate && (
                    <span className="font-mono text-[10px] text-text-disabled">
                      {new Date(est.issueDate).toLocaleDateString(getDateLocale(locale), {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invoices Section */}
      <div>
        <SectionHeader
          title={t("financial.invoices")}
          count={invoices.length}
          action={
            <PermissionGate permission="invoices.create">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/invoices")}
                className="gap-1 text-text-tertiary"
              >
                <Plus className="w-[12px] h-[12px]" />
                {t("financial.newInvoice")}
              </Button>
            </PermissionGate>
          }
        />
        {invoices.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-tertiary mt-2">{t("financial.noInvoices")}</p>
        ) : (
          <div className="space-y-1 mt-2">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-[rgba(255,255,255,0.02)] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-data-sm text-text-primary">
                    {inv.invoiceNumber}
                  </span>
                  <span
                    className="font-kosugi text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${INVOICE_STATUS_COLORS[inv.status]}20`,
                      color: INVOICE_STATUS_COLORS[inv.status],
                    }}
                  >
                    {inv.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="font-mono text-data-sm text-text-primary block">
                      {formatCurrency(inv.total)}
                    </span>
                    {inv.balanceDue > 0 && inv.balanceDue !== inv.total && (
                      <span className="font-mono text-[10px] text-financial-receivables">
                        {formatCurrency(inv.balanceDue)} {t("financial.due")}
                      </span>
                    )}
                  </div>
                  {inv.dueDate && (
                    <span className="font-mono text-[10px] text-text-disabled">
                      {new Date(inv.dueDate).toLocaleDateString(getDateLocale(locale), {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { t } = useDictionary("projects");
  const tBreadcrumbs = useDictionary("breadcrumbs").t;
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const fromClientId = searchParams.get("fromClient");
  const projectId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const can = usePermissionStore((s) => s.can);
  const canDelete = can("projects.delete");

  // Tab state — map legacy "overview" to "tasks"
  const initialTab = (searchParams.get("tab") as TabId) || "tasks";
  const [activeTab, setActiveTab] = useState<TabId>(
    initialTab === ("overview" as string) ? "tasks" : (["tasks", "financial", "photos", "notes"].includes(initialTab) ? initialTab as TabId : "tasks")
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data hooks
  const {
    data: project,
    isLoading,
    isError,
    error,
    refetch,
  } = useProject(projectId || undefined);

  // Fetch client separately since project.client isn't populated by the query
  const { data: resolvedClient } = useClient(project?.clientId ?? undefined);

  // Also fetch the referring client if navigating from a client page
  const { data: fromClient } = useClient(fromClientId ?? undefined);

  // Fetch tasks for sidebar metrics
  const { data: tasks = [] } = useProjectTasks(projectId || undefined);

  const updateStatusMutation = useUpdateProjectStatus();
  const deleteProjectMutation = useDeleteProject();

  // Set breadcrumb entity name and parent crumbs when coming from client page
  const setEntityName = useBreadcrumbStore((s) => s.setEntityName);
  const clearEntityName = useBreadcrumbStore((s) => s.clearEntityName);
  const setParentCrumbs = useBreadcrumbStore((s) => s.setParentCrumbs);
  const clearParentCrumbs = useBreadcrumbStore((s) => s.clearParentCrumbs);
  usePageTitle(project?.title ?? "Project");
  useEffect(() => {
    if (project) setEntityName(project.title);
    return () => clearEntityName();
  }, [project, setEntityName, clearEntityName]);

  // Set parent crumbs for client → project navigation path
  useEffect(() => {
    if (fromClientId && fromClient) {
      setParentCrumbs([
        { label: tBreadcrumbs("route.clients"), href: "/clients" },
        { label: fromClient.name, href: `/clients/${fromClientId}` },
      ]);
    }
    return () => clearParentCrumbs();
  }, [fromClientId, fromClient, setParentCrumbs, clearParentCrumbs, tBreadcrumbs]);

  // Redirect old overview URLs
  useEffect(() => {
    if (searchParams.get("tab") === "overview") {
      router.replace(`/projects/${projectId}?tab=tasks`, { scroll: false });
    }
  }, [searchParams, projectId, router]);

  // Escape key handler for mobile sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && sidebarOpen) setSidebarOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  // Tab change handler — syncs URL
  function handleTabChange(tab: TabId) {
    setActiveTab(tab);
    router.replace(`/projects/${projectId}?tab=${tab}`, { scroll: false });
  }

  // Handle status change
  function handleStatusChange(newStatus: string) {
    if (!project) return;
    updateStatusMutation.mutate(
      { id: project.id, status: newStatus as ProjectStatus }
    );
  }

  // Handle delete
  function handleDelete() {
    if (!project) return;
    deleteProjectMutation.mutate(project.id, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        router.push("/projects");
      },
    });
  }

  // Loading state
  if (isLoading) {
    return <DetailSkeleton />;
  }

  // Error state
  if (isError || !project) {
    return (
      <DetailError
        message={
          error instanceof Error
            ? error.message
            : t("detail.failedToLoadDesc")
        }
        onRetry={() => refetch()}
        onBack={() => router.push("/projects")}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => router.push("/projects")}
            className="font-mohave text-body text-ops-accent hover:underline shrink-0 cursor-pointer"
          >
            {t("title")}
          </button>
          <span className="text-text-tertiary font-mohave text-body">/</span>
          <span className="font-mohave text-body text-text-primary font-medium truncate">
            {project.title}
          </span>
          <StatusBadge status={statusToKey(project.status)} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
            aria-label={t("sidebar.projectInfo")}
          >
            <Info className="w-[18px] h-[18px]" />
          </button>

          {/* Status change dropdown */}
          <PermissionGate permission="projects.edit">
            <Select
              value={project.status}
              onValueChange={handleStatusChange}
            >
              <SelectTrigger className="w-[140px] h-[32px] text-body-sm">
                <SelectValue placeholder={t("detail.changeStatus")} />
              </SelectTrigger>
              <SelectContent>
                {ALL_PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PermissionGate>

          {/* Edit Project button */}
          <PermissionGate permission="projects.edit">
            <Button
              variant="secondary"
              size="sm"
              className="gap-[6px]"
              onClick={() => {
                toast.info(t("detail.editHint"));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <Edit3 className="w-[14px] h-[14px]" />
              {t("detail.edit")}
            </Button>
          </PermissionGate>

          {/* Overflow menu with Delete */}
          {canDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="w-[16px] h-[16px]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-ops-error focus:text-ops-error"
                >
                  <Trash2 className="w-[14px] h-[14px] mr-2" />
                  {t("detail.deleteProject")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* ── Tab Bar ────────────────────────────────────────────────────────── */}
      <div className="border-b border-border px-6 flex">
        {(["tasks", "financial", "photos", "notes"] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={cn(
              "px-5 py-3 font-mohave text-body-sm cursor-pointer transition-colors",
              activeTab === tab
                ? "text-text-primary border-b-2 border-ops-accent font-medium"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* ── Body: Main + Sidebar ───────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Main content area */}
        <div className="flex-1 overflow-y-auto p-6" key={activeTab}>
          {activeTab === "tasks" && (
            <TaskList
              projectId={project.id}
              companyId={project.companyId || companyId}
            />
          )}
          {activeTab === "financial" && <FinancialTab project={project} />}
          {activeTab === "photos" && <PhotoFeed projectId={project.id} />}
          {activeTab === "notes" && <NotesTab project={project} />}
        </div>

        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-[280px] border-l border-border p-5 overflow-y-auto shrink-0">
          <ProjectSidebar project={project} tasks={tasks} />
        </aside>
      </div>

      {/* ── Mobile Sidebar Slide-over ──────────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="fixed right-0 top-0 bottom-0 w-[280px] bg-background border-l border-border p-5 overflow-y-auto z-50 lg:hidden"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
                  {t("sidebar.projectInfo")}
                </span>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-1 text-text-tertiary hover:text-text-secondary cursor-pointer"
                >
                  <X className="w-[16px] h-[16px]" />
                </button>
              </div>
              <ProjectSidebar project={project} tasks={tasks} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Delete Confirmation Dialog ─────────────────────────────────────── */}
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title={t("detail.deleteProject")}
        description={t("detail.deleteConfirm").replace("{title}", project.title)}
        confirmLabel={t("detail.deleteProject")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteProjectMutation.isPending}
      />
    </div>
  );
}
