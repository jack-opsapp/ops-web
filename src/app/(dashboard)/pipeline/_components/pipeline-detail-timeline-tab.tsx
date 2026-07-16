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
import { ActivityType, ACTIVITY_TYPE_COLORS } from "@/lib/types/pipeline";
import type { OpportunityAssignedContextActivity } from "@/lib/api/services/opportunity-assigned-context-service";

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
    case ActivityType.Email:
      return Mail;
    case ActivityType.Call:
      return Phone;
    case ActivityType.TextMessage:
      return MessageSquare;
    case ActivityType.Note:
      return MessageSquare;
    case ActivityType.Meeting:
      return Calendar;
    case ActivityType.EstimateSent:
      return FileText;
    case ActivityType.EstimateAccepted:
      return Trophy;
    case ActivityType.EstimateDeclined:
      return XCircle;
    case ActivityType.InvoiceSent:
      return Receipt;
    case ActivityType.PaymentReceived:
      return DollarSign;
    case ActivityType.SiteVisitScheduled:
      return MapPin;
    case ActivityType.SiteVisit:
      return MapPin;
    case ActivityType.StageChange:
      return ChevronRight;
    case ActivityType.Created:
      return FileText;
    case ActivityType.Won:
      return Trophy;
    case ActivityType.Lost:
      return XCircle;
    default:
      return MessageSquare;
  }
}

// ── Unified timeline node ──

interface TimelineNode {
  id: string;
  date: Date;
  type: ActivityType;
  label: string;
  color: string;
  isSystem: boolean;
  subject?: string;
  content?: string | null;
  durationMinutes?: number | null;
  outcome?: string | null;
  hasAttachments: boolean;
}

function buildTimelineNodes(
  activities: OpportunityAssignedContextActivity[],
  locale: Locale
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
      hasAttachments: a.hasAttachments,
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
        <p className="mb-1 truncate font-mohave text-[12px] text-text">
          {node.subject}
        </p>
      )}
      {node.content && (
        <p className="line-clamp-3 font-mono text-[11px] leading-relaxed text-text-3">
          {node.content}
        </p>
      )}
      {node.durationMinutes != null && node.durationMinutes > 0 && (
        <span className="mt-1 block font-mono text-micro text-text-mute">
          {node.durationMinutes}min
        </span>
      )}
      {node.outcome && (
        <p className="mt-1 font-mono text-micro text-text-3">{node.outcome}</p>
      )}
      {node.hasAttachments && (
        <div className="mt-1 flex items-center gap-1">
          <Paperclip className="h-2.5 w-2.5 text-text-mute" />
        </div>
      )}
    </div>
  );
}

// ── Exported tab ──

interface PipelineDetailTimelineTabProps {
  activities: OpportunityAssignedContextActivity[];
}

export function PipelineDetailTimelineTab({
  activities,
}: PipelineDetailTimelineTabProps) {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const nodes = useMemo(
    () => buildTimelineNodes(activities, locale),
    [activities, locale]
  );

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Clock className="mb-2 h-5 w-5 text-text-mute" />
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
                <div className="relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                  <div
                    className="h-[7px] w-[7px] rounded-full"
                    style={{ backgroundColor: node.color }}
                  />
                </div>
                <span className="truncate font-mono text-micro text-text-mute">
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
                className="relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: `${node.color}15`,
                  border: `1px solid ${node.color}25`,
                }}
              >
                <Icon
                  className="h-[9px] w-[9px]"
                  style={{ color: node.color }}
                />
              </div>

              <span className="truncate font-mohave text-[12px] text-text">
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
