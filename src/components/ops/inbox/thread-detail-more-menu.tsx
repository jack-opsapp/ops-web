"use client";

import { Link, Mail, MailOpen, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ThreadDetailMoreMenuProps {
  trigger: ReactNode;
  isUnread: boolean;
  onMarkReadChange: (isRead: boolean) => void;
  onCopyLink: () => void;
  onRefresh: () => void;
}

const menuItemClass =
  "font-mono text-[11px] uppercase tracking-[0.16em] text-text-2 focus:text-text";
const iconClass = "h-3.5 w-3.5 text-text-3";

export function ThreadDetailMoreMenu({
  trigger,
  isUnread,
  onMarkReadChange,
  onCopyLink,
  onRefresh,
}: ThreadDetailMoreMenuProps) {
  const { t } = useDictionary("inbox");
  const MarkIcon = isUnread ? MailOpen : Mail;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-[210px]"
        data-testid="thread-detail-more-menu"
      >
        <DropdownMenuItem
          onSelect={() => onMarkReadChange(isUnread)}
          className={menuItemClass}
        >
          <MarkIcon aria-hidden className={iconClass} strokeWidth={1.5} />
          {isUnread
            ? t("detailMore.markRead", "MARK READ")
            : t("detailMore.markUnread", "MARK UNREAD")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopyLink()} className={menuItemClass}>
          <Link aria-hidden className={iconClass} strokeWidth={1.5} />
          {t("detailMore.copyLink", "COPY THREAD LINK")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onRefresh()} className={menuItemClass}>
          <RefreshCw aria-hidden className={iconClass} strokeWidth={1.5} />
          {t("detailMore.refresh", "REFRESH THREAD")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
