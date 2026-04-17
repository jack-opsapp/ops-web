"use client";

import { useState, useMemo } from "react";
import { Mail, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { type Activity, ActivityType } from "@/lib/types/pipeline";
import { useOpportunityActivities } from "@/lib/hooks";

// ── Utilities ──

const IMG_RE = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i;

function isImage(url: string): boolean {
  return IMG_RE.test(url);
}

function senderName(raw: string | null): string {
  if (!raw) return "Unknown";
  const m = raw.match(/^(.+?)\s*<.+>$/);
  if (m) return m[1].trim();
  return raw.split("@")[0];
}

function formatMessageTime(d: Date, locale: Locale): string {
  return d.toLocaleTimeString(getDateLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateSeparatorLabel(d: Date, locale: Locale): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(getDateLocale(locale), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ── Thread grouping ──

interface Thread {
  id: string;
  subject: string;
  messages: Activity[];
  latest: Date;
}

function buildThreads(emails: Activity[]): Thread[] {
  const map = new Map<string, Activity[]>();

  for (const e of emails) {
    const key = e.emailThreadId ?? e.id;
    const arr = map.get(key);
    if (arr) arr.push(e);
    else map.set(key, [e]);
  }

  const threads: Thread[] = [];
  for (const [id, msgs] of map) {
    // Sort within thread: newest first
    msgs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    threads.push({
      id,
      subject: msgs[msgs.length - 1].subject || "No subject",
      messages: msgs,
      latest: new Date(msgs[0].createdAt),
    });
  }

  threads.sort((a, b) => b.latest.getTime() - a.latest.getTime());
  return threads;
}

// ── Lightbox ──

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center cursor-pointer"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        className="max-w-[80vw] max-h-[80vh] object-contain rounded-[4px]"
      />
    </div>
  );
}

// ── Single message bubble ──

function MessageBubble({
  msg,
  locale,
  t,
  onImageClick,
}: {
  msg: Activity;
  locale: Locale;
  t: (key: string) => string;
  onImageClick: (url: string) => void;
}) {
  const isOut = msg.direction === "outbound";
  const images = msg.attachments.filter(isImage);
  const files = msg.attachments.filter((u) => !isImage(u));
  const ts = new Date(msg.createdAt);

  return (
    <div
      className={cn(
        "flex flex-col max-w-[85%]",
        isOut ? "self-end items-end" : "self-start items-start"
      )}
    >
      <div
        className={cn(
          "rounded-[4px] px-2.5 py-2",
          isOut
            ? "bg-[rgba(111, 148, 176,0.08)] border border-[rgba(111, 148, 176,0.12)]"
            : "bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]"
        )}
      >
        {/* Sender + time */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <div
            className={cn(
              "w-[3px] h-3 rounded-full shrink-0",
              isOut ? "bg-[#6889A8]" : "bg-[#8BA87C]"
            )}
          />
          <Mail className="w-2.5 h-2.5 text-text-mute shrink-0" />
          <span
            className={cn(
              "font-mohave text-[12px] font-medium truncate",
              isOut ? "text-[#8BAAC4]" : "text-text"
            )}
          >
            {isOut ? t("detail.you") : senderName(msg.fromEmail)}
          </span>
          <span className="font-mono text-micro text-text-mute ml-auto shrink-0">
            {formatMessageTime(ts, locale)}
          </span>
        </div>

        {/* Content */}
        {msg.content ? (
          <p className="font-kosugi text-[11px] text-text-2 leading-[1.6] whitespace-pre-wrap break-words">
            {msg.content}
          </p>
        ) : msg.subject ? (
          <p className="font-kosugi text-[11px] text-text-mute italic">
            {msg.subject}
          </p>
        ) : null}

        {/* Image attachments */}
        {images.length > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {images.slice(0, 4).map((url) => (
              <button
                key={url}
                onClick={(e) => { e.stopPropagation(); onImageClick(url); }}
                className="w-10 h-10 rounded-panel overflow-hidden border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.20)] transition-colors shrink-0"
              >
                <img
                  src={url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
            {images.length > 4 && (
              <span className="font-mono text-micro text-text-mute self-center ml-0.5">
                +{images.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Non-image attachments */}
        {files.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            <Paperclip className="w-3 h-3 text-text-mute" />
            <span className="font-mono text-micro text-text-mute">
              {files.length} file{files.length > 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Thread picker ──

function ThreadPicker({
  threads,
  activeId,
  onSelect,
}: {
  threads: Thread[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 pb-2 mb-1 overflow-x-auto scrollbar-hide">
      {threads.map((thread) => (
        <button
          key={thread.id}
          onClick={() => onSelect(thread.id)}
          className={cn(
            "shrink-0 px-2 py-1 rounded-panel font-mohave text-[11px] transition-colors max-w-[180px] truncate",
            thread.id === activeId
              ? "bg-[rgba(255,255,255,0.08)] text-text"
              : "text-text-mute hover:text-text-3 hover:bg-[rgba(255,255,255,0.03)]"
          )}
        >
          {thread.subject}
          <span className="font-mono text-micro text-text-mute ml-1">
            {thread.messages.length}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Exported tab ──

interface DetailPopoverCorrespondenceTabProps {
  opportunityId: string;
}

export function DetailPopoverCorrespondenceTab({
  opportunityId,
}: DetailPopoverCorrespondenceTabProps) {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();
  const { data: activities } = useOpportunityActivities(opportunityId);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const emails = useMemo(
    () => (activities ?? []).filter((a) => a.type === ActivityType.Email),
    [activities]
  );
  const threads = useMemo(() => buildThreads(emails), [emails]);

  const resolvedId = activeThreadId ?? threads[0]?.id ?? null;
  const activeThread = threads.find((th) => th.id === resolvedId);

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Mail className="w-5 h-5 text-text-mute mb-2" />
        <span className="font-kosugi text-[11px] text-text-mute">
          {t("detail.noEmailsYet")}
        </span>
      </div>
    );
  }

  // Build message list with date separators (newest first)
  const elements: React.ReactNode[] = [];
  if (activeThread) {
    let lastDate: Date | null = null;

    for (const msg of activeThread.messages) {
      const d = new Date(msg.createdAt);
      if (!lastDate || !isSameDay(lastDate, d)) {
        elements.push(
          <div
            key={`sep-${d.toISOString()}`}
            className="flex items-center gap-2 py-2"
          >
            <div className="flex-1 border-t border-[rgba(255,255,255,0.05)]" />
            <span className="font-mono text-micro text-text-mute uppercase shrink-0">
              {dateSeparatorLabel(d, locale)}
            </span>
            <div className="flex-1 border-t border-[rgba(255,255,255,0.05)]" />
          </div>
        );
      }
      lastDate = d;

      elements.push(
        <MessageBubble
          key={msg.id}
          msg={msg}
          locale={locale}
          t={t}
          onImageClick={setLightboxSrc}
        />
      );
    }
  }

  return (
    <div className="flex flex-col h-full">
      {threads.length > 1 && (
        <ThreadPicker
          threads={threads}
          activeId={resolvedId!}
          onSelect={setActiveThreadId}
        />
      )}

      <div className="flex flex-col gap-1.5">
        {elements}
      </div>

      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}
