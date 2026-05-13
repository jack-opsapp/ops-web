"use client";

/**
 * MessageBubble — faithful to `reference/v3-messages.jsx :: V3Bubble`.
 *
 * One bubble per message. No run-tail logic, no shared avatar gutter — every
 * message renders its avatar (round, 26px). Outbound bubbles use the accent
 * fill (`rgba(111,148,176,0.10)`); AI-authored outbound bubbles use the
 * agent fill. Meta row (sender · time · optional attachment) sits directly
 * under the bubble in the same column, gap 4. Mono meta uses canonical
 * `letterSpacing: 0.2px` (drop the wide em tracking).
 *
 * Children render INSIDE the bubble above the body — for inline photo grids.
 *
 * AI-edit diff toggle (Phase F2): when the bubble is AI-authored AND
 * `originalAiBody` is provided AND the body has been edited, a `DIFF`
 * button appears in the meta row. Toggling it expands an inline word-diff
 * showing operator deletions (strikethrough mute) and insertions (white
 * on lavender highlight). Bubble border switches to dashed while open.
 */

import { diffWords } from "diff";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { GitCompare, Paperclip, Sparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import type { MessageSource } from "@/lib/inbox/message-grouping";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { InboxAvatar } from "./avatar";

/**
 * Non-image file attachment shown as a tactical row above the body of a
 * MessageBubble. Image-type attachments belong in <PhotoBubble>; the parent
 * filters by MIME and decides which surface each attachment renders on.
 */
export interface BubbleAttachment {
  id: string;
  filename: string;
  /** Human-readable size, pre-formatted, e.g. "2.4 MB" or "184 KB". */
  size: string;
  /** Optional click handler — when provided, the row becomes a button. */
  onClick?: () => void;
}

interface MessageBubbleProps {
  direction: "inbound" | "outbound";
  body: string;
  /** Defaults to "human". When "ai" + outbound, lavender variant + provenance. */
  source?: MessageSource;
  /** Display name above the meta row. */
  senderName: string;
  /** Render-friendly time, e.g. "14:05". */
  timestamp?: string;
  /** Initials shown in the avatar tile (max 2 chars). */
  initials?: string;
  /** Filename for an attachment indicator in the meta row. */
  attachmentName?: string;
  /** Children render inside the bubble above the body — used for photo grids. */
  children?: ReactNode;
  className?: string;
  /**
   * Original AI-drafted text before operator edits. When provided AND
   * source="ai" AND direction="outbound" AND the value differs from `body`,
   * a DIFF toggle is rendered.
   */
  originalAiBody?: string;
  /**
   * Operator display name for the diff provenance line (e.g. "JACKSON").
   * Defaults to "OPERATOR".
   */
  operatorName?: string;
  /**
   * Time delta string, e.g. "23S AGO" — appended to the EDITED meta and
   * to the diff toolbar provenance line. Provided by parent.
   */
  editedAgo?: string;
  /**
   * Non-image file attachments rendered as tactical rows above the body.
   * For inline-image attachments use <PhotoBubble> instead. The bubble's meta
   * line appends `· {N} FILES` when this array is non-empty.
   */
  attachments?: BubbleAttachment[];
}

export function MessageBubble({
  direction,
  body,
  source = "human",
  senderName,
  timestamp,
  initials,
  attachmentName,
  children,
  className,
  originalAiBody,
  operatorName,
  editedAgo,
  attachments,
}: MessageBubbleProps) {
  const { t } = useDictionary("inbox");
  const reducedMotion = useReducedMotion();
  const isOutbound = direction === "outbound";
  const isAi = source === "ai" && isOutbound;

  const hasDiff =
    isAi &&
    typeof originalAiBody === "string" &&
    originalAiBody.length > 0 &&
    originalAiBody !== body;

  const [diffOpen, setDiffOpen] = useState(false);

  // Compute word-diff parts only when we actually have a diff to show.
  // Memoized on the original/edited pair so toggling doesn't recompute.
  const diffParts = useMemo(() => {
    if (!hasDiff || !originalAiBody) return [];
    return diffWords(originalAiBody, body).filter(
      (part) => part.value.length > 0,
    );
  }, [hasDiff, originalAiBody, body]);

  const operator = operatorName ?? "OPERATOR";

  // Reduced motion: skip layout/height animation, opacity-only crossfade.
  const motionTransition = reducedMotion
    ? { duration: 0.15 }
    : { duration: 0.2, ease: EASE_SMOOTH };

  return (
    <div
      className={cn(
        "flex w-full gap-2.5",
        isOutbound ? "flex-row-reverse" : "flex-row",
        className,
      )}
    >
      <InboxAvatar
        name={senderName}
        initials={initials}
        size={26}
        agent={isAi}
      />
      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-1",
          isOutbound ? "items-end" : "items-start",
        )}
      >
        <motion.div
          data-testid="message-bubble"
          layout={!reducedMotion}
          transition={motionTransition}
          className={cn(
            "rounded-panel px-3.5 py-2.5 font-mohave text-[13px] leading-[1.5] tracking-[-0.003em] text-pretty",
            isAi
              ? "border-agent-border-hi bg-agent/[0.10] text-agent-text"
              : isOutbound
                ? "border-ops-accent/[0.22] bg-ops-accent/[0.10] text-text"
                : "border-line bg-inbox-panel text-text",
            // Closed: solid 1px border. Open: 1.5px dashed border, same hue.
            hasDiff && diffOpen
              ? "border-[1.5px] border-dashed"
              : "border",
          )}
        >
          {attachments && attachments.length > 0 && (
            <div
              className="mb-2 flex flex-col gap-1.5"
              data-testid="bubble-attachments"
            >
              {attachments.map((file) => {
                const rowBase =
                  "flex w-full items-center gap-2 rounded-bar border border-line bg-white/[0.02] px-2.5 py-1.5 transition-colors";
                const interactiveExtras =
                  "hover:border-line-hi hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black";

                const inner = (
                  <>
                    <Paperclip
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-text-3"
                      strokeWidth={1.5}
                    />
                    <span className="flex-1 min-w-0 truncate font-mono text-[11px] uppercase text-text-2">
                      {file.filename}
                    </span>
                    <span
                      className="flex-shrink-0 font-mono text-[11px] text-text-3"
                      style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                    >
                      {file.size}
                    </span>
                  </>
                );

                if (file.onClick) {
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={file.onClick}
                      aria-label={t(
                        "messages.openFile",
                        "Open {filename} ({size})",
                      )
                        .replace("{filename}", file.filename)
                        .replace("{size}", file.size)}
                      className={cn(rowBase, interactiveExtras)}
                      data-testid="bubble-attachment-row"
                    >
                      {inner}
                    </button>
                  );
                }

                return (
                  <div
                    key={file.id}
                    className={rowBase}
                    data-testid="bubble-attachment-row"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          )}

          {children}

          <AnimatePresence initial={false}>
            {hasDiff && diffOpen && (
              <motion.div
                key="diff-toolbar"
                initial={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, height: 0 }
                }
                animate={
                  reducedMotion
                    ? { opacity: 1 }
                    : { opacity: 1, height: "auto" }
                }
                exit={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, height: 0 }
                }
                transition={motionTransition}
                className="mb-2 flex flex-col gap-0.5 overflow-hidden"
              >
                <div
                  className="font-cakemono text-[11px] font-light uppercase tracking-[0.18em] text-agent"
                  data-testid="diff-header"
                >
                  {t("phaseC.diffHeader", "// SHOWING DIFF")}
                </div>
                <div
                  className="font-mono text-[11px] text-text-3"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                  data-testid="diff-provenance"
                >
                  {t("phaseC.diffProvenance", "PHASE C → {operator} · {ago}")
                    .replace("{operator}", operator)
                    .replace("{ago}", editedAgo ?? "")}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {hasDiff && diffOpen ? (
            <p
              className="whitespace-pre-wrap break-words"
              data-testid="diff-body"
            >
              {diffParts.map((part, idx) => {
                if (part.removed) {
                  return (
                    <del
                      key={`d-${idx}`}
                      className="text-text-mute line-through"
                      style={{ textDecorationLine: "line-through" }}
                      data-testid="diff-removed"
                    >
                      {part.value}
                    </del>
                  );
                }
                if (part.added) {
                  return (
                    <ins
                      key={`a-${idx}`}
                      className="bg-agent/[0.10] text-text no-underline"
                      style={{ textDecorationLine: "none" }}
                      data-testid="diff-added"
                    >
                      {part.value}
                    </ins>
                  );
                }
                return (
                  <span key={`u-${idx}`} className="text-agent-text">
                    {part.value}
                  </span>
                );
              })}
            </p>
          ) : (
            <p className="whitespace-pre-wrap break-words">{body}</p>
          )}
        </motion.div>
        <div
          className="flex items-center gap-1.5 font-mono text-[11px] text-text-mute"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {isAi ? (
            <span className="inline-flex items-center gap-1 text-agent-text-2">
              <Sparkles aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
              {t("messages.sentByPhaseC", "Phase C")}
            </span>
          ) : (
            <span className="text-text-3">{senderName}</span>
          )}
          {timestamp && (
            <>
              <span aria-hidden>·</span>
              <span>{timestamp}</span>
            </>
          )}
          {hasDiff && editedAgo && (
            <>
              <span aria-hidden>·</span>
              <span className="text-text-3">
                {t("phaseC.edited", "EDITED {ago}").replace(
                  "{ago}",
                  editedAgo,
                )}
              </span>
            </>
          )}
          {hasDiff && (
            <button
              type="button"
              onClick={() => setDiffOpen((o) => !o)}
              className={cn(
                "ml-1 inline-flex items-center gap-1 rounded-[2px] border px-[5px] py-[1px] font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                diffOpen
                  ? "border-line-hi text-text"
                  : "border-agent-border-hi text-agent-hi",
              )}
              aria-expanded={diffOpen}
              data-testid="diff-toggle"
            >
              <GitCompare
                aria-hidden
                className="h-3 w-3"
                strokeWidth={1.5}
              />
              {diffOpen
                ? t("phaseC.hideDiff", "HIDE DIFF")
                : t("phaseC.showDiff", "DIFF")}
            </button>
          )}
          {attachments && attachments.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-text-3" data-testid="bubble-file-count">
                {t(
                  attachments.length === 1
                    ? "messages.fileCount_one"
                    : "messages.fileCount_other",
                  attachments.length === 1 ? "{count} FILE" : "{count} FILES",
                ).replace("{count}", String(attachments.length))}
              </span>
            </>
          )}
          {attachmentName && (
            <>
              <span aria-hidden className="ml-1">
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-text-3">
                <Paperclip
                  aria-hidden
                  className="h-3.5 w-3.5"
                  strokeWidth={1.5}
                />
                {attachmentName}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
