"use client";

import {
  Archive,
  ChevronDown,
  Clock,
  MoreHorizontal,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "./voice/slash-label";
import { StateTag } from "./state-tag";

interface ThreadDetailHeaderProps {
  subject: string;
  category?: { label: string; dotClassName: string } | null;
  senderName: string;
  messageCount: number;
  /** Number of OTHER threads with the same client. When > 0, renders the picker trigger placeholder. Defaults to 0. */
  otherThreadCount?: number;
  /** Click handler for the thread-picker trigger placeholder (Phase E will route this to a popover). */
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
  className?: string;
}

const iconBtnClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-chip text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black";

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
  otherThreadCount,
  onOpenThreadPicker,
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

  const metaCountText = t("detail.metaCount", "{count} MSG").replace(
    "{count}",
    String(messageCount),
  );

  const pickerCount = otherThreadCount ?? 0;
  const pickerLabelRaw = t("picker.trigger", "{count} OTHER THREADS").replace(
    "{count}",
    String(pickerCount),
  );
  const pickerDisplayText = pickerLabelRaw.replace("▾ ", "");

  return (
    <header
      className={cn(
        "shrink-0 border-b border-line bg-inbox-panel px-2 pb-2.5 pt-3",
        className,
      )}
    >
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

      <div
        className="flex items-center gap-2.5 font-mono text-[11px] text-text-3"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {category && (
          <>
            <StateTag
              tone="neutral"
              variant="solid"
              bracketed
              prefix={category.label.toUpperCase()}
            />
            <span aria-hidden className="text-text-mute">
              ·
            </span>
          </>
        )}
        <span className="truncate">{senderName}</span>
        <span aria-hidden className="text-text-mute">
          ·
        </span>
        <span className="uppercase tracking-[0.10em] text-text-3">
          {metaCountText}
        </span>
        {pickerCount > 0 && (
          <>
            <span aria-hidden className="text-text-mute">
              ·
            </span>
            <button
              type="button"
              data-testid="thread-picker-trigger"
              onClick={onOpenThreadPicker}
              aria-label={pickerLabelRaw}
              className="inline-flex h-[22px] items-center gap-1 rounded-[2.5px] border border-line bg-transparent px-2 font-mono text-[11px] uppercase tracking-[0.10em] text-text-2 transition-colors hover:border-line-hi hover:text-text"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              <ChevronDown aria-hidden className="h-3 w-3" strokeWidth={1.5} />
              {pickerDisplayText}
            </button>
          </>
        )}
      </div>
    </header>
  );
}

export function EmptyDetailHeader({ className }: { className?: string }) {
  const { t } = useDictionary("inbox");
  return (
    <header
      className={cn(
        "shrink-0 border-b border-line bg-inbox-panel px-4 py-6",
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
