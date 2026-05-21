"use client";

/**
 * MessageList — faithful to the simple `messages.map(m => <V3Bubble m={m}/>)`
 * pattern in `reference/v4-detail.jsx :: V4Detail`. No run grouping or day
 * separators in the canonical reference; bubbles are rendered uniformly with
 * 14px gap between them. Photo bubbles can be inserted via the `inlinePhotos`
 * prop (rendered after the message at `afterMessageIdx`). Drafts are rendered
 * as one distinct C5 draft bubble at the bottom of the message stream, never
 * as normal sent messages.
 */

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pencil, Send, Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { MessageBubble, type BubbleAttachment } from "./message-bubble";
import { PhotoBubble, type PhotoData } from "./photo-bubble";
import { cn } from "@/lib/utils/cn";
import type { MessageForGrouping } from "@/lib/inbox/message-grouping";
import type { DraftSource } from "@/lib/types/email-thread";
import { InboxAvatar } from "./avatar";

export interface RenderableMessage extends MessageForGrouping {
  direction: "inbound" | "outbound";
  body: string;
  /** Display name shown in the meta row beneath the bubble. */
  senderName: string;
  /** Render-friendly time, e.g. "14:05". */
  timestamp?: string;
  /** Initials for the avatar tile. */
  initials?: string;
  /** Filename surfaced as a paperclip indicator in the meta row. */
  attachmentName?: string;
  /** Structured, clickable non-image attachments rendered in the bubble. */
  attachments?: BubbleAttachment[];
}

export interface InlinePhotoEntry {
  /** Index of the message this photo group renders after. */
  afterMessageIdx: number;
  direction: "inbound" | "outbound";
  senderName: string;
  initials?: string;
  timestamp?: string;
  body?: string;
  photos: PhotoData[];
}

export interface RenderableDraft {
  id: string;
  source: DraftSource;
  body: string;
  fromEmail: string;
  updatedAt: string;
}

interface MessageListProps {
  threadId?: string | null;
  messages: RenderableMessage[];
  inlinePhotos?: InlinePhotoEntry[];
  drafts?: RenderableDraft[];
  onEditDraft?: (draft: RenderableDraft) => void;
  onSendDraft?: (draft: RenderableDraft) => void;
  isDraftSending?: boolean;
  sendCompletedAt?: number | null;
  scrollAnchorSignal?: number;
  className?: string;
}

const BOTTOM_THRESHOLD_PX = 96;

export function MessageList({
  threadId,
  messages,
  inlinePhotos = [],
  drafts = [],
  onEditDraft,
  onSendDraft,
  isDraftSending = false,
  sendCompletedAt = null,
  scrollAnchorSignal = 0,
  className,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<string | null | undefined>(undefined);
  const messageCountRef = useRef(messages.length);
  const draftCountRef = useRef(drafts.length);
  const sendCompletedAtRef = useRef<number | null>(sendCompletedAt);
  const scrollAnchorSignalRef = useRef(scrollAnchorSignal);
  const nearBottomRef = useRef(true);

  const photosByMessageIndex = useMemo(() => {
    const map = new Map<number, InlinePhotoEntry[]>();
    for (const entry of inlinePhotos) {
      const list = map.get(entry.afterMessageIdx) ?? [];
      list.push(entry);
      map.set(entry.afterMessageIdx, list);
    }
    return map;
  }, [inlinePhotos]);

  const updateNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = isNearBottom(el);
  };

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;

    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (!nearBottomRef.current) return;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        scrollToBottom(el);
        nearBottomRef.current = true;
        frame = null;
      });
    });

    observer.observe(content);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const threadChanged = threadRef.current !== threadId;
    if (threadChanged) {
      threadRef.current = threadId;
      scrollToBottom(el);
      nearBottomRef.current = true;
      messageCountRef.current = messages.length;
      draftCountRef.current = drafts.length;
      sendCompletedAtRef.current = sendCompletedAt;
      scrollAnchorSignalRef.current = scrollAnchorSignal;
      return;
    }

    const messageCountChanged = messageCountRef.current !== messages.length;
    const draftCountChanged = draftCountRef.current !== drafts.length;
    const sendChanged = sendCompletedAtRef.current !== sendCompletedAt;
    const anchorChanged =
      scrollAnchorSignalRef.current !== scrollAnchorSignal;

    if (
      (messageCountChanged || draftCountChanged || sendChanged || anchorChanged) &&
      nearBottomRef.current
    ) {
      scrollToBottom(el);
      nearBottomRef.current = true;
    }

    messageCountRef.current = messages.length;
    draftCountRef.current = drafts.length;
    sendCompletedAtRef.current = sendCompletedAt;
    scrollAnchorSignalRef.current = scrollAnchorSignal;
  }, [
    threadId,
    messages.length,
    drafts.length,
    sendCompletedAt,
    scrollAnchorSignal,
  ]);

  return (
    <div
      ref={scrollRef}
      data-testid="message-list"
      data-inbox-debug-id="C5"
      data-inbox-debug-label="MESSAGE LIST"
      onScroll={updateNearBottom}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hide px-2.5 py-3",
        className,
      )}
    >
      <div ref={contentRef} className="flex flex-col gap-3">
        {messages.map((m, i) => {
          const photoEntries = photosByMessageIndex.get(i) ?? [];
          return (
            <Fragment key={m.id}>
              <MessageBubble
                direction={m.direction}
                body={m.body}
                source={m.source}
                senderName={m.senderName}
                timestamp={m.timestamp}
                initials={m.initials}
                attachmentName={m.attachmentName}
                attachments={m.attachments}
              />
              {photoEntries.map((photoEntry) => (
                <PhotoBubble
                  key={`${m.id}:photos:${photoEntry.photos.map((p) => p.id).join(":")}`}
                  direction={photoEntry.direction}
                  senderName={photoEntry.senderName}
                  initials={photoEntry.initials}
                  timestamp={photoEntry.timestamp}
                  body={photoEntry.body}
                  photos={photoEntry.photos}
                />
              ))}
            </Fragment>
          );
        })}
        {drafts.length > 0 && (
          <DraftBubble
            drafts={drafts}
            onEditDraft={onEditDraft}
            onSendDraft={onSendDraft}
            isDraftSending={isDraftSending}
          />
        )}
      </div>
    </div>
  );
}

function isNearBottom(el: HTMLElement): boolean {
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  return remaining <= BOTTOM_THRESHOLD_PX;
}

function scrollToBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight;
}

function DraftBubble({
  drafts,
  onEditDraft,
  onSendDraft,
  isDraftSending,
}: {
  drafts: RenderableDraft[];
  onEditDraft?: (draft: RenderableDraft) => void;
  onSendDraft?: (draft: RenderableDraft) => void;
  isDraftSending: boolean;
}) {
  const { t } = useDictionary("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(
    drafts[0]?.id ?? null,
  );

  useEffect(() => {
    if (drafts.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!drafts.some((draft) => draft.id === selectedId)) {
      setSelectedId(drafts[0].id);
    }
  }, [drafts, selectedId]);

  const selectedDraft = drafts.find((draft) => draft.id === selectedId) ?? drafts[0];
  if (!selectedDraft) return null;

  const isAi = selectedDraft.source === "ai";
  const sourceLabel = draftSourceLabel(selectedDraft.source, t);
  const timestamp = formatDraftTimestamp(selectedDraft.updatedAt);

  return (
    <div className="flex w-full flex-row-reverse gap-2.5">
      <InboxAvatar
        name={isAi ? t("messages.sentByPhaseC", "Phase C") : selectedDraft.fromEmail}
        size={24}
        agent={isAi}
      />
      <div className="flex max-w-[68%] flex-col items-end gap-1">
        <div
          data-testid="draft-bubble"
          className={cn(
            "rounded-[8px] border border-dashed px-3 py-2 font-mohave text-[13px] leading-[1.45] text-pretty",
            isAi
              ? "border-agent-border-hi bg-transparent text-agent-text"
              : "border-line-hi bg-transparent text-text",
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1.5 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2">
              {isAi && (
                <Sparkles
                  aria-hidden
                  className="h-3.5 w-3.5 text-agent"
                  strokeWidth={1.5}
                />
              )}
              {t("draftBubble.label", "// DRAFT")}
            </div>
            {drafts.length > 1 && (
              <div
                role="tablist"
                aria-label={t("draftBubble.pickerLabel", "Drafts")}
                className="inline-flex shrink-0 items-center gap-1"
              >
                {drafts.map((draft, index) => {
                  const selected = draft.id === selectedDraft.id;
                  return (
                    <button
                      key={draft.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setSelectedId(draft.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-[2px]",
                        "font-mono text-[11px] uppercase tracking-[0.10em] transition-colors",
                        "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                        selected
                          ? "border-line-hi text-text"
                          : "border-line text-text-3 hover:text-text-2",
                      )}
                      style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                    >
                      {draft.source === "ai" && (
                        <Sparkles
                          aria-hidden
                          className="h-3 w-3 text-agent"
                          strokeWidth={1.5}
                        />
                      )}
                      <span>
                        {t("draftBubble.pickerItem", "{index}")
                          .replace("{index}", String(index + 1))}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className="whitespace-pre-wrap break-words">{selectedDraft.body}</p>

          {(onEditDraft || onSendDraft) && (
            <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-line/70 pt-2">
              {onEditDraft && (
                <button
                  type="button"
                  onClick={() => onEditDraft(selectedDraft)}
                  className="inline-flex h-6 items-center gap-1 rounded-[2.5px] border border-line bg-transparent px-2 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:border-line-hi hover:text-text focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <Pencil aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                  {t("draftBubble.edit", "EDIT")}
                </button>
              )}
              {onSendDraft && (
                <button
                  type="button"
                  disabled={isDraftSending}
                  onClick={() => onSendDraft(selectedDraft)}
                  className="inline-flex h-6 items-center gap-1 rounded-[2.5px] border border-ops-accent bg-transparent px-2 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-ops-accent transition-colors hover:bg-ops-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <Send aria-hidden className="h-3 w-3" strokeWidth={1.5} />
                  {t("draftBubble.send", "SEND")}
                </button>
              )}
            </div>
          )}
        </div>
        <div
          className="flex items-center gap-1.5 font-mono text-[11px] text-text-mute"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          <span className="text-text-3">{sourceLabel}</span>
          {timestamp && (
            <>
              <span aria-hidden>·</span>
              <span>{timestamp}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function draftSourceLabel(
  source: DraftSource,
  t: (key: string, fallback: string) => string,
): string {
  if (source === "ai") return t("draftBubble.phaseC", "PHASE C");
  return t("draftBubble.provider", "YOURS");
}

function formatDraftTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
