"use client";

import { useState, useMemo } from "react";
import {
  Mail,
  Phone,
  MessageSquare,
  Calendar,
  FileText,
  Trophy,
  XCircle,
  ChevronRight,
  DollarSign,
  MapPin,
  Clock,
  Receipt,
  Paperclip,
} from "lucide-react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import {
  type Activity,
  type StageTransition,
  ActivityType,
  ACTIVITY_TYPE_COLORS,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import {
  useOpportunityActivities,
  useStageTransitions,
} from "@/lib/hooks";

// ── Utilities ──

function formatRelativeTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return d.toLocaleDateString(getDateLocale(locale), {
    month: "short",
    day: "numeric",
  });
}

const SYSTEM_TYPES = new Set<ActivityType>([
  ActivityType.StageChange,
  ActivityType.Created,
  ActivityType.Won,
  ActivityType.Lost,
  ActivityType.System,
]);

function isSystemEvent(type: ActivityType): boolean {
  return SYSTEM_TYPES.has(type);
}

function getActivityIcon(type: ActivityType) {
  switch (type) {
    case ActivityType.Email: return Mail;
    case ActivityType.Call: return Phone;
    case ActivityType.TextMessage: return MessageSquare;
    case ActivityType.Note: return MessageSquare;
    case ActivityType.Meeting: return Calendar;
    case ActivityType.EstimateSent: return FileText;
    case ActivityType.EstimateAccepted: return Trophy;
    case ActivityType.EstimateDeclined: return XCircle;
    case ActivityType.InvoiceSent: return Receipt;
    case ActivityType.PaymentReceived: return DollarSign;
    case ActivityType.SiteVisitScheduled: return MapPin;
    case ActivityType.SiteVisit: return MapPin;
    case ActivityType.StageChange: return ChevronRight;
    case ActivityType.Created: return FileText;
    case ActivityType.Won: return Trophy;
    case ActivityType.Lost: return XCircle;
    default: return MessageSquare;
  }
}

// ── Unified timeline node ──

interface TimelineNode {
  id: string;
  date: Date;
  type: ActivityType | "stage_transition";
  label: string;
  color: string;
  isSystem: boolean;
  subject?: string;
  content?: string | null;
  durationMinutes?: number | null;
  outcome?: string | null;
  attachmentCount?: number;
}

function buildTimelineNodes(
  activities: Activity[],
  transitions: StageTransition[],
  locale: Locale,
): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  for (const a of activities) {
    const relTime = formatRelativeTime(a.createdAt, locale);
    let label: string;

    if (a.type === ActivityType.Call && a.durationMinutes) {
      label = `Call (${a.durationMinutes}min) — ${relTime}`;
    } else if (a.type === ActivityType.StageChange) {
      label = `${a.subject} — ${relTime}`;
    } else if (a.type === ActivityType.Created) {
      label = `Created — ${relTime}`;
    } else if (a.type === ActivityType.Won || a.type === ActivityType.Lost) {
      label = `${a.type === ActivityType.Won ? "Won" : "Lost"} — ${relTime}`;
    } else {
      label = `${a.subject || a.type.replace(/_/g, " ")} — ${relTime}`;
    }

    nodes.push({
      id: a.id,
      date: new Date(a.createdAt),
      type: a.type,
      label,
      color: ACTIVITY_TYPE_COLORS[a.type] ?? "var(--text-3)",
      isSystem: isSystemEvent(a.type),
      subject: a.subject,
      content: a.content,
      durationMinutes: a.durationMinutes,
      outcome: a.outcome,
      attachmentCount: a.attachments.length,
    });
  }

  // Merge stage transitions — dedup against StageChange activities by timestamp proximity
  const activityStageTimestamps = new Set(
    activities
      .filter((a) => a.type === ActivityType.StageChange)
      .map((a) => Math.floor(new Date(a.createdAt).getTime() / 1000))
  );

  for (const st of transitions) {
    const tsKey = Math.floor(new Date(st.transitionedAt).getTime() / 1000);
    // Skip if there's already an activity within 1 second of this transition
    if (activityStageTimestamps.has(tsKey)) continue;

    const fromName = st.fromStage ? getStageDisplayName(st.fromStage) : "—";
    const toName = getStageDisplayName(st.toStage);
    const relTime = formatRelativeTime(st.transitionedAt, locale);

    nodes.push({
      id: st.id,
      date: new Date(st.transitionedAt),
      type: "stage_transition",
      label: `Stage ${fromName} → ${toName} — ${relTime}`,
      color: ACTIVITY_TYPE_COLORS[ActivityType.StageChange],
      isSystem: true,
    });
  }

  nodes.sort((a, b) => b.date.getTime() - a.date.getTime());
  return nodes;
}

// ── Hover detail card ──

function DetailCard({ node }: { node: TimelineNode }) {
  return (
    <div className="pointer-events-none absolute left-full top-0 z-10 ml-2 w-[200px] rounded-chip border border-border bg-[var(--surface-glass-dense)] p-2.5 backdrop-blur-xl">
      {node.subject && (
        <p className="font-mohave text-[12px] text-text mb-1 truncate">
          {node.subject}
        </p>
      )}
      {node.content && (
        <p className="font-mono text-[11px] text-text-3 leading-relaxed line-clamp-3">
          {node.content}
        </p>
      )}
      {node.durationMinutes != null && node.durationMinutes > 0 && (
        <span className="font-mono text-micro text-text-mute mt-1 block">
          {node.durationMinutes}min
        </span>
      )}
      {node.outcome && (
        <p className="font-mono text-micro text-text-3 mt-1">
          {node.outcome}
        </p>
      )}
      {node.attachmentCount != null && node.attachmentCount > 0 && (
        <div className="flex items-center gap-1 mt-1">
          <Paperclip className="w-2.5 h-2.5 text-text-mute" />
          <span className="font-mono text-micro text-text-mute">
            {node.attachmentCount}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Exported tab ──

interface PipelineDetailTimelineTabProps {
  opportunityId: string;
}

export function PipelineDetailTimelineTab({
  opportunityId,
}: PipelineDetailTimelineTabProps) {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();
  const { data: activities } = useOpportunityActivities(opportunityId);
  const { data: transitions } = useStageTransitions(opportunityId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const nodes = useMemo(
    () => buildTimelineNodes(activities ?? [], transitions ?? [], locale),
    [activities, transitions, locale]
  );

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Clock className="w-5 h-5 text-text-mute mb-2" />
        <span className="font-mono text-[11px] text-text-mute">
          {t("detail.noActivityYet")}
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="absolute bottom-2 left-[9px] top-2 w-px bg-fill-neutral-dim" />

      <div className="space-y-0">
        {nodes.map((node) => {
          if (node.isSystem) {
            return (
              <div
                key={node.id}
                className="relative flex items-center gap-2.5 py-1.5"
              >
                <div className="relative z-10 w-[18px] h-[18px] flex items-center justify-center shrink-0">
                  <div
                    className="w-[7px] h-[7px] rounded-full"
                    style={{ backgroundColor: node.color }}
                  />
                </div>
                <span className="font-mono text-micro text-text-mute truncate">
                  {node.label}
                </span>
              </div>
            );
          }

          const Icon = getActivityIcon(node.type as ActivityType);
          const isHovered = hoveredId === node.id;

          return (
            <div
              key={node.id}
              className="relative flex items-center gap-2.5 py-1"
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div
                className="relative z-10 w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: `${node.color}15`,
                  border: `1px solid ${node.color}25`,
                }}
              >
                <Icon className="w-[9px] h-[9px]" style={{ color: node.color }} />
              </div>

              <span className="font-mohave text-[12px] text-text truncate">
                {node.label}
              </span>

              {isHovered && <DetailCard node={node} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
