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
        <Mail className="w-3 h-3 text-[rgba(255,255,255,0.3)] shrink-0" />
      ) : (
        <MessageSquareText className="w-3 h-3 text-[rgba(89,119,148,0.6)] shrink-0" />
      )}
      <span
        className={cn(
          "font-kosugi text-micro-sm uppercase tracking-wider shrink-0",
          isEmail ? "text-[rgba(255,255,255,0.3)]" : "text-[rgba(89,119,148,0.6)]"
        )}
      >
        {isEmail ? "EMAIL" : "PORTAL"}
      </span>
      {/* Email subject rendered as normal text, not uppercase label */}
      {isEmail && subject && (
        <span className="font-mohave text-caption-sm text-text-tertiary truncate">
          {subject}
        </span>
      )}
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.06)]" />
    </div>
  );
}

interface DateDividerProps {
  label: string;
}

export function DateDivider({ label }: DateDividerProps) {
  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.06)]" />
      <span className="font-kosugi text-micro-sm uppercase tracking-wider text-[rgba(255,255,255,0.25)]">
        {label}
      </span>
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.06)]" />
    </div>
  );
}
