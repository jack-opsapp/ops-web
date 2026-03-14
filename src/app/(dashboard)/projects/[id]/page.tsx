"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import {
  ArrowLeft,
  Edit3,
  Trash2,
  MapPin,
  FileText,
  Camera,
  StickyNote,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  DollarSign,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type ProjectStatus as StatusBadgeProjectStatus } from "@/components/ops/status-badge";
import { EmptyState } from "@/components/ops/empty-state";
import { SectionHeader } from "@/components/ops/section-header";
import { InfoRow } from "@/components/ops/info-row";
import { UserAvatar } from "@/components/ops/user-avatar";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { TaskList } from "@/components/ops/task-list";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { NotesList } from "@/components/ops/notes-list";
import { NoteComposer } from "@/components/ops/note-composer";
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
import { ProjectPhotoGallery } from "@/components/ops/project-photo-gallery";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useProject,
  useUpdateProjectStatus,
  useDeleteProject,
} from "@/lib/hooks/use-projects";
import { useProjectEstimates, useProjectInvoices } from "@/lib/hooks";
import { useClient } from "@/lib/hooks/use-clients";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useAuthStore } from "@/lib/store/auth-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import {
  type Project,
  ProjectStatus,
  getUserFullName,
} from "@/lib/types/models";
import {
  type Estimate,
  type Invoice,
  EstimateStatus,
  InvoiceStatus,
  ESTIMATE_STATUS_COLORS,
  INVOICE_STATUS_COLORS,
  formatCurrency,
} from "@/lib/types/pipeline";

type TabId = "overview" | "tasks" | "financial" | "photos" | "notes";

const TAB_KEYS: Record<TabId, string> = {
  overview: "detail.overview",
  tasks: "detail.tasks",
  financial: "detail.financial",
  photos: "detail.photos",
  notes: "detail.notes",
};

const TAB_ICONS: { id: TabId; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", icon: FileText },
  { id: "tasks", icon: CheckCircle2 },
  { id: "financial", icon: DollarSign },
  { id: "photos", icon: Camera },
  { id: "notes", icon: StickyNote },
];

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

// ─── Loading Skeleton ──────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-3 max-w-[1200px] animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 bg-background-elevated rounded" />
        <div className="flex-1 space-y-1">
          <div className="h-[32px] bg-background-elevated rounded w-1/3" />
          <div className="h-[14px] bg-background-elevated rounded w-1/5" />
        </div>
      </div>
      {/* Tab bar skeleton */}
      <div className="h-[40px] bg-background-elevated rounded w-full" />
      {/* Content skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-background-card border border-border rounded-lg p-2 space-y-1.5">
            <div className="h-[18px] bg-background-elevated rounded w-1/3" />
            <div className="h-[14px] bg-background-elevated rounded w-full" />
            <div className="h-[14px] bg-background-elevated rounded w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Error State ───────────────────────────────────────────────────────────────

function DetailError({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  const { t } = useDictionary("projects");
  return (
    <div className="space-y-3 max-w-[1200px]">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-[20px] h-[20px]" />
        </Button>
        <span className="font-mohave text-body text-text-tertiary uppercase tracking-wider">{t("detail.project")}</span>
      </div>
      <div className="flex flex-col items-center justify-center py-8 text-center">
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
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ project }: { project: Project }) {
  const { t } = useDictionary("projects");
  const { locale } = useLocale();
  const router = useRouter();
  const { data: client } = useClient(project.clientId ?? undefined);
  const resolvedClient = project.client ?? client;
  const { data: teamData } = useTeamMembers();
  const resolvedTeamMembers = useMemo(() => {
    const users = teamData?.users ?? [];
    return project.teamMemberIds
      .map((id) => users.find((u) => u.id === id))
      .filter(Boolean) as import("@/lib/types/models").User[];
  }, [project.teamMemberIds, teamData]);

  const mapQuery = project.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
      {/* Client Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("detail.client")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {resolvedClient ? (
            <>
              <InfoRow
                label={t("detail.name")}
                value={resolvedClient.name}
              />
              {resolvedClient.email && (
                <InfoRow
                  label={t("detail.email")}
                  value={
                    <a
                      href={`mailto:${resolvedClient.email}`}
                      className="text-ops-accent hover:underline"
                    >
                      {resolvedClient.email}
                    </a>
                  }
                  mono
                />
              )}
              {resolvedClient.phoneNumber && (
                <InfoRow
                  label={t("detail.phone")}
                  value={
                    <a
                      href={`tel:${resolvedClient.phoneNumber}`}
                      className="text-text-primary hover:text-ops-accent"
                    >
                      {resolvedClient.phoneNumber}
                    </a>
                  }
                  mono
                />
              )}
              {resolvedClient.address && (
                <InfoRow
                  label={t("detail.address")}
                  value={resolvedClient.address}
                />
              )}
            </>
          ) : (
            <p className="font-mohave text-body-sm text-text-tertiary">{t("detail.noClient")}</p>
          )}
        </CardContent>
      </Card>

      {/* Location */}
      <Card>
        <CardHeader>
          <CardTitle>{t("detail.location")}</CardTitle>
        </CardHeader>
        <CardContent>
          {project.address ? (
            <>
              <div className="flex items-start gap-1">
                <MapPin className="w-[16px] h-[16px] text-ops-accent shrink-0 mt-[2px]" />
                <p className="font-mohave text-body text-text-primary">{project.address}</p>
              </div>
              {mapQuery && (
                <a
                  href={mapQuery}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-[6px] mt-1 font-mohave text-body-sm text-ops-accent hover:underline"
                >
                  <ExternalLink className="w-[14px] h-[14px]" />
                  {t("detail.openMaps")}
                </a>
              )}
              {/* Map link */}
              {project.address && (
                <button
                  onClick={() => router.push("/map")}
                  className="w-full mt-1.5 h-[120px] bg-background-elevated rounded flex items-center justify-center gap-1 text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  <MapPin className="w-[16px] h-[16px]" />
                  <span className="font-mohave text-body-sm">{t("detail.viewOnMap")}</span>
                </button>
              )}
            </>
          ) : (
            <p className="font-mohave text-body-sm text-text-tertiary">{t("detail.noAddress")}</p>
          )}
        </CardContent>
      </Card>

      {/* Team */}
      <Card>
        <CardHeader>
          <CardTitle>{t("detail.team")}</CardTitle>
        </CardHeader>
        <CardContent>
          {resolvedTeamMembers.length > 0 ? (
            <div className="space-y-1">
              {resolvedTeamMembers.map((member) => (
                <div key={member.id} className="flex items-center gap-1">
                  <UserAvatar
                    name={getUserFullName(member)}
                    imageUrl={member.profileImageURL}
                    size="sm"
                    color={member.userColor ?? undefined}
                  />
                  <div>
                    <p className="font-mohave text-body-sm text-text-primary">
                      {getUserFullName(member)}
                    </p>
                    <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                      {member.role}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mohave text-body-sm text-text-tertiary">{t("detail.noTeam")}</p>
          )}
        </CardContent>
      </Card>

      {/* Dates & Description */}
      <Card>
        <CardHeader>
          <CardTitle>{t("detail.details")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div>
              <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("detail.start")}</span>
              <p className="font-mono text-data-sm text-text-primary">
                {project.startDate
                  ? new Date(project.startDate).toLocaleDateString(getDateLocale(locale), {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : t("detail.notSet")}
              </p>
            </div>
            <div className="h-[1px] flex-1 bg-border-subtle" />
            <div>
              <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("detail.end")}</span>
              <p className="font-mono text-data-sm text-text-primary">
                {project.endDate
                  ? new Date(project.endDate).toLocaleDateString(getDateLocale(locale), {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : t("detail.tbd")}
              </p>
            </div>
          </div>
          {project.projectDescription && (
            <div>
              <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("detail.description")}</span>
              <p className="font-mohave text-body-sm text-text-secondary mt-[4px]">
                {project.projectDescription}
              </p>
            </div>
          )}
          {project.notes && (
            <div>
              <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">{t("detail.notesField")}</span>
              <p className="font-mohave text-body-sm text-text-secondary mt-[4px]">
                {project.notes}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Photos Tab ────────────────────────────────────────────────────────────────

function PhotosTab({ project }: { project: Project }) {
  const { t } = useDictionary("projects");
  const images = project.projectImages ?? [];

  if (images.length === 0) {
    return (
      <EmptyState
        icon={<Camera className="w-[48px] h-[48px]" />}
        title={t("detail.noPhotos")}
        description={t("detail.photosHelper")}
      />
    );
  }

  return (
    <div className="space-y-2">
      <SectionHeader title={t("detail.photos")} count={images.length} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
        {images.map((url, i) => (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative aspect-square bg-background-elevated border border-border rounded overflow-hidden hover:border-ops-accent transition-all"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Project photo ${i + 1}`}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <ExternalLink className="w-[20px] h-[20px] text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Notes Tab ─────────────────────────────────────────────────────────────────

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

// ─── Financial Tab ──────────────────────────────────────────────────────────────

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
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card className="p-2 space-y-0.5">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("detail.estimated")}
          </span>
          <span className="font-mono text-data-lg text-text-primary block">
            {formatCurrency(totals.estimated)}
          </span>
        </Card>
        <Card className="p-2 space-y-0.5">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("detail.invoiced")}
          </span>
          <span className="font-mono text-data-lg text-text-primary block">
            {formatCurrency(totals.invoiced)}
          </span>
        </Card>
        <Card className="p-2 space-y-0.5">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("detail.paid")}
          </span>
          <span className="font-mono text-data-lg text-status-success block">
            {formatCurrency(totals.paid)}
          </span>
        </Card>
        <Card className="p-2 space-y-0.5">
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {t("detail.outstanding")}
          </span>
          <span className="font-mono text-data-lg text-ops-amber block">
            {formatCurrency(totals.outstanding)}
          </span>
        </Card>
      </div>

      {/* Estimates Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("detail.estimates")}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/estimates")}
            className="gap-1 text-text-tertiary"
          >
            <Plus className="w-[12px] h-[12px]" />
            {t("detail.newEstimate")}
          </Button>
        </CardHeader>
        <CardContent>
          {estimates.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-tertiary">{t("detail.noEstimates")}</p>
          ) : (
            <div className="space-y-1">
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
        </CardContent>
      </Card>

      {/* Invoices Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("detail.invoices")}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/invoices")}
            className="gap-1 text-text-tertiary"
          >
            <Plus className="w-[12px] h-[12px]" />
            {t("detail.newInvoice")}
          </Button>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-tertiary">{t("detail.noInvoices")}</p>
          ) : (
            <div className="space-y-1">
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
                        <span className="font-mono text-[10px] text-ops-amber">
                          {formatCurrency(inv.balanceDue)} {t("detail.due")}
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
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

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

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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
    <div className="space-y-3 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
              {project.title}
            </h1>
            <StatusBadge status={statusToKey(project.status) } />
          </div>
          <p className="font-kosugi text-caption text-text-tertiary mt-[2px]">
            {project.client?.name ?? resolvedClient?.name ?? t("detail.noClientHeader")}
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Status change */}
          <Select
            value={project.status}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="w-[160px] h-[40px]">
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
          <Button
            variant="destructive"
            size="icon"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="w-[16px] h-[16px]" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[rgba(255,255,255,0.15)]">
        <SegmentedPicker
          options={TAB_ICONS.map((tab) => ({ value: tab.id, label: t(TAB_KEYS[tab.id]), icon: tab.icon }))}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Tab Content */}
      <div className="animate-fade-in" key={activeTab}>
        {activeTab === "overview" && <OverviewTab project={project} />}
        {activeTab === "tasks" && (
          <TaskList
            projectId={project.id}
            companyId={project.companyId || companyId}
          />
        )}
        {activeTab === "financial" && <FinancialTab project={project} />}
        {activeTab === "photos" && (
          <ProjectPhotoGallery
            projectId={project.id}
            legacyImages={project.projectImages ?? []}
          />
        )}
        {activeTab === "notes" && <NotesTab project={project} />}
      </div>

      {/* Delete Confirmation Dialog */}
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
