"use client";

import { Calendar, Image, Paperclip, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { ComposerInput } from "./composer-input";

interface ComposerProps {
  value: string;
  onChange: (next: string) => void;
  onSend: (value: string) => void;
  onAttachFile?: () => void;
  onAttachImage?: () => void;
  onDraftWithClaude?: () => void;
  onSchedule?: () => void;
  placeholder?: string;
  /** Disable the whole composer (e.g. while sending). */
  disabled?: boolean;
  /** Optional content rendered above the inner box (draft switcher in 4.2, banner in 4.2). */
  topAccessory?: React.ReactNode;
  /** Optional content rendered below the inner box (edit toolbar in 4.3). */
  bottomAccessory?: React.ReactNode;
  /** Forces the agent-tinted variant even when value is user-authored (4.2 AI-loaded). */
  agentTinted?: boolean;
  /** Override send button labels (4.2). */
  sendLabel?: string;
  /** Override send button styling (4.2). */
  sendVariant?: "accent" | "agent";
  className?: string;
}

const iconBtn =
  "inline-flex h-[26px] w-[26px] items-center justify-center rounded-[4px] text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent";

export function Composer({
  value,
  onChange,
  onSend,
  onAttachFile,
  onAttachImage,
  onDraftWithClaude,
  onSchedule,
  placeholder = "Type a message...",
  disabled,
  topAccessory,
  bottomAccessory,
  agentTinted,
  sendLabel = "SEND",
  sendVariant = "accent",
  className,
}: ComposerProps) {
  const [focused, setFocused] = useState(false);
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled;

  function handleSend() {
    if (!canSend) return;
    onSend(value);
  }

  const innerBoxClass = cn(
    "flex flex-col gap-2 rounded-[6px] border bg-inbox-bg-deep px-3 py-2.5 transition-shadow",
    agentTinted ? "border-agent-border-hi" : "border-border-medium",
    focused &&
      (agentTinted
        ? "shadow-[0_0_0_1px_rgba(138,127,184,0.4)]"
        : "shadow-[0_0_0_1px_rgba(111,148,176,0.4)]"),
  );

  const sendBtnClass = cn(
    "inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-[5px] border px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em]",
    "disabled:cursor-not-allowed disabled:opacity-40",
    sendVariant === "agent"
      ? "border-agent bg-agent/[0.18] text-agent-hi hover:bg-agent/[0.30]"
      : "border-ops-accent bg-transparent text-ops-accent hover:bg-ops-accent hover:text-black",
  );

  return (
    <div
      className={cn(
        "shrink-0 border-t border-line bg-inbox-panel px-3.5 py-3",
        className,
      )}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
    >
      {topAccessory}
      <div className={innerBoxClass}>
        <ComposerInput
          value={value}
          onChange={onChange}
          onSubmit={handleSend}
          placeholder={placeholder}
          disabled={disabled}
          agentTinted={agentTinted}
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAttachFile}
            aria-label="Attach file"
            className={iconBtn}
          >
            <Paperclip aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onAttachImage}
            aria-label="Attach image"
            className={iconBtn}
          >
            <Image aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onDraftWithClaude}
            aria-label="Draft with Claude"
            className={iconBtn}
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onSchedule}
            aria-label="Schedule send"
            className={iconBtn}
          >
            <Calendar aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={sendLabel}
            className={cn(sendBtnClass, "ml-auto")}
          >
            {sendLabel}
            <Send aria-hidden className="h-2.5 w-2.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {bottomAccessory}
    </div>
  );
}
