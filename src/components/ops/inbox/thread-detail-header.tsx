"use client";

/**
 * ThreadDetailHeader — faithful to `reference/v4-detail.jsx :: V4Detail`
 * header block (lines 494–530) and `v4-states.jsx :: V4AutoSentDetail`.
 *
 * Two stacked rows inside a `bg-inbox-panel` band with a hairline border:
 *   1. Subject (Mohave 16 / 500 / -0.005em / text · truncated) on the left,
 *      then exactly four 28×28 action icons: archive · clock · tag · more.
 *      No rail toggle, no Open-client button — those sit elsewhere in
 *      this rebuild (rail edge / context-rail external icon).
 *   2. Meta strip (mono 10.5 / no tracking / text-3): category dot + label
 *      · sender · "{n} message(s)".
 *
 * Prev/Next is keyboard-only (J / K) — wired in <ThreadDetail/>.
 */

import {
  Archive,
  Clock,
  MoreHorizontal,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface ThreadDetailHeaderProps {
  subject: string;
  category?: { label: string; dotClassName: string } | null;
  senderName: string;
  messageCount: number;
  /** Render-prop slots — when provided, replace the default handler buttons.
   *  Used to wrap each action in its picker/popover (snooze, recategorize,
   *  archive-confirm). Each slot receives a ready-styled button that should
   *  be wrapped (e.g. via PopoverTrigger asChild). */
  archiveSlot?: (button: ReactNode) => ReactNode;
  snoozeSlot?: (button: ReactNode) => ReactNode;
  recategorizeSlot?: (button: ReactNode) => ReactNode;
  moreSlot?: (button: ReactNode) => ReactNode;
  /** Fallback handlers when slots aren't provided. Called on click. */
  onArchive?: () => void;
  onSnooze?: () => void;
  onRecategorize?: () => void;
  onMore?: () => void;
  className?: string;
}

const iconBtnClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-chip text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent";

const HeaderActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: LucideIcon;
    label: string;
    onClick?: () => void;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function HeaderActionButton({ icon: Icon, label, onClick, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      className={iconBtnClass}
      {...rest}
    >
      <Icon aria-hidden className="h-[13px] w-[13px]" strokeWidth={1.5} />
    </button>
  );
});

export function ThreadDetailHeader({
  subject,
  category,
  senderName,
  messageCount,
  archiveSlot,
  snoozeSlot,
  recategorizeSlot,
  moreSlot,
  onArchive,
  onSnooze,
  onRecategorize,
  onMore,
  className,
}: ThreadDetailHeaderProps) {
  const { t } = useDictionary("inbox");

  const archiveBtn = (
    <HeaderActionButton
      icon={Archive}
      label={t("header.archiveThread", "Archive thread")}
      onClick={onArchive}
    />
  );
  const snoozeBtn = (
    <HeaderActionButton
      icon={Clock}
      label={t("header.snoozeThread", "Snooze thread")}
      onClick={onSnooze}
    />
  );
  const recategorizeBtn = (
    <HeaderActionButton
      icon={Tag}
      label={t("header.recategorize", "Recategorize thread")}
      onClick={onRecategorize}
    />
  );
  const moreBtn = (
    <HeaderActionButton
      icon={MoreHorizontal}
      label={t("header.moreActions", "More actions")}
      onClick={onMore}
    />
  );

  return (
    <header
      className={cn(
        "shrink-0 border-b border-line bg-inbox-panel px-[18px] pb-2.5 pt-3",
        className,
      )}
    >
      {/* Title row — subject + 4 actions */}
      <div className="mb-1.5 flex items-center gap-2.5">
        <h1 className="m-0 min-w-0 flex-1 truncate font-mohave text-[16px] font-medium tracking-[-0.005em] text-text">
          {subject || t("detail.untitled", "(no subject)")}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          {archiveSlot ? archiveSlot(archiveBtn) : archiveBtn}
          {snoozeSlot ? snoozeSlot(snoozeBtn) : snoozeBtn}
          {recategorizeSlot ? recategorizeSlot(recategorizeBtn) : recategorizeBtn}
          {moreSlot ? moreSlot(moreBtn) : moreBtn}
        </div>
      </div>

      {/* Meta strip — category · sender · count */}
      <div
        className="flex items-center gap-2.5 font-mono text-[10.5px] text-text-3"
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
            <span aria-hidden className="text-text-mute">
              ·
            </span>
          </>
        )}
        <span className="truncate">{senderName}</span>
        <span aria-hidden className="text-text-mute">
          ·
        </span>
        <span>
          {messageCount === 1
            ? t("detail.oneMessage", "1 message")
            : t("detail.nMessages", "{count} messages").replace(
                "{count}",
                String(messageCount),
              )}
        </span>
      </div>
    </header>
  );
}
