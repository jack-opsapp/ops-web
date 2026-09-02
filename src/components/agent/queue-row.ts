/**
 * Shared queue-row vocabulary.
 *
 * The queue table and the expanded `ActionDetail` both need the same type
 * icons, tag variants, source deep-links, and relative-age formatting.
 * Lifted verbatim out of the old `ActionCard` so there is exactly one copy.
 */

import {
  FolderKanban,
  ListTodo,
  Receipt,
  Mail,
  CheckCircle2,
  MailCheck,
  UserRoundX,
  Archive,
  FileText,
  BellRing,
  HeartPulse,
  BarChart3,
  Route,
  RefreshCw,
  CalendarCheck,
  BellPlus,
  MessageSquareReply,
  HardHat,
} from "lucide-react";
import type {
  AgentActionPriority,
  AgentActionStatus,
} from "@/lib/types/approval-queue";

// ─── Type Icon Map ────────────────────────────────────────────────────────────

export const ACTION_TYPE_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  create_project: FolderKanban,
  create_task: ListTodo,
  create_invoice: Receipt,
  send_email: Mail,
  send_status_email: MailCheck,
  send_invoice_email: FileText,
  send_payment_reminder: BellRing,
  reassign_task: UserRoundX,
  archive_project: Archive,
  close_project: CheckCircle2,
  client_health_alert: HeartPulse,
  financial_insight: BarChart3,
  optimize_schedule: Route,
  reschedule_tasks: RefreshCw,
  send_appointment_confirmation: CalendarCheck,
  send_appointment_reminder: BellPlus,
  send_day_before_reminder: BellPlus,
  send_schedule_changed: CalendarCheck,
  process_reschedule_request: MessageSquareReply,
  send_subcontractor_coordination: HardHat,
  file_day_closeout: CalendarCheck,
  approve_collections_draft: Receipt,
};

// ─── Priority / Status Tag Variants ───────────────────────────────────────────

/**
 * Priority renders as an earth-tone tag, never as a colored left border
 * (DESIGN.md §14 bans "cards with rounded corners + colored left-border
 * accent"). Only the two priorities that demand attention get a tag —
 * normal and low are the baseline and carry no color, so they stay silent.
 */
export const PRIORITY_TAG: Partial<
  Record<AgentActionPriority, "tan" | "rose">
> = {
  high: "tan",
  urgent: "rose",
};

/**
 * Terminal/in-flight status → tag variant. Olive = the proposal landed,
 * rose = it did not, dim = it was retired without a verdict.
 */
export const STATUS_TAG: Record<
  Exclude<AgentActionStatus, "pending">,
  "olive" | "rose" | "dim"
> = {
  approved: "olive",
  executed: "olive",
  rejected: "rose",
  failed: "rose",
  expired: "dim",
  cancelled: "dim",
};

// ─── Source URL Map ───────────────────────────────────────────────────────────

export function getSourceUrl(
  contextSource: string | null,
  sourceId: string | null
): string | null {
  if (!contextSource || !sourceId) return null;
  switch (contextSource) {
    case "email_thread":
      return `/inbox?thread=${sourceId}`;
    case "schedule_gap":
      return "/schedule";
    case "overdue_task":
      return `/projects?task=${sourceId}`;
    case "project_analysis":
    case "stage_change":
    case "project_lifecycle":
    case "lifecycle_automation": {
      const projectId = sourceId.split(":")[0];
      return projectId ? `/projects/${projectId}` : null;
    }
    case "overdue_detection": {
      const taskId = sourceId.split(":")[0];
      return taskId ? `/projects?task=${taskId}` : null;
    }
    case "estimate_conversion":
      return `/pipeline?estimate=${sourceId}`;
    case "project_completion":
    case "milestone_billing": {
      const pid = sourceId.split(":")[0];
      return pid ? `/projects/${pid}` : null;
    }
    case "invoice_created":
      return `/pipeline?invoice=${sourceId}`;
    case "overdue_invoice": {
      const invId = sourceId.split(":")[0];
      return invId ? `/pipeline?invoice=${invId}` : null;
    }
    case "payment_analysis":
      return `/dashboard?openClient=${sourceId.split(":")[0]}`;
    case "schedule_optimization":
      return "/schedule";
    default:
      return null;
  }
}

// ─── Time Ago (i18n) ──────────────────────────────────────────────────────────

export function timeAgo(date: Date, t: (key: string) => string): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t("time.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return t("time.minutes").replace("{{count}}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours").replace("{{count}}", String(hours));
  const days = Math.floor(hours / 24);
  return t("time.days").replace("{{count}}", String(days));
}
