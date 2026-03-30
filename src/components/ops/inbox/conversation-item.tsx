"use client";

import { cn } from "@/lib/utils/cn";
import type { InboxConversation } from "@/lib/types/unified-inbox";

interface ConversationItemProps {
  conversation: InboxConversation;
  isActive: boolean;
  onClick: () => void;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConversationItem({
  conversation,
  isActive,
  onClick,
}: ConversationItemProps) {
  const isUnmatched = conversation.type === "unmatched";
  const hasUnread = conversation.unreadCount > 0;

  const channelBadge = conversation.lastMessageChannel === "portal"
    ? { label: "PORTAL", accent: true }
    : isUnmatched
      ? { label: "UNMATCHED", accent: false, warning: true }
      : { label: "EMAIL", accent: false };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-2.5 py-2.5 border-l-2 cursor-pointer transition-colors",
        isActive
          ? "border-l-[#597794] bg-[rgba(89,119,148,0.08)]"
          : "border-l-transparent hover:bg-[rgba(255,255,255,0.02)]",
        !hasUnread && !isActive && "opacity-50"
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* Avatar */}
        <div
          className={cn(
            "w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0",
            "font-kosugi text-micro-sm font-semibold",
            isUnmatched
              ? "bg-[rgba(255,165,0,0.1)] text-[rgba(255,165,0,0.5)]"
              : isActive
                ? "bg-[rgba(89,119,148,0.25)] text-[#597794]"
                : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)]"
          )}
        >
          {conversation.avatarInitials}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "font-mohave text-body-sm truncate",
                isUnmatched ? "italic text-[rgba(255,255,255,0.5)]" : "text-text-primary",
                hasUnread && "font-semibold"
              )}
            >
              {conversation.displayName}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="font-kosugi text-micro-xs text-[rgba(255,255,255,0.25)]">
                {formatRelativeTime(conversation.lastMessageAt)}
              </span>
              {hasUnread && (
                <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-[#597794] text-white font-kosugi text-micro-xs leading-none">
                  {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                </span>
              )}
            </div>
          </div>

          {/* Project name */}
          {conversation.projectName && (
            <span className="font-kosugi text-micro-xs text-[rgba(255,255,255,0.2)] uppercase block mt-0.5 truncate">
              {conversation.projectName}
            </span>
          )}

          {/* Preview */}
          <div className="flex items-center gap-1 mt-1">
            <span
              className={cn(
                "px-1 rounded-[2px] font-kosugi text-micro-xs shrink-0",
                channelBadge.accent
                  ? "bg-[rgba(89,119,148,0.25)] text-[#597794]"
                  : channelBadge.warning
                    ? "bg-[rgba(255,165,0,0.12)] text-[rgba(255,165,0,0.5)]"
                    : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.35)]"
              )}
            >
              {channelBadge.label}
            </span>
            <span className="font-mohave text-body-sm text-[rgba(255,255,255,0.3)] truncate">
              {conversation.lastMessagePreview}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
