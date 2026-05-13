"use client";

/**
 * Composer — faithful to `reference/v3-messages.jsx :: V3Composer` and
 * `reference/v4-detail.jsx :: V4Composer`.
 *
 * Shell padding 12/16/14 (px-2 / py-3 on the 8pt grid), panel bg, line border-top.
 * Inner box: bgDeep, 6px radius, 10/12 padding, min-h 84.
 *   • Border becomes agent-border-hi when agentTinted.
 *   • Composer body (textarea) — Mohave 13 / 1.55 / -0.003em / text-pretty.
 * Bottom toolbar (mt-auto) — 4 ghost icon buttons (paperclip/image/sparkles/
 * calendar), then optional Edit button when AI loaded but unedited, then
 * the filled send button:
 *
 *   default → border-ops-accent · bg-ops-accent/0.16 · text-text · "Send"
 *   agent   → border-agent · bg-agent/0.18 · text-agent-hi · "Send AI draft"
 *
 * Send icon precedes the label per the spec mocks. Cmd+Enter sends.
 */

import { Calendar, Image, Paperclip, Send, Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { KeyHint } from "@/components/ui/key-hint";
import { ComposerInput } from "./composer-input";

interface ComposerProps {
  value: string;
  onChange: (next: string) => void;
  onSend: (value: string) => void;
  onAttachFile?: () => void;
  onAttachImage?: () => void;
  onDraftWithClaude?: () => void;
  onSchedule?: () => void;
  /** Renders an Edit button before the send button — used when an AI draft
   *  is loaded but the user hasn't started editing. */
  onEditDraft?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Renders above the inner box (draft switcher in 4.2, banner in 4.2). */
  topAccessory?: React.ReactNode;
  /** Renders below the inner box (edit toolbar in 4.3). */
  bottomAccessory?: React.ReactNode;
  /** Forces the agent-tinted variant. */
  agentTinted?: boolean;
  sendLabel?: string;
  sendVariant?: "accent" | "agent";
  className?: string;
}

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-chip text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export function Composer({
  value,
  onChange,
  onSend,
  onAttachFile,
  onAttachImage,
  onDraftWithClaude,
  onSchedule,
  onEditDraft,
  placeholder,
  disabled,
  topAccessory,
  bottomAccessory,
  agentTinted,
  sendLabel,
  sendVariant = "accent",
  className,
}: ComposerProps) {
  const { t } = useDictionary("inbox");
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled;
  const resolvedPlaceholder =
    placeholder ?? t("composer.tacticPlaceholder", "[type message — ⌘↵ to send]");
  const resolvedSendLabel =
    sendLabel ??
    (sendVariant === "agent"
      ? t("composer.sendPhaseC", "SEND PHASE C DRAFT")
      : t("composer.sendTactic", "SEND"));

  function handleSend() {
    if (!canSend) return;
    onSend(value);
  }

  const innerBoxClass = cn(
    "flex flex-col gap-2 rounded-[5px] border bg-inbox-bg-deep px-3 py-2.5 transition-colors",
    agentTinted
      ? "border-agent-border-hi focus-within:border-agent"
      : "border-line-hi focus-within:border-ops-accent",
  );

  const sendBtnClass = cn(
    "inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-[2.5px] border px-3.5",
    "font-cakemono text-[11px] font-light uppercase tracking-[0.14em]",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-40",
    sendVariant === "agent"
      ? "border-agent bg-agent/[0.18] text-agent-hi hover:bg-agent/[0.30]"
      : "border-ops-accent bg-transparent text-ops-accent hover:bg-ops-accent hover:text-black",
  );

  return (
    <div
      className={cn(
        "shrink-0 border-t border-line bg-inbox-panel px-2 py-3",
        className,
      )}
    >
      {topAccessory}
      <div className={innerBoxClass}>
        <ComposerInput
          value={value}
          onChange={onChange}
          onSubmit={handleSend}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          agentTinted={agentTinted}
        />
        <div className="mt-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onDraftWithClaude}
            aria-label={t("composer.draftWithPhaseC", "Draft with Phase C")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-chip text-agent transition-colors hover:bg-inbox-elev hover:text-agent-hi focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <Sparkles aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </button>
          <span aria-hidden className="mx-1.5 h-[18px] w-px bg-line" />
          <button
            type="button"
            onClick={onAttachFile}
            aria-label={t("composer.attachFile", "Attach file")}
            className={iconBtn}
          >
            <Paperclip aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={onAttachImage}
            aria-label={t("composer.attachImage", "Attach image")}
            className={iconBtn}
          >
            <Image aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={onSchedule}
            aria-label={t("composer.scheduleSend", "Schedule send")}
            className={iconBtn}
          >
            <Calendar aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </button>
          <div className="flex-1" />
          {onEditDraft && (
            <button
              type="button"
              onClick={onEditDraft}
              className="inline-flex h-[28px] items-center rounded-[2.5px] border border-line bg-transparent px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:bg-inbox-elev hover:text-text"
            >
              {t("composer.editDraftTactic", "EDIT DRAFT")}
            </button>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={resolvedSendLabel}
            className={sendBtnClass}
          >
            <Send aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            {resolvedSendLabel}
            <KeyHint variant="inline" keys={["⌘", "↵"]} />
          </button>
        </div>
      </div>
      {bottomAccessory}
    </div>
  );
}
