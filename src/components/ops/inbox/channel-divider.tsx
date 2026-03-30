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
    <div className="flex items-center gap-1.5 my-1.5">
      {isEmail ? (
        <Mail className="w-[10px] h-[10px] text-[rgba(255,255,255,0.2)] shrink-0" />
      ) : (
        <MessageSquareText className="w-[10px] h-[10px] text-[rgba(89,119,148,0.5)] shrink-0" />
      )}
      <span
        className={cn(
          "font-kosugi text-[8px] uppercase tracking-[0.5px] shrink-0",
          isEmail ? "text-[rgba(255,255,255,0.2)]" : "text-[rgba(89,119,148,0.5)]"
        )}
      >
        {isEmail ? (subject ?? "EMAIL") : "CLIENT PORTAL"}
      </span>
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
    </div>
  );
}

interface DateDividerProps {
  label: string;
}

export function DateDivider({ label }: DateDividerProps) {
  return (
    <div className="flex items-center gap-2 my-2">
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
      <span className="font-kosugi text-[9px] uppercase tracking-[0.3px] text-[rgba(255,255,255,0.15)]">
        {label}
      </span>
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
    </div>
  );
}
