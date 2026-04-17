"use client";

import { Mail, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ChannelDividerProps {
  channel: "email" | "portal";
  /** Email subject line (for email threads) */
  subject?: string;
}

export function ChannelDivider({ channel, subject }: ChannelDividerProps) {
  const isEmail = channel === "email";

  return (
    <div className="flex items-center gap-2 my-2">
      {isEmail ? (
        <Mail className="w-3 h-3 text-text-mute shrink-0" />
      ) : (
        <MessageSquareText className="w-3 h-3 text-text-2 shrink-0" />
      )}
      <span
        className={cn(
          "font-mono text-micro uppercase tracking-wider shrink-0",
          isEmail ? "text-text-mute" : "text-text-2"
        )}
      >
        {isEmail ? "EMAIL" : "PORTAL"}
      </span>
      {/* Email subject rendered as normal text, not uppercase label */}
      {isEmail && subject && (
        <span className="font-mohave text-caption-sm text-text-3 truncate">
          {subject}
        </span>
      )}
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  );
}

interface DateDividerProps {
  label: string;
}

export function DateDivider({ label }: DateDividerProps) {
  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px bg-border-subtle" />
      <span className="font-mono text-micro uppercase tracking-wider text-text-mute">
        {label}
      </span>
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  );
}
