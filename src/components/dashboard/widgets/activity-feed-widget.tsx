"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  StickyNote,
  Mail,
  Phone,
  MessageSquare,
  Video,
  Send,
  CheckCircle,
  XCircle,
  Receipt,
  DollarSign,
  ArrowRightLeft,
  PlusCircle,
  Trophy,
  XOctagon,
  Settings,
  MapPin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { useScrollFadeScroll } from "./shared/use-scroll-fade-scroll";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { WT, isCompact, showActions } from "@/lib/widget-tokens";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useAuthStore } from "@/lib/store/auth-store";
import { useTeamMembers, useProjects } from "@/lib/hooks";
import {
  ActivityType,
  ACTIVITY_TYPE_COLORS,
} from "@/lib/types/pipeline";
import type { Activity } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { parseDateRequired } from "@/lib/supabase/helpers";
import { ScrollFade } from "./shared/scroll-fade";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WidgetTitle } from "./shared/widget-title";

// ---------------------------------------------------------------------------
// Inline hook — company-wide recent activities
// ---------------------------------------------------------------------------
function useRecentActivities(companyId: string | undefined) {
  return useQuery<Activity[]>({
    queryKey: ["activities", "company-feed", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        throw new Error(`Failed to fetch activities: ${error.message}`);
      }

      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        companyId: row.company_id as string,
        opportunityId: (row.opportunity_id as string) ?? null,
        clientId: (row.client_id as string) ?? null,
        estimateId: (row.estimate_id as string) ?? null,
        invoiceId: (row.invoice_id as string) ?? null,
        projectId: (row.project_id as string) ?? null,
        siteVisitId: (row.site_visit_id as string) ?? null,
        type: row.type as ActivityType,
        subject: row.subject as string,
        content: (row.content as string) ?? null,
        outcome: (row.outcome as string) ?? null,
        direction: (row.direction as Activity["direction"]) ?? null,
        durationMinutes:
          row.duration_minutes != null ? Number(row.duration_minutes) : null,
        attachments: (row.attachments as string[]) ?? [],
        emailThreadId: (row.email_thread_id as string) ?? null,
        emailMessageId: (row.email_message_id as string) ?? null,
        isRead: (row.is_read as boolean) ?? true,
        fromEmail: (row.from_email as string) ?? null,
        // Email-extended fields — widget doesn't display them but the
        // Activity type requires them.
        toEmails: (row.to_emails as string[]) ?? [],
        ccEmails: (row.cc_emails as string[]) ?? [],
        bodyText: (row.body_text as string) ?? null,
        hasAttachments: (row.has_attachments as boolean) ?? false,
        attachmentCount:
          row.attachment_count != null ? Number(row.attachment_count) : 0,
        matchConfidence: (row.match_confidence as string) ?? null,
        matchNeedsReview: (row.match_needs_review as boolean) ?? false,
        suggestedClientId: (row.suggested_client_id as string) ?? null,
        createdBy: (row.created_by as string) ?? null,
        createdAt: parseDateRequired(row.created_at),
      }));
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACTIVITY_TYPE_ICONS: Record<ActivityType, LucideIcon> = {
  [ActivityType.Note]: StickyNote,
  [ActivityType.Email]: Mail,
  [ActivityType.Call]: Phone,
  [ActivityType.TextMessage]: MessageSquare,
  [ActivityType.Meeting]: Video,
  [ActivityType.EstimateSent]: Send,
  [ActivityType.EstimateAccepted]: CheckCircle,
  [ActivityType.EstimateDeclined]: XCircle,
  [ActivityType.InvoiceSent]: Receipt,
  [ActivityType.PaymentReceived]: DollarSign,
  [ActivityType.StageChange]: ArrowRightLeft,
  [ActivityType.Created]: PlusCircle,
  [ActivityType.Won]: Trophy,
  [ActivityType.Lost]: XOctagon,
  [ActivityType.System]: Settings,
  [ActivityType.SiteVisitScheduled]: MapPin,
  [ActivityType.SiteVisit]: MapPin,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function activityColor(type: ActivityType): string {
  return ACTIVITY_TYPE_COLORS[type] ?? WT.muted;
}

function activityTypeLabel(type: ActivityType, t: (key: string) => string): string {
  return t(`activity.type.${type}`) ?? type;
}

function timeAgo(date: Date, t: (key: string) => string): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return t("activity.justNow");
  if (diffMinutes < 60) return t("activity.minutesAgo").replace("{count}", String(diffMinutes));
  if (diffHours < 24) return t("activity.hoursAgo").replace("{count}", String(diffHours));
  if (diffDays === 0) return t("activity.today");
  return t("activity.daysAgo").replace("{count}", String(diffDays));
}

function getActivityPath(activity: Activity): string | null {
  if (activity.projectId) return `/projects/${activity.projectId}`;
  if (activity.opportunityId) return "/pipeline";
  if (activity.invoiceId) return "/books?segment=invoices";
  if (activity.estimateId) return "/books?segment=estimates";
  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ActivityWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ActivityWidget({
  size,
  config,
  onNavigate,
}: ActivityWidgetProps) {
  const { t } = useDictionary("dashboard");
  const openEntity = useWidgetEntityOpen();
  const { company } = useAuthStore();
  const companyId = company?.id;
  const { data: activities, isLoading } = useRecentActivities(companyId);
  const { data: teamData } = useTeamMembers();
  const { data: projectsData } = useProjects();

  const ref = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();
  const [heroCollapsed, setHeroCollapsed] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);

  const count = activities?.length ?? 0;

  // Hero collapse via scroll listener
  const handleScrollTop = useCallback((scrollTop: number) => {
    setHeroCollapsed(scrollTop > 20);
  }, []);

  useScrollFadeScroll(scrollContainerRef, showActions(size), handleScrollTop);

  // Author name lookup
  const authorMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!teamData?.users) return map;
    for (const u of teamData.users) {
      map[u.id] = `${u.firstName} ${u.lastName}`.trim() || u.email || "Unknown";
    }
    return map;
  }, [teamData]);

  // Project name lookup
  const projectNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!projectsData?.projects) return map;
    for (const p of projectsData.projects) {
      if (p.title) map[p.id] = p.title;
    }
    return map;
  }, [projectsData]);

  // LG metrics
  const lgMetrics = useMemo(() => {
    if (!activities || !showActions(size)) return null;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todayActivities = activities.filter((a) => a.createdAt >= todayStart);
    const todayCount = todayActivities.length;
    const activeUsers = new Set(
      todayActivities.map((a) => a.createdBy).filter(Boolean)
    ).size;

    // Most active project
    const projectCounts: Record<string, number> = {};
    for (const a of activities) {
      if (a.projectId) {
        projectCounts[a.projectId] = (projectCounts[a.projectId] ?? 0) + 1;
      }
    }
    let mostActiveProjectName: string | null = null;
    let maxCount = 0;
    for (const [pid, cnt] of Object.entries(projectCounts)) {
      if (cnt > maxCount) {
        maxCount = cnt;
        mostActiveProjectName = projectNameMap[pid] ?? null;
      }
    }

    return { todayCount, activeUsers, mostActiveProjectName };
  }, [activities, size, projectNameMap]);

  // ── XS / SM: Hero-first compact card ─────────────────────────────────────
  if (isCompact(size)) {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <span
            className={`font-mono text-data-lg font-bold leading-none ${
              isLoading
                ? "text-text-mute"
                : count > 0
                  ? "text-text"
                  : "text-text-mute"
            }`}
          >
            {isLoading ? "—" : count}
          </span>
          <WidgetTitle className="mt-1">
            {t("activity.title")}
          </WidgetTitle>
          <span className="font-mono text-micro text-text-mute uppercase mt-0.5 truncate">
            {isLoading
              ? "..."
              : activities && activities.length > 0
                ? activities[0].subject || activityTypeLabel(activities[0].type, t)
                : t("activity.empty")}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.recent") ?? "Recent"} />
        </div>
      </Card>
    );
  }

  // ── MD+: Scrollable activity feed ──────────────────────────────────────
  const defaultMax = size === "lg" || size === "xl" ? 12 : 6;
  const maxItems = listExpanded ? (activities?.length ?? 0) : defaultMax;
  const remaining = (activities?.length ?? 0) - defaultMax;

  const getActivityEntityClick = (activity: Activity): ((e?: React.MouseEvent) => void) | undefined => {
    const color = activityColor(activity.type);
    const title = activity.subject || activityTypeLabel(activity.type, t);

    if (activity.projectId) {
      const projectName = projectNameMap[activity.projectId];
      return (e) => openEntity({
        entityType: "project",
        entityId: activity.projectId!,
        title: projectName || title,
        color,
        event: e,
        fallbackPath: `/projects/${activity.projectId}`,
      });
    }
    if (activity.opportunityId) {
      return (e) => openEntity({
        entityType: "opportunity",
        entityId: activity.opportunityId!,
        title,
        color,
        event: e,
        fallbackPath: "/pipeline",
      });
    }
    if (activity.invoiceId) {
      return (e) => openEntity({
        entityType: "invoice",
        entityId: activity.invoiceId!,
        title,
        color,
        event: e,
        fallbackPath: "/books?segment=invoices",
      });
    }
    if (activity.estimateId) {
      return (e) => openEntity({
        entityType: "estimate",
        entityId: activity.estimateId!,
        title,
        color,
        event: e,
        fallbackPath: "/books?segment=estimates",
      });
    }
    return undefined;
  };

  const renderActivityRows = (items: Activity[]) =>
    items.map((activity, i) => {
      const IconComp = ACTIVITY_TYPE_ICONS[activity.type] ?? Settings;
      const author = activity.createdBy ? authorMap[activity.createdBy] : null;
      const preview = activity.content
        ? activity.content.slice(0, 40) + (activity.content.length > 40 ? "..." : "")
        : null;
      const secondary = [author, preview].filter(Boolean).join(" · ") || undefined;

      return (
        <WidgetLineItem
          key={activity.id}
          indicator={{
            type: "icon",
            icon: IconComp,
            color: activityColor(activity.type),
          }}
          primary={activity.subject || activityTypeLabel(activity.type, t)}
          secondary={secondary}
          metric={timeAgo(activity.createdAt, t)}
          onClick={getActivityEntityClick(activity)}
          index={i}
          isVisible={isVisible}
          reducedMotion={reducedMotion}
        />
      );
    });

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <WidgetTitle>
            {t("activity.title")}
          </WidgetTitle>
          <span className="font-mono text-micro text-text-3">
            {isLoading ? "..." : `${count} ${t("activity.events")}`}
          </span>
        </div>

        {/* LG Hero Metrics */}
        {lgMetrics && showActions(size) && (
          <WidgetHeroCollapse collapsed={heroCollapsed} collapsedHeight="0px" expandedHeight="50px">
            <div className="flex items-start gap-4 mb-2">
              <div>
                <span className="font-mono text-data-lg font-bold text-text block leading-none">
                  {lgMetrics.todayCount}
                </span>
                <span className="font-mono text-micro text-text-3 uppercase">
                  {t("activity.todayCount")}
                </span>
              </div>
              <div>
                <span className="font-mono text-data-lg font-bold text-text block leading-none">
                  {lgMetrics.activeUsers}
                </span>
                <span className="font-mono text-micro text-text-3 uppercase">
                  {t("activity.activeUsers")}
                </span>
              </div>
              {lgMetrics.mostActiveProjectName && (
                <div className="min-w-0">
                  <span className="font-mohave text-caption-sm text-text block truncate leading-none">
                    {lgMetrics.mostActiveProjectName}
                  </span>
                  <span className="font-mono text-micro text-text-3 uppercase">
                    {t("activity.mostActive")}
                  </span>
                </div>
              )}
            </div>
          </WidgetHeroCollapse>
        )}

        {/* Feed list */}
        <div className="flex-1 min-h-0 flex flex-col" ref={scrollContainerRef}>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <span className="font-mono text-[11px] text-text-mute">
                {t("activity.loading")}
              </span>
            </div>
          ) : !activities || activities.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-mute py-2">
              {t("activity.empty")}
            </p>
          ) : listExpanded ? (
            <ScrollFade>
              <div className="flex flex-col gap-[2px]">
                {renderActivityRows(activities)}
              </div>
              <WidgetMoreButton remaining={remaining} expanded={listExpanded} onToggle={() => setListExpanded((v) => !v)} className="mt-1" />
            </ScrollFade>
          ) : (
            <>
              <div className="flex flex-col gap-[2px]">
                {renderActivityRows(activities.slice(0, maxItems))}
              </div>
              {remaining > 0 && (
                <WidgetMoreButton remaining={remaining} expanded={listExpanded} onToggle={() => setListExpanded((v) => !v)} className="mt-1" />
              )}
            </>
          )}
        </div>

      </div>
    </Card>
  );
}
