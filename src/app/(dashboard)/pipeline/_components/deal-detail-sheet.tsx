"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  Clock,
  MessageSquare,
  ChevronRight,
  Trophy,
  XCircle,
  Send,
  AlertCircle,
  CheckCircle,
  FileText,
  DollarSign,
  User,
} from "lucide-react";
import {
  type Opportunity,
  type Activity,
  type FollowUp,
  ActivityType,
  FollowUpStatus,
  getStageDisplayName,
  getStageColor,
  getDaysInStage,
  formatCurrency,
  isFollowUpOverdue,
  isFollowUpToday,
  ACTIVITY_TYPE_COLORS,
} from "@/lib/types/pipeline";
import {
  useOpportunityActivities,
  useOpportunityFollowUps,
  useCreateActivity,
  useSiteVisits,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "@/components/ui/toast";
import { CreateSiteVisitModal } from "@/components/ops/site-visit/create-site-visit-modal";
import { SiteVisitDetail } from "@/components/ops/site-visit/site-visit-detail";
import { ActivityCommentSection } from "@/components/ops/activity/activity-comment";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DealDetailSheetProps {
  opportunity: Opportunity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdvanceStage?: () => void;
  onMarkWon?: () => void;
  onMarkLost?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a date as relative time string */
function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Get icon component for an activity type */
function getActivityIcon(type: ActivityType) {
  switch (type) {
    case ActivityType.Note:
      return MessageSquare;
    case ActivityType.Email:
    case ActivityType.EstimateSent:
    case ActivityType.InvoiceSent:
      return Mail;
    case ActivityType.Call:
      return Phone;
    case ActivityType.Meeting:
      return Calendar;
    case ActivityType.EstimateAccepted:
    case ActivityType.Won:
      return Trophy;
    case ActivityType.EstimateDeclined:
    case ActivityType.Lost:
      return XCircle;
    case ActivityType.PaymentReceived:
      return DollarSign;
    case ActivityType.StageChange:
      return ChevronRight;
    case ActivityType.Created:
      return FileText;
    default:
      return MessageSquare;
  }
}

/** Format follow-up countdown */
function formatFollowUpCountdown(dueAt: Date | string): string {
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  return `Due in ${diffDays}d`;
}

// ---------------------------------------------------------------------------
// Contact Info Section
// ---------------------------------------------------------------------------
function ContactInfoSection({ opportunity }: { opportunity: Opportunity }) {
  const hasContact =
    opportunity.contactPhone ||
    opportunity.contactEmail ||
    opportunity.address;

  if (!hasContact) return null;

  return (
    <div className="space-y-1 pb-2 border-b border-border">
      <h4 className="font-mohave text-[10px] text-text-disabled uppercase tracking-widest">
        Contact
      </h4>
      <div className="space-y-0.5">
        {opportunity.contactName && (
          <div className="flex items-center gap-1.5">
            <User className="w-[12px] h-[12px] text-text-disabled shrink-0" />
            <span className="font-kosugi text-[11px] text-text-secondary">
              {opportunity.contactName}
            </span>
          </div>
        )}
        {opportunity.contactPhone && (
          <a
            href={`tel:${opportunity.contactPhone}`}
            className="flex items-center gap-1.5 group"
          >
            <Phone className="w-[12px] h-[12px] text-text-disabled shrink-0" />
            <span className="font-kosugi text-[11px] text-text-secondary group-hover:text-ops-accent transition-colors">
              {opportunity.contactPhone}
            </span>
          </a>
        )}
        {opportunity.contactEmail && (
          <a
            href={`mailto:${opportunity.contactEmail}`}
            className="flex items-center gap-1.5 group"
          >
            <Mail className="w-[12px] h-[12px] text-text-disabled shrink-0" />
            <span className="font-kosugi text-[11px] text-text-secondary group-hover:text-ops-accent transition-colors truncate">
              {opportunity.contactEmail}
            </span>
          </a>
        )}
        {opportunity.address && (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-[12px] h-[12px] text-text-disabled shrink-0" />
            <span className="font-kosugi text-[11px] text-text-secondary">
              {opportunity.address}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow-Ups Section
// ---------------------------------------------------------------------------
function FollowUpsSection({ followUps }: { followUps: FollowUp[] }) {
  const pending = followUps.filter(
    (f) => f.status === FollowUpStatus.Pending
  );

  if (pending.length === 0) return null;

  return (
    <div className="space-y-1 pb-2 border-b border-border">
      <h4 className="font-mohave text-[10px] text-text-disabled uppercase tracking-widest">
        Follow-Ups
      </h4>
      <div className="space-y-0.5">
        {pending.map((fu) => {
          const overdue = isFollowUpOverdue(fu);
          const today = isFollowUpToday(fu);
          return (
            <div
              key={fu.id}
              className={cn(
                "flex items-center justify-between px-1 py-[4px] rounded",
                overdue && "bg-ops-error/5",
                today && !overdue && "bg-ops-amber/5"
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertCircle
                  className={cn(
                    "w-[12px] h-[12px] shrink-0",
                    overdue
                      ? "text-ops-error"
                      : today
                        ? "text-ops-amber"
                        : "text-text-disabled"
                  )}
                />
                <span className="font-kosugi text-[11px] text-text-secondary truncate">
                  {fu.title}
                </span>
              </div>
              <span
                className={cn(
                  "font-mono text-[9px] shrink-0 ml-1",
                  overdue
                    ? "text-ops-error"
                    : today
                      ? "text-ops-amber"
                      : "text-text-disabled"
                )}
              >
                {formatFollowUpCountdown(fu.dueAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity Timeline
// ---------------------------------------------------------------------------
function ActivityTimeline({ activities, companyId }: { activities: Activity[]; companyId?: string }) {
  const sorted = useMemo(
    () =>
      [...activities].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [activities]
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-4 text-center">
        <MessageSquare className="w-[24px] h-[24px] text-text-disabled mb-1" />
        <span className="font-kosugi text-[11px] text-text-disabled">
          No activity yet
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {sorted.map((activity) => {
        const Icon = getActivityIcon(activity.type);
        const color = ACTIVITY_TYPE_COLORS[activity.type] ?? "#9CA3AF";

        return (
          <div
            key={activity.id}
            className="flex items-start gap-1.5 px-1 py-[5px] rounded hover:bg-[rgba(255,255,255,0.02)] transition-colors"
          >
            {/* Icon */}
            <div
              className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 mt-[1px]"
              style={{ backgroundColor: `${color}15` }}
            >
              <Icon
                className="w-[10px] h-[10px]"
                style={{ color }}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="font-mohave text-[11px] text-text-primary truncate">
                  {activity.subject}
                </span>
                <span className="font-mono text-[9px] text-text-disabled shrink-0">
                  {formatRelativeTime(activity.createdAt)}
                </span>
              </div>
              {activity.content && (
                <p className="font-kosugi text-[10px] text-text-tertiary line-clamp-2 mt-[1px]">
                  {activity.content}
                </p>
              )}
              {companyId && (
                <ActivityCommentSection
                  activityId={activity.id}
                  companyId={companyId}
                  defaultCollapsed
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Note Form
// ---------------------------------------------------------------------------
function AddNoteForm({ opportunityId }: { opportunityId: string }) {
  const [note, setNote] = useState("");
  const { company, currentUser } = useAuthStore();
  const createActivity = useCreateActivity();

  const handleSubmit = () => {
    if (!note.trim() || !company) return;

    createActivity.mutate(
      {
        companyId: company.id,
        opportunityId,
        clientId: null,
        estimateId: null,
        invoiceId: null,
        type: ActivityType.Note,
        subject: "Note added",
        content: note.trim(),
        outcome: null,
        direction: null,
        durationMinutes: null,
        createdBy: currentUser?.id ?? null,
      },
      {
        onSuccess: () => {
          setNote("");
          toast.success("Note added");
        },
        onError: () => {
          toast.error("Failed to add note");
        },
      }
    );
  };

  return (
    <div className="space-y-1 pt-2 border-t border-border">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note..."
        rows={2}
        className={cn(
          "w-full bg-background-input text-text-primary font-kosugi text-[11px]",
          "px-1.5 py-1 rounded border border-border resize-none",
          "placeholder:text-text-tertiary",
          "focus:border-ops-accent focus:outline-none"
        )}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="font-kosugi text-[9px] text-text-disabled">
          Cmd+Enter to submit
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!note.trim() || createActivity.isPending}
          loading={createActivity.isPending}
          onClick={handleSubmit}
          className="gap-[4px] h-auto py-[4px] px-1.5"
        >
          <Send className="w-[12px] h-[12px]" />
          Add Note
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deal Detail Sheet
// ---------------------------------------------------------------------------
export function DealDetailSheet({
  opportunity,
  open,
  onOpenChange,
  onAdvanceStage,
  onMarkWon,
  onMarkLost,
}: DealDetailSheetProps) {
  const { company } = useAuthStore();
  const { data: activities } = useOpportunityActivities(opportunity?.id);
  const { data: followUps } = useOpportunityFollowUps(opportunity?.id);
  const { data: siteVisits } = useSiteVisits({ opportunityId: opportunity?.id ?? undefined });
  const [showCreateSiteVisit, setShowCreateSiteVisit] = useState(false);
  const [selectedSiteVisitId, setSelectedSiteVisitId] = useState<string | null>(null);

  if (!opportunity) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Deal Details</SheetTitle>
            <SheetDescription>No deal selected</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const stageColor = getStageColor(opportunity.stage);
  const stageName = getStageDisplayName(opportunity.stage);
  const daysInStage = getDaysInStage(opportunity);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {/* Header */}
        <SheetHeader>
          <div className="flex items-start justify-between gap-2 pr-6">
            <div className="min-w-0">
              <SheetTitle className="truncate">
                {opportunity.title}
              </SheetTitle>
              <SheetDescription className="truncate">
                {opportunity.contactName ?? "No contact"}
              </SheetDescription>
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              {/* Stage badge */}
              <span
                className="font-mono text-[10px] px-[6px] py-[2px] rounded-sm border uppercase"
                style={{
                  color: stageColor,
                  borderColor: `${stageColor}40`,
                  backgroundColor: `${stageColor}15`,
                }}
              >
                {stageName}
              </span>
              {/* Value */}
              {opportunity.estimatedValue != null && (
                <span className="font-mono text-[13px] text-ops-accent font-medium">
                  {formatCurrency(opportunity.estimatedValue)}
                </span>
              )}
            </div>
          </div>

          {/* Stage metadata */}
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-[3px]">
              <Clock className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-mono text-[10px] text-text-disabled">
                {daysInStage}d in stage
              </span>
            </div>
            {opportunity.source && (
              <span className="font-kosugi text-[10px] text-text-disabled capitalize">
                via {opportunity.source.replace(/_/g, " ")}
              </span>
            )}
          </div>
        </SheetHeader>

        <SheetBody className="space-y-2">
          {/* Contact info */}
          <ContactInfoSection opportunity={opportunity} />

          {/* Quick actions */}
          <div className="flex items-center gap-1 pb-2 border-b border-border">
            {onAdvanceStage && (
              <Button
                variant="default"
                size="sm"
                className="gap-[4px] flex-1"
                onClick={onAdvanceStage}
              >
                <ChevronRight className="w-[14px] h-[14px]" />
                Advance
              </Button>
            )}
            <Button
              variant="default"
              size="sm"
              className="gap-[4px] flex-1"
              onClick={() => setShowCreateSiteVisit(true)}
            >
              <MapPin className="w-[14px] h-[14px]" />
              Visit
            </Button>
            {onMarkWon && (
              <Button
                variant="default"
                size="sm"
                className="gap-[4px] flex-1 text-status-success border-status-success/30"
                onClick={onMarkWon}
              >
                <Trophy className="w-[14px] h-[14px]" />
                Won
              </Button>
            )}
            {onMarkLost && (
              <Button
                variant="default"
                size="sm"
                className="gap-[4px] flex-1 text-ops-error border-ops-error/30"
                onClick={onMarkLost}
              >
                <XCircle className="w-[14px] h-[14px]" />
                Lost
              </Button>
            )}
          </div>

          {/* Description */}
          {opportunity.description && (
            <div className="space-y-0.5 pb-2 border-b border-border">
              <h4 className="font-mohave text-[10px] text-text-disabled uppercase tracking-widest">
                Description
              </h4>
              <p className="font-kosugi text-[11px] text-text-secondary whitespace-pre-wrap">
                {opportunity.description}
              </p>
            </div>
          )}

          {/* Follow-ups */}
          {followUps && <FollowUpsSection followUps={followUps} />}

          {/* Site Visits */}
          {(siteVisits ?? []).length > 0 && (
            <div className="space-y-1 pb-2 border-b border-border">
              <h4 className="font-mohave text-[10px] text-text-disabled uppercase tracking-widest">
                Site Visits
              </h4>
              <div className="space-y-0.5">
                {(siteVisits ?? []).map((sv) => (
                  <button
                    key={sv.id}
                    onClick={() => setSelectedSiteVisitId(sv.id)}
                    className="w-full flex items-center justify-between px-1 py-[4px] rounded hover:bg-[rgba(255,255,255,0.03)] transition-colors text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-[12px] h-[12px] text-ops-accent shrink-0" />
                      <span className="font-kosugi text-[11px] text-text-secondary">
                        {new Date(sv.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "font-mono text-[9px] px-[4px] py-[1px] rounded-sm uppercase",
                        sv.status === "completed" && "text-status-success bg-status-success/10",
                        sv.status === "in_progress" && "text-ops-amber bg-ops-amber/10",
                        sv.status === "scheduled" && "text-ops-accent bg-ops-accent/10",
                        sv.status === "cancelled" && "text-text-disabled bg-background-elevated"
                      )}
                    >
                      {sv.status.replace("_", " ")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Activity timeline */}
          <div className="space-y-1">
            <h4 className="font-mohave text-[10px] text-text-disabled uppercase tracking-widest">
              Activity
            </h4>
            <ActivityTimeline activities={activities ?? []} companyId={company?.id} />
          </div>

          {/* Add note */}
          <AddNoteForm opportunityId={opportunity.id} />
        </SheetBody>

        {/* Site Visit Modals */}
        <CreateSiteVisitModal
          opportunityId={opportunity.id}
          clientId={opportunity.clientId}
          open={showCreateSiteVisit}
          onOpenChange={setShowCreateSiteVisit}
        />
        <SiteVisitDetail
          siteVisitId={selectedSiteVisitId}
          open={!!selectedSiteVisitId}
          onOpenChange={(o) => { if (!o) setSelectedSiteVisitId(null); }}
        />
      </SheetContent>
    </Sheet>
  );
}
