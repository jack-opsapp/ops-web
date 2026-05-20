"use client";

/**
 * Composer — faithful to `reference/v3-messages.jsx :: V3Composer` and
 * `reference/v4-detail.jsx :: V4Composer`.
 *
 * Docked keeps the mobile-safe stacked shell. Floating is a desktop command
 * surface: one dense-glass row, no nested input card, real utility controls
 * only, and Cmd+Enter sends.
 */

import {
  Bold,
  Calendar,
  Image,
  Italic,
  Paperclip,
  Send,
  Sparkles,
} from "lucide-react";
import { useRef, type MutableRefObject, type ReactNode, type Ref } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { KeyHint } from "@/components/ui/key-hint";
import { ComposerInput } from "./composer-input";

interface ComposerProps {
  inputRef?: Ref<HTMLTextAreaElement>;
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
  topAccessory?: ReactNode;
  /** Renders below the inner box (edit toolbar in 4.3). */
  bottomAccessory?: ReactNode;
  /** Forces the agent-tinted variant. */
  agentTinted?: boolean;
  sendLabel?: string;
  sendVariant?: "accent" | "agent";
  surface?: "docked" | "floating";
  className?: string;
}

const iconBtn =
  "inline-flex h-5 w-5 items-center justify-center rounded-[2px] text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black";

const floatingIconBtn =
  "inline-flex h-5 w-5 items-center justify-center rounded-[2px] text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export function Composer({
  inputRef,
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
  surface = "docked",
  className,
}: ComposerProps) {
  const { t } = useDictionary("inbox");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled;
  const isFloating = surface === "floating";
  const resolvedPlaceholder =
    placeholder ??
    t("composer.tacticPlaceholder", "[type message — ⌘↵ to send]");
  const resolvedSendLabel =
    sendLabel ??
    (sendVariant === "agent"
      ? t("composer.sendPhaseC", "SEND PHASE C DRAFT")
      : t("composer.sendTactic", "SEND"));
  const showDraftWithPhaseC = typeof onDraftWithClaude === "function";
  const showAttachFile = typeof onAttachFile === "function";
  const showAttachImage = typeof onAttachImage === "function";
  const showSchedule = typeof onSchedule === "function";
  const showAttachmentDivider =
    showDraftWithPhaseC && (showAttachFile || showAttachImage || showSchedule);

  function handleSend() {
    if (!canSend) return;
    onSend(value);
  }

  function setInputRef(el: HTMLTextAreaElement | null) {
    textareaRef.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) {
      (inputRef as MutableRefObject<HTMLTextAreaElement | null>).current = el;
    }
  }

  function applyMarkdownWrap(prefix: string, suffix: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const next =
      value.slice(0, start) + prefix + selected + suffix + value.slice(end);

    onChange(next);

    const restoreSelection = () => {
      textarea?.focus();
      const selectionStart = start + prefix.length;
      const selectionEnd = selectionStart + selected.length;
      textarea?.setSelectionRange(selectionStart, selectionEnd);
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(restoreSelection);
    } else {
      restoreSelection();
    }
  }

  const innerBoxClass = cn(
    "flex flex-col gap-1.5 rounded-[5px] border bg-inbox-bg-deep px-2.5 py-2 transition-colors",
    agentTinted
      ? "border-agent-border-hi focus-within:border-agent"
      : "border-line-hi focus-within:border-ops-accent"
  );

  const sendBtnClass = isFloating
    ? cn(
        "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-[5px] border px-2",
        "font-cakemono text-[11px] font-light uppercase tracking-[0.14em]",
        "border-line bg-transparent text-text-2 transition-colors hover:bg-inbox-elev hover:text-text",
        "disabled:cursor-not-allowed disabled:text-text-mute disabled:opacity-50"
      )
    : cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[2.5px] border px-3",
        "font-cakemono text-[11px] font-light uppercase tracking-[0.14em]",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        sendVariant === "agent"
          ? "border-agent bg-agent/[0.18] text-agent-hi hover:bg-agent/[0.30]"
          : "border-ops-accent bg-transparent text-ops-accent hover:bg-ops-accent hover:text-black"
      );

  if (isFloating) {
    return (
      <div
        data-inbox-debug-id="C6"
        data-inbox-debug-label="FLOATING COMPOSER"
        className={cn(
          "glass-dense shrink-0 overflow-hidden rounded-modal border border-glass-border px-2 py-1.5",
          "focus-within:border-ops-accent",
          className
        )}
      >
        {topAccessory}
        <div className="flex items-end gap-1.5">
          <div className="flex shrink-0 items-end gap-1 pb-[2px]">
            {showDraftWithPhaseC && (
              <button
                type="button"
                onClick={onDraftWithClaude}
                aria-label={t("composer.draftWithPhaseC", "Draft with Phase C")}
                className={cn(
                  floatingIconBtn,
                  "text-agent hover:text-agent-hi"
                )}
              >
                <Sparkles
                  aria-hidden
                  className="h-3.5 w-3.5"
                  strokeWidth={1.5}
                />
              </button>
            )}
            {showDraftWithPhaseC && (
              <span aria-hidden className="mx-1 h-[18px] w-px bg-line" />
            )}
            <button
              type="button"
              onClick={() => applyMarkdownWrap("**", "**")}
              aria-label={t("composer.formatBold", "Bold")}
              className={floatingIconBtn}
            >
              <Bold aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => applyMarkdownWrap("*", "*")}
              aria-label={t("composer.formatItalic", "Italic")}
              className={floatingIconBtn}
            >
              <Italic aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            {(showAttachFile || showAttachImage || showSchedule) && (
              <span aria-hidden className="mx-1 h-[18px] w-px bg-line" />
            )}
            {showAttachFile && (
              <button
                type="button"
                onClick={onAttachFile}
                aria-label={t("composer.attachFile", "Attach file")}
                className={floatingIconBtn}
              >
                <Paperclip
                  aria-hidden
                  className="h-3.5 w-3.5"
                  strokeWidth={1.5}
                />
              </button>
            )}
            {showAttachImage && (
              <button
                type="button"
                onClick={onAttachImage}
                aria-label={t("composer.attachImage", "Attach image")}
                className={floatingIconBtn}
              >
                <Image aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            )}
            {showSchedule && (
              <button
                type="button"
                onClick={onSchedule}
                aria-label={t("composer.scheduleSend", "Schedule send")}
                className={floatingIconBtn}
              >
                <Calendar
                  aria-hidden
                  className="h-3.5 w-3.5"
                  strokeWidth={1.5}
                />
              </button>
            )}
          </div>
          <ComposerInput
            ref={setInputRef}
            value={value}
            onChange={onChange}
            onSubmit={handleSend}
            placeholder={resolvedPlaceholder}
            disabled={disabled}
            agentTinted={agentTinted}
            className="flex-1 px-1 py-[2px]"
          />
          {onEditDraft && (
            <button
              type="button"
              onClick={onEditDraft}
              className="mb-[2px] inline-flex h-6 shrink-0 items-center rounded-[5px] border border-line bg-transparent px-2 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:bg-inbox-elev hover:text-text"
            >
              {t("composer.editDraftTactic", "EDIT DRAFT")}
            </button>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={resolvedSendLabel}
            className={cn(sendBtnClass, "mb-[2px]")}
          >
            <Send aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            <KeyHint variant="inline" keys={["⌘", "↵"]} />
          </button>
        </div>
        {bottomAccessory}
      </div>
    );
  }

  return (
    <div
      data-inbox-debug-id="C6"
      data-inbox-debug-label="DOCKED COMPOSER"
      className={cn(
        "shrink-0 border-t border-line bg-inbox-panel px-2 py-2",
        className
      )}
    >
      {topAccessory}
      <div className={innerBoxClass}>
        <ComposerInput
          ref={setInputRef}
          value={value}
          onChange={onChange}
          onSubmit={handleSend}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          agentTinted={agentTinted}
        />
        <div className="mt-auto flex items-center gap-1">
          {showDraftWithPhaseC && (
            <button
              type="button"
              onClick={onDraftWithClaude}
              aria-label={t("composer.draftWithPhaseC", "Draft with Phase C")}
              className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] text-agent transition-colors hover:bg-inbox-elev hover:text-agent-hi focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <Sparkles aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          {showAttachmentDivider && (
            <span aria-hidden className="mx-1.5 h-[18px] w-px bg-line" />
          )}
          {showAttachFile && (
            <button
              type="button"
              onClick={onAttachFile}
              aria-label={t("composer.attachFile", "Attach file")}
              className={iconBtn}
            >
              <Paperclip
                aria-hidden
                className="h-3.5 w-3.5"
                strokeWidth={1.5}
              />
            </button>
          )}
          {showAttachImage && (
            <button
              type="button"
              onClick={onAttachImage}
              aria-label={t("composer.attachImage", "Attach image")}
              className={iconBtn}
            >
              <Image aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          {showSchedule && (
            <button
              type="button"
              onClick={onSchedule}
              aria-label={t("composer.scheduleSend", "Schedule send")}
              className={iconBtn}
            >
              <Calendar aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          <div className="flex-1" />
          {onEditDraft && (
            <button
              type="button"
              onClick={onEditDraft}
              className="inline-flex h-6 items-center rounded-[2.5px] border border-line bg-transparent px-2.5 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:bg-inbox-elev hover:text-text"
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
            <Send aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            {resolvedSendLabel}
            <KeyHint variant="inline" keys={["⌘", "↵"]} />
          </button>
        </div>
      </div>
      {bottomAccessory}
    </div>
  );
}
