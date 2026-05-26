"use client";

import {
  Archive,
  Clock,
  MoreHorizontal,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { Fragment, forwardRef, type ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { EmailThreadCategory } from "@/lib/types/email-thread";
import { SlashLabel } from "./voice/slash-label";
import { CategoryChip } from "./category-chip";

interface ThreadDetailHeaderProps {
  subject: string;
  /**
   * Raw classifier category. Renders through `<CategoryChip>` so the chip
   * carries the canonical tone-per-category (tan for CUSTOMER, rose for LEGAL,
   * neutral for low-priority MARKETING/RECEIPT/etc.). Pass `null` when the
   * thread hasn't been classified yet — the chip is skipped and the meta
   * strip still renders sender + count.
   */
  category?: EmailThreadCategory | null;
  senderName: string;
  messageCount: number;
  /** @deprecated Use `threadPickerSlot` instead. Held for backward compat with existing call sites; ignored at render time. */
  otherThreadCount?: number;
  /** @deprecated Use `threadPickerSlot` instead. Held for backward compat with existing call sites; ignored at render time. */
  onOpenThreadPicker?: () => void;
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
  /** Inline slot rendered in the meta strip after the message count.
   *  Typically a `<ThreadPicker />` populated by the parent route. */
  threadPickerSlot?: ReactNode;
  /**
   * Triage chip rendered in the title row between the subject and the
   * action-button cluster. Surfaces the active ball-in-court signal
   * (`YOURS · 18H`, `THEIRS · 5D`, `+12D · WAITING`, `DRAFT READY`,
   * `AUTO-SENT`, `CLOSED`) so the operator sees the same actionable state
   * the row carries inline. Driven by computeStateTag in the parent.
   * Omit on rails / states where the chip adds noise.
   */
  triageSlot?: ReactNode;
  className?: string;
}

const iconBtnClass =
  "inline-flex h-[18px] w-[18px] items-center justify-center rounded-[2px] text-text-3 transition-colors hover:text-text-2 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black";

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
      <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
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
  threadPickerSlot,
  triageSlot,
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

  const metaCountText = t("detail.metaCount", "{count} MSG").replace(
    "{count}",
    String(messageCount),
  );
  const metaItems: Array<{ key: string; node: ReactNode }> = [];
  if (category) {
    metaItems.push({
      key: "category",
      node: <CategoryChip category={category} size="sm" />,
    });
  }
  if (senderName.trim().length > 0) {
    metaItems.push({
      key: "sender",
      node: <span className="min-w-0 flex-1 truncate">{senderName}</span>,
    });
  }
  metaItems.push({
    key: "count",
    node: (
      <span className="uppercase tracking-[0.10em] text-text-3">
        {metaCountText}
      </span>
    ),
  });
  if (threadPickerSlot) {
    metaItems.push({
      key: "thread-picker",
      node: threadPickerSlot,
    });
  }

  return (
    <header
      data-inbox-debug-id="C2"
      data-inbox-debug-label="DETAIL HEADER"
      className={cn(
        "shrink-0 border-b border-line px-2.5 pb-1.5 pt-2",
        className,
      )}
    >
      <div className="mb-1 flex items-center gap-2.5">
        <h1 className="m-0 min-w-0 flex-1 truncate font-mohave text-[15px] font-medium leading-tight text-text">
          {subject || t("detail.untitled", "(no subject)")}
        </h1>
        {triageSlot && (
          <div className="flex shrink-0 items-center" data-testid="triage-slot">
            {triageSlot}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {archiveSlot ? archiveSlot(archiveBtn) : archiveBtn}
          {snoozeSlot ? snoozeSlot(snoozeBtn) : snoozeBtn}
          {recategorizeSlot ? recategorizeSlot(recategorizeBtn) : recategorizeBtn}
          {moreSlot ? moreSlot(moreBtn) : moreBtn}
        </div>
      </div>

      <div
        data-testid="detail-header-meta"
        className="flex items-center gap-2 font-mono text-[11px] leading-none text-text-3"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {metaItems.map((item, index) => (
          <Fragment key={item.key}>
            {index > 0 && (
              <span
                aria-hidden
                data-testid="detail-header-meta-separator"
                className="text-text-mute"
              >
              ·
              </span>
            )}
            {item.node}
          </Fragment>
        ))}
      </div>
    </header>
  );
}

export function EmptyDetailHeader({ className }: { className?: string }) {
  const { t } = useDictionary("inbox");
  return (
    <header
      className={cn(
        "shrink-0 border-b border-line px-4 py-6",
        className,
      )}
    >
      <SlashLabel
        label={t("detail.selectThread", "// SELECT THREAD")}
        tone="text-2"
        size="md"
      />
      <div className="mt-2 font-mono text-[11px] text-text-3">
        {t("detail.selectThreadBody", "[—] no thread loaded")}
      </div>
    </header>
  );
}
