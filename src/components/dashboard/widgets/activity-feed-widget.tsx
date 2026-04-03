"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
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
import { WT, isCompact, showFooter, showActions } from "@/lib/widget-tokens";
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
  if (activity.invoiceId) return "/invoices";
  if (activity.estimateId) return "/estimates";
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
          <div className="flex items-baseline justify-between">
            <span
              className={`font-mono text-data-lg font-bold leading-none ${
                isLoading
                  ? "text-text-disabled"
                  : count > 0
                    ? "text-text-primary"
                    : "text-text-disabled"
              }`}
            >
              {isLoading ? "—" : count}
            </span>
            {showFooter(size) && (
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/inbox"); }}
                className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
              </button>
            )}
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("activity.title")}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-0.5 truncate">
            {isLoading
              ? "..."
              : activities && activities.length > 0
                ? activities[0].subject || activityTypeLabel(activities[0].type, t)
                : t("activity.empty")}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD+: Scrollable activity feed ──────────────────────────────────────
  const maxItems = size === "lg" || size === "xl" ? 12 : 6;

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("activity.title")}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {isLoading ? "..." : `${count} ${t("activity.events")}`}
          </span>
        </div>

        {/* LG Hero Metrics */}
        {lgMetrics && showActions(size) && (
          <WidgetHeroCollapse collapsed={heroCollapsed} collapsedHeight="0px" expandedHeight="50px">
            <div className="flex items-start gap-4 mb-2">
              <div>
                <span className="font-mono text-data-lg font-bold text-text-primary block leading-none">
                  {lgMetrics.todayCount}
                </span>
                <span className="font-kosugi text-micro text-text-tertiary uppercase">
                  {t("activity.todayCount")}
                </span>
              </div>
              <div>
                <span className="font-mono text-data-lg font-bold text-text-primary block leading-none">
                  {lgMetrics.activeUsers}
                </span>
                <span className="font-kosugi text-micro text-text-tertiary uppercase">
                  {t("activity.activeUsers")}
                </span>
              </div>
              {lgMetrics.mostActiveProjectName && (
                <div className="min-w-0">
                  <span className="font-mohave text-caption-sm text-text-primary block truncate leading-none">
                    {lgMetrics.mostActiveProjectName}
                  </span>
                  <span className="font-kosugi text-micro text-text-tertiary uppercase">
                    {t("activity.mostActive")}
                  </span>
                </div>
              )}
            </div>
          </WidgetHeroCollapse>
        )}

        {/* Feed list */}
        <div ref={scrollContainerRef}>
          <ScrollFade>
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <span className="font-mono text-[11px] text-text-disabled">
                  {t("activity.loading")}
                </span>
              </div>
            ) : !activities || activities.length === 0 ? (
              <p className="font-mohave text-body-sm text-text-disabled py-2">
                {t("activity.empty")}
              </p>
            ) : (
              <div className="flex flex-col gap-[2px]">
                {activities.slice(0, maxItems).map((activity, i) => {
                  const IconComp = ACTIVITY_TYPE_ICONS[activity.type] ?? Settings;
                  const author = activity.createdBy ? authorMap[activity.createdBy] : null;
                  const preview = activity.content
                    ? activity.content.slice(0, 40) + (activity.content.length > 40 ? "..." : "")
                    : null;
                  const secondary = [author, preview].filter(Boolean).join(" · ") || undefined;
                  const path = getActivityPath(activity);

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
                      onClick={path ? () => onNavigate(path) : undefined}
                      index={i}
                      isVisible={isVisible}
                      reducedMotion={reducedMotion}
                    />
                  );
                })}
                {activities.length > maxItems && (
                  <span className="font-mono text-[11px] text-text-disabled block px-1 pt-1">
                    +{activities.length - maxItems} {t("activity.more") ?? "more"}
                  </span>
                )}
              </div>
            )}
          </ScrollFade>
        </div>

        {/* Footer nav */}
        <button
          onClick={() => onNavigate("/inbox")}
          className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
        >
          {t("activity.viewAll")}
        </button>
      </div>
    </Card>
  );
}
