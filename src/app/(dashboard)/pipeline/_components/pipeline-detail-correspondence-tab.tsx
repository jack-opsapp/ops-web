"use client";

import { useMemo, type ReactNode } from "react";
import { Mail, Paperclip } from "lucide-react";

import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import type {
  OpportunityAssignedContextActivity,
  OpportunityAssignedContextCorrespondence,
} from "@/lib/api/services/opportunity-assigned-context-service";
import { ActivityType } from "@/lib/types/pipeline";
import { cn } from "@/lib/utils/cn";

interface CorrespondenceMessage {
  id: string;
  subject: string | null;
  content: string | null;
  direction: "inbound" | "outbound";
  partyRole: OpportunityAssignedContextCorrespondence["partyRole"] | null;
  hasAttachments: boolean | null;
  occurredAt: Date;
}

function formatMessageTime(date: Date, locale: Locale): string {
  return date.toLocaleTimeString(getDateLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateSeparatorLabel(date: Date, locale: Locale): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString(getDateLocale(locale), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildMessages(
  activities: OpportunityAssignedContextActivity[],
  correspondence: OpportunityAssignedContextCorrespondence[]
): CorrespondenceMessage[] {
  const messages: CorrespondenceMessage[] = [];
  const renderedActivityIds = new Set<string>();

  for (const activity of activities) {
    if (activity.type !== ActivityType.Email || !activity.direction) continue;
    renderedActivityIds.add(activity.id);
    messages.push({
      id: activity.id,
      subject: activity.subject,
      content: activity.bodyText ?? activity.content,
      direction: activity.direction,
      partyRole: null,
      hasAttachments: activity.hasAttachments,
      occurredAt: activity.createdAt,
    });
  }

  for (const event of correspondence) {
    if (event.activityId && renderedActivityIds.has(event.activityId)) continue;
    messages.push({
      id: event.id,
      subject: event.subject,
      content: null,
      direction: event.direction,
      partyRole: event.partyRole,
      hasAttachments: null,
      occurredAt: event.occurredAt,
    });
  }

  return messages.sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
  );
}

function senderLabel(
  message: CorrespondenceMessage,
  contactName: string | null,
  t: (key: string) => string
): string {
  if (message.direction === "outbound") return t("detail.you");
  if (!message.partyRole || message.partyRole === "customer") {
    return contactName ?? "Unknown";
  }
  return message.partyRole.replace(/_/g, " ");
}

function MessageBubble({
  message,
  contactName,
  locale,
  t,
}: {
  message: CorrespondenceMessage;
  contactName: string | null;
  locale: Locale;
  t: (key: string) => string;
}) {
  const isOut = message.direction === "outbound";

  return (
    <div
      data-testid="correspondence-message"
      className={cn(
        "flex max-w-[85%] flex-col",
        isOut ? "items-end self-end" : "items-start self-start"
      )}
    >
      <div
        className={cn(
          "rounded-chip px-1.5 py-1",
          isOut
            ? "border border-border bg-surface-input"
            : "border border-border-subtle bg-fill-neutral-dim"
        )}
      >
        <div className="mb-0.5 flex items-center gap-1.5">
          <div
            className={cn(
              "h-3 w-0.5 shrink-0 rounded-full",
              isOut ? "bg-text-3" : "bg-text-mute"
            )}
          />
          <Mail className="h-2.5 w-2.5 shrink-0 text-text-mute" />
          <span
            className={cn(
              "truncate font-mohave text-caption-sm font-medium",
              isOut ? "text-text-2" : "text-text"
            )}
          >
            {senderLabel(message, contactName, t)}
          </span>
          <span className="ml-auto shrink-0 font-mono text-micro text-text-mute">
            {formatMessageTime(message.occurredAt, locale)}
          </span>
        </div>

        {message.content ? (
          <p className="whitespace-pre-wrap break-words font-mono text-micro leading-relaxed text-text-2">
            {message.content}
          </p>
        ) : message.subject ? (
          <p className="font-mono text-micro italic text-text-mute">
            {message.subject}
          </p>
        ) : null}

        {message.hasAttachments ? (
          <div className="mt-1.5 flex items-center gap-1">
            <Paperclip className="h-3 w-3 text-text-mute" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface PipelineDetailCorrespondenceTabProps {
  activities: OpportunityAssignedContextActivity[];
  correspondence: OpportunityAssignedContextCorrespondence[];
  contactName: string | null;
}

export function PipelineDetailCorrespondenceTab({
  activities,
  correspondence,
  contactName,
}: PipelineDetailCorrespondenceTabProps) {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();
  const messages = useMemo(
    () => buildMessages(activities, correspondence),
    [activities, correspondence]
  );

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Mail className="mb-2 h-5 w-5 text-text-mute" />
        <span className="font-mono text-[11px] text-text-mute">
          {t("detail.noEmailsYet")}
        </span>
      </div>
    );
  }

  const elements: ReactNode[] = [];
  let lastDate: Date | null = null;
  for (const message of messages) {
    if (!lastDate || !isSameDay(lastDate, message.occurredAt)) {
      elements.push(
        <div
          key={`sep-${message.occurredAt.toISOString()}`}
          className="flex items-center gap-2 py-2"
        >
          <div className="flex-1 border-t border-border-subtle" />
          <span className="shrink-0 font-mono text-micro uppercase text-text-mute">
            {dateSeparatorLabel(message.occurredAt, locale)}
          </span>
          <div className="flex-1 border-t border-border-subtle" />
        </div>
      );
    }
    lastDate = message.occurredAt;
    elements.push(
      <MessageBubble
        key={message.id}
        message={message}
        contactName={contactName}
        locale={locale}
        t={t}
      />
    );
  }

  return <div className="flex h-full flex-col gap-1.5">{elements}</div>;
}
