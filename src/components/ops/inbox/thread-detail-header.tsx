"use client";

/**
 * ThreadDetailHeader — faithful to `reference/v4-detail.jsx :: V4Detail`
 * (and `reference/v3-messages.jsx :: V3MessagesPane`) header block.
 *
 * Two stacked rows inside a `bg-inbox-panel` band with a hairline border:
 *   1. Subject (Mohave 16 / 500 / -0.005em / text · truncated) on the left,
 *      then 4 action icons (archive · clock · tag · more) and the rail
 *      toggle on the right.
 *   2. Meta strip (mono 10.5 / 0.2em / text-3): category dot + label · sender
 *      · message count, with optional clientType + Open client at the right.
 *
 * Prev/Next is keyboard only (J / K) — the spec mocks don't render arrow
 * buttons in this header. Cmd+K opens the global command palette.
 */

import {
  Archive,
  Clock,
  ExternalLink,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Tag,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface ThreadDetailHeaderProps {
  subject: string;
  category?: { label: string; dotClassName: string } | null;
  senderName: string;
  messageCount: number;
  clientType?: string | null;
  onOpenClient?: () => void;
  onArchive: () => void;
  onSnooze: () => void;
  onRecategorize: () => void;
  onMore: () => void;
  onToggleRail: () => void;
  rightRailOpen: boolean;
  className?: string;
}

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-chip text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent";

export function ThreadDetailHeader({
  subject,
  category,
  senderName,
  messageCount,
  clientType,
  onOpenClient,
  onArchive,
  onSnooze,
  onRecategorize,
  onMore,
  onToggleRail,
  rightRailOpen,
  className,
}: ThreadDetailHeaderProps) {
  const { t } = useDictionary("inbox");
  return (
    <header
      className={cn(
        "shrink-0 border-b border-line bg-inbox-panel px-[18px] pb-2.5 pt-3",
        className,
      )}
    >
      {/* Title row */}
      <div className="mb-1.5 flex items-center gap-2.5">
        <h1 className="m-0 min-w-0 flex-1 truncate font-mohave text-[16px] font-medium tracking-[-0.005em] text-text">
          {subject || t("detail.untitled", "(no subject)")}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onArchive}
            aria-label={t("header.archiveThread", "Archive thread")}
            className={iconBtn}
          >
            <Archive aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onSnooze}
            aria-label={t("header.snoozeThread", "Snooze thread")}
            className={iconBtn}
          >
            <Clock aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onRecategorize}
            aria-label={t("header.recategorize", "Recategorize thread")}
            className={iconBtn}
          >
            <Tag aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onMore}
            aria-label={t("header.moreActions", "More actions")}
            className={iconBtn}
          >
            <MoreHorizontal aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onToggleRail}
            aria-label={t("header.toggleContextRail", "Toggle context rail")}
            aria-pressed={rightRailOpen}
            className={cn(iconBtn, "ml-1")}
          >
            {rightRailOpen ? (
              <PanelRightClose aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <PanelRightOpen aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>

      {/* Meta strip */}
      <div
        className="flex items-center gap-2.5 font-mono text-[10.5px] tracking-[0.2em] text-text-3"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {category && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "h-[5px] w-[5px] rounded-full opacity-90",
                  category.dotClassName,
                )}
              />
              <span>{category.label}</span>
            </span>
            <span aria-hidden className="text-text-mute">·</span>
          </>
        )}
        <span className="truncate">{senderName}</span>
        <span aria-hidden className="text-text-mute">·</span>
        <span>
          {messageCount === 1
            ? t("detail.oneMessage", "1 message")
            : t("detail.nMessages", "{count} messages").replace(
                "{count}",
                String(messageCount),
              )}
        </span>
        {(clientType || onOpenClient) && (
          <>
            <div className="flex-1" />
            {clientType && (
              <span className="text-text-mute normal-case">{clientType}</span>
            )}
            {onOpenClient && (
              <button
                type="button"
                onClick={onOpenClient}
                className="inline-flex items-center gap-1 font-mohave text-[11px] tracking-normal text-text-3 hover:text-text-2"
              >
                <ExternalLink
                  aria-hidden
                  className="h-2.5 w-2.5"
                  strokeWidth={1.75}
                />
                {t("detail.openClient", "Open client")}
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
