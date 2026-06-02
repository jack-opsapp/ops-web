import {
  AtSign,
  UserPlus,
  CheckCircle2,
  RefreshCw,
  Radar,
  Settings2,
  Inbox,
  Activity,
  Briefcase,
  FolderInput,
  SquareCheck,
  Check,
  CalendarClock,
  Receipt,
  ReceiptText,
  Copy,
  Sparkle,
  Bot,
  Layers,
  ListChecks,
  CalendarX,
  AlarmClock,
  Circle,
  type LucideIcon,
} from "lucide-react";
import type { NotificationType } from "@/lib/api/services/notification-service";

export type NotificationTone = "critical" | "attn" | "accent" | "ambient";

export interface NotificationMeta {
  /** Short uppercase label for tactical type prefix. Example: "MENTION". */
  label: string;
  /** Lucide icon kebab-case name — resolved to a LucideIcon via lucideIconFromName. */
  icon: string;
  /** Default tone for this type. */
  tone: NotificationTone;
}

export const NOTIF_TYPE_META: Record<NotificationType, NotificationMeta> = {
  mention: { label: "MENTION", icon: "at-sign", tone: "attn" },
  role_needed: { label: "ROLE", icon: "user-plus", tone: "critical" },
  pipeline_complete: { label: "PIPELINE", icon: "check-circle-2", tone: "accent" },
  gmail_sync: { label: "SYNC", icon: "refresh-cw", tone: "ambient" },
  intel_available: { label: "INTEL", icon: "radar", tone: "attn" },
  setup_prompt: { label: "SETUP", icon: "settings-2", tone: "ambient" },
  leads_waiting: { label: "LEADS", icon: "inbox", tone: "attn" },
  system: { label: "SYS", icon: "activity", tone: "ambient" },
  project_assigned: { label: "PROJECT", icon: "briefcase", tone: "accent" },
  lead_converted: { label: "WON", icon: "folder-input", tone: "accent" },
  task_assigned: { label: "TASK", icon: "square-check", tone: "accent" },
  task_completed: { label: "DONE", icon: "check", tone: "ambient" },
  schedule_change: { label: "SCHEDULE", icon: "calendar-clock", tone: "attn" },
  expense_submitted: { label: "EXPENSE", icon: "receipt", tone: "attn" },
  expense_approved: { label: "EXP", icon: "receipt-text", tone: "ambient" },
  duplicates_found: { label: "DUPES", icon: "copy", tone: "critical" },
  duplicates_merged: { label: "MERGED", icon: "check-circle-2", tone: "ambient" },
  data_review_resolved: { label: "DATA REVIEW", icon: "list-checks", tone: "ambient" },
  ai_milestone: { label: "AI", icon: "sparkle", tone: "accent" },
  agent_suggestion: { label: "AGENT", icon: "bot", tone: "accent" },
  // AlarmClock in lucide 0.468 — ClockAlert (0.475+) preferred long-term; upgrade when lucide-react is bumped.
  trial_expiry: { label: "TRIAL", icon: "alarm-clock", tone: "critical" },
  payment_review_stack: { label: "PAY REV", icon: "layers", tone: "attn" },
  task_review_stack: { label: "TASK REV", icon: "list-checks", tone: "attn" },
  unscheduled_review_stack: { label: "UNSCHED", icon: "calendar-x", tone: "attn" },
  email_sync_complete: { label: "INBOX", icon: "inbox", tone: "accent" },
  projects_needing_tasks: { label: "PLAN", icon: "list-checks", tone: "attn" },
  accounting_import_complete: { label: "BOOKS", icon: "receipt-text", tone: "accent" },
};

export const toneRank: Record<NotificationTone, number> = {
  critical: 3,
  attn: 2,
  accent: 1,
  ambient: 0,
};

export function resolveTone(type: NotificationType): NotificationTone {
  return NOTIF_TYPE_META[type]?.tone ?? "accent";
}

const LUCIDE_REGISTRY: Record<string, LucideIcon> = {
  "at-sign": AtSign,
  "user-plus": UserPlus,
  "check-circle-2": CheckCircle2,
  "refresh-cw": RefreshCw,
  radar: Radar,
  "settings-2": Settings2,
  inbox: Inbox,
  activity: Activity,
  briefcase: Briefcase,
  "folder-input": FolderInput,
  "square-check": SquareCheck,
  check: Check,
  "calendar-clock": CalendarClock,
  receipt: Receipt,
  "receipt-text": ReceiptText,
  copy: Copy,
  sparkle: Sparkle,
  bot: Bot,
  "alarm-clock": AlarmClock,
  circle: Circle,
  "layers": Layers,
  "list-checks": ListChecks,
  "calendar-x": CalendarX,
};

export function lucideIconFromName(name: string): LucideIcon {
  return LUCIDE_REGISTRY[name] ?? Circle;
}
