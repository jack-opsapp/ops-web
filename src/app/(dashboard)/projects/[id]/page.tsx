"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
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
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ops/status-badge";
import { EmptyState } from "@/components/ops/empty-state";
import { SectionHeader } from "@/components/ops/section-header";
import { InfoRow } from "@/components/ops/info-row";
import { UserAvatar } from "@/components/ops/user-avatar";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { TaskList } from "@/components/ops/task-list";
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
import { useClient } from "@/lib/hooks/use-clients";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  type Project,
  ProjectStatus,
  getUserFullName,
} from "@/lib/types/models";

type TabId = "overview" | "tasks" | "photos" | "notes";

const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: FileText },
  { id: "tasks", label: "Tasks", icon: CheckCircle2 },
  { id: "photos", label: "Photos", icon: Camera },
  { id: "notes", label: "Notes", icon: StickyNote },
];

/**
 * Map ProjectStatus enum to the kebab-case key used by StatusBadge component.
 */
function statusToKey(status: ProjectStatus): string {
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
  return (
    <div className="space-y-3 max-w-[1200px]">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-[20px] h-[20px]" />
        </Button>
        <h1 className="font-mohave text-display text-text-primary tracking-wide">PROJECT</h1>
      </div>
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-[64px] h-[64px] rounded-lg bg-ops-error-muted flex items-center justify-center mb-2">
          <AlertCircle className="w-[32px] h-[32px] text-ops-error" />
        </div>
        <h3 className="font-mohave text-heading text-text-primary">Failed to load project</h3>
        <p className="font-kosugi text-caption text-text-tertiary mt-0.5 max-w-[300px]">{message}</p>
        <div className="flex gap-1 mt-3">
          <Button variant="ghost" onClick={onBack}>Go Back</Button>
          <Button variant="secondary" className="gap-[6px]" onClick={onRetry}>
            <RefreshCw className="w-[16px] h-[16px]" />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ project }: { project: Project }) {
  const { data: client } = useClient(project.clientId ?? undefined);
  const resolvedClient = project.client ?? client;

  const mapQuery = project.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
      {/* Client Info */}
      <Card>
        <CardHeader>
          <CardTitle>Client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {resolvedClient ? (
            <>
              <InfoRow
                label="Name"
                value={resolvedClient.name}
              />
              {resolvedClient.email && (
                <InfoRow
                  label="Email"
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
                  label="Phone"
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
                  label="Address"
                  value={resolvedClient.address}
                />
              )}
            </>
          ) : (
            <p className="font-mohave text-body-sm text-text-tertiary">No client assigned</p>
          )}
        </CardContent>
      </Card>

      {/* Location */}
      <Card>
        <CardHeader>
          <CardTitle>Location</CardTitle>
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
                  Open in Google Maps
                </a>
              )}
              {/* Map placeholder */}
              <div className="mt-1.5 h-[120px] bg-background-elevated border border-border-subtle rounded flex items-center justify-center">
                <span className="font-kosugi text-caption-sm text-text-disabled">Map Preview</span>
              </div>
            </>
          ) : (
            <p className="font-mohave text-body-sm text-text-tertiary">No address set</p>
          )}
        </CardContent>
      </Card>

      {/* Team */}
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent>
          {project.teamMembers && project.teamMembers.length > 0 ? (
            <div className="space-y-1">
              {project.teamMembers.map((member, i) => (
                <div key={member.id || i} className="flex items-center gap-1">
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
          ) : project.teamMemberIds.length > 0 ? (
            <div className="space-y-1">
              {project.teamMemberIds.map((id, i) => (
                <div key={id} className="flex items-center gap-1">
                  <div className="w-[32px] h-[32px] rounded-full bg-ops-accent-muted flex items-center justify-center">
                    <span className="font-mohave text-body-sm text-ops-accent">
                      {id.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-mohave text-body-sm text-text-tertiary">Team Member</p>
                    <span className="font-mono text-[10px] text-text-disabled">{id.slice(0, 12)}...</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mohave text-body-sm text-text-tertiary">No team members assigned</p>
          )}
        </CardContent>
      </Card>

      {/* Dates & Description */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div>
              <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Start</span>
              <p className="font-mono text-data-sm text-text-primary">
                {project.startDate
                  ? new Date(project.startDate).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Not set"}
              </p>
            </div>
            <div className="h-[1px] flex-1 bg-border-subtle" />
            <div>
              <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">End</span>
              <p className="font-mono text-data-sm text-text-primary">
                {project.endDate
                  ? new Date(project.endDate).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "TBD"}
              </p>
            </div>
          </div>
          {project.projectDescription && (
            <div>
              <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Description</span>
              <p className="font-mohave text-body-sm text-text-secondary mt-[4px]">
                {project.projectDescription}
              </p>
            </div>
          )}
          {project.notes && (
            <div>
              <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">Notes</span>
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
  const images = project.projectImages ?? [];

  if (images.length === 0) {
    return (
      <EmptyState
        icon={<Camera className="w-[48px] h-[48px]" />}
        title="No photos uploaded yet"
        description="Project photos will appear here once uploaded from the mobile app."
      />
    );
  }

  return (
    <div className="space-y-2">
      <SectionHeader title="Photos" count={images.length} />
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
  const hasNotes = project.notes && project.notes.trim().length > 0;
  const hasDescription = project.projectDescription && project.projectDescription.trim().length > 0;

  if (!hasNotes && !hasDescription) {
    return (
      <EmptyState
        icon={<StickyNote className="w-[48px] h-[48px]" />}
        title="No notes yet"
        description="Add project notes to keep important details accessible for the team."
      />
    );
  }

  return (
    <div className="space-y-2">
      <SectionHeader title="Project Notes" />
      {hasDescription && (
        <Card>
          <CardContent className="p-1.5">
            <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Description
            </span>
            <p className="font-mohave text-body text-text-secondary mt-[4px]">
              {project.projectDescription}
            </p>
          </CardContent>
        </Card>
      )}
      {hasNotes && (
        <Card>
          <CardContent className="p-1.5">
            <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Notes
            </span>
            <p className="font-mohave text-body text-text-secondary mt-[4px]">
              {project.notes}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showStatusSelect, setShowStatusSelect] = useState(false);

  // Data hooks
  const {
    data: project,
    isLoading,
    isError,
    error,
    refetch,
  } = useProject(projectId || undefined);

  const updateStatusMutation = useUpdateProjectStatus();
  const deleteProjectMutation = useDeleteProject();

  // Handle status change
  function handleStatusChange(newStatus: string) {
    if (!project) return;
    updateStatusMutation.mutate(
      { id: project.id, status: newStatus as ProjectStatus },
      {
        onSuccess: () => setShowStatusSelect(false),
      }
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
            : "Project not found or could not be loaded."
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
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/projects")}
          className="shrink-0 mt-[4px]"
        >
          <ArrowLeft className="w-[20px] h-[20px]" />
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
              {project.title}
            </h1>
            <StatusBadge status={statusToKey(project.status) as any} />
          </div>
          <p className="font-kosugi text-caption text-text-tertiary mt-[2px]">
            {project.client?.name ?? "No Client"}
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
              <SelectValue placeholder="Change Status" />
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
            onClick={() => router.push(`/projects/${project.id}/edit`)}
          >
            <Edit3 className="w-[14px] h-[14px]" />
            Edit
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
      <div className="border-b border-border">
        <div className="flex items-center gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-[6px] px-2 py-1 border-b-2 transition-all font-mohave text-body-sm",
                activeTab === tab.id
                  ? "border-b-ops-accent text-ops-accent"
                  : "border-b-transparent text-text-tertiary hover:text-text-secondary"
              )}
            >
              <tab.icon className="w-[16px] h-[16px]" />
              {tab.label}
            </button>
          ))}
        </div>
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
        {activeTab === "photos" && <PhotosTab project={project} />}
        {activeTab === "notes" && <NotesTab project={project} />}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Project"
        description={`Are you sure you want to delete "${project.title}"? This action can be undone by an administrator.`}
        confirmLabel="Delete Project"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteProjectMutation.isPending}
      />
    </div>
  );
}
